<script lang="ts">
  import { tick, onDestroy } from 'svelte';
  import { workspacesStore } from '$lib/stores/workspaces.svelte';
  import { terminalsStore } from '$lib/stores/terminals.svelte';
  import { preferencesStore } from '$lib/stores/preferences.svelte';
  import { writeTerminal, terminalBracketedPaste } from '$lib/tauri/commands';
  import { isModKey, modLabel } from '$lib/utils/platform';
  import { error as logError } from '@tauri-apps/plugin-log';
  import Tooltip from '$lib/components/Tooltip.svelte';
  import IconButton from '$lib/components/ui/IconButton.svelte';

  interface Props {
    tabId: string;
    draft: string | null;
  }

  let { tabId, draft }: Props = $props();

  // Initial value only — the component is keyed per tab, so a tab switch remounts
  // it with that tab's persisted draft; live edits flow through `value`.
  // svelte-ignore state_referenced_locally
  let value = $state(draft ?? '');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);
  let open = $derived(workspacesStore.isComposerOpen(tabId));

  let draftTimer: ReturnType<typeof setTimeout> | undefined;
  let draftDirty = false;

  function persistDraft() {
    clearTimeout(draftTimer);
    draftTimer = undefined;
    if (!draftDirty) return;
    draftDirty = false;
    workspacesStore.setComposerDraft(tabId, value || null);
  }

  function onInput() {
    draftDirty = true;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(persistDraft, 500);
    autogrow();
  }

  function autogrow() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    textareaEl.style.height = `${textareaEl.scrollHeight}px`;
  }

  function toggle() {
    workspacesStore.toggleComposer(tabId);
  }

  let shellEl = $state<HTMLDivElement | null>(null);

  // Explicit height animation: WebKit doesn't collapse a 0fr grid row below its
  // content min-content, and a transition:slide outro left orphaned DOM — so the
  // shell stays mounted and we animate its measured height by hand. While open
  // the height is 'auto' so the textarea's autogrow resizes the dock naturally.
  //
  // Deliberately rAF-free: WKWebView pauses requestAnimationFrame in occluded
  // windows, so any rAF-dependent step would leave the dock in a wrong visual
  // state if toggled while the window is in the background. Synchronous reflow
  // (offsetHeight) commits start values instead; only the cosmetic release to
  // 'auto' uses transitionend with a timed fallback.
  let animSeq = 0;
  function setShellHeight(isOpen: boolean, animate: boolean) {
    const el = shellEl;
    if (!el) return;
    const seq = ++animSeq;
    if (!animate) {
      el.style.transitionProperty = 'none';
      el.style.height = isOpen ? 'auto' : '0px';
      void el.offsetHeight; // flush so the height change doesn't animate
      el.style.transitionProperty = '';
      return;
    }
    if (isOpen) {
      // Inline height is 0px (or mid-close px) — animate to content height,
      // then release to auto so autogrow can resize the open dock.
      const target = el.scrollHeight;
      el.style.height = `${target}px`;
      const release = () => {
        el.removeEventListener('transitionend', release);
        clearTimeout(timer);
        if (seq === animSeq) el.style.height = 'auto';
      };
      const timer = setTimeout(release, 250);
      el.addEventListener('transitionend', release);
    } else {
      el.style.height = `${el.scrollHeight}px`;
      void el.offsetHeight; // commit the explicit height before collapsing
      el.style.height = '0px';
    }
  }

  // Height + focus handoff on open/close transitions (button or Cmd+Shift+C
  // alike). The initial run snaps without animation so a tab switch (keyed
  // remount) doesn't replay the slide or steal focus from the terminal.
  let prevOpen: boolean | undefined;
  $effect(() => {
    const isOpen = open;
    if (prevOpen === undefined) {
      setShellHeight(isOpen, false);
    } else if (isOpen !== prevOpen) {
      setShellHeight(isOpen, true);
      if (isOpen) {
        terminalsStore.get(tabId)?.terminal?.blur();
        textareaEl?.focus();
        autogrow();
      } else {
        terminalsStore.get(tabId)?.terminal?.focus();
      }
    }
    prevOpen = isOpen;
  });

  function focusTerminal() {
    terminalsStore.get(tabId)?.terminal?.focus();
  }

  async function send() {
    const text = value.replace(/\n+$/, '');
    if (!text) return;
    const instance = terminalsStore.get(tabId);
    if (!instance) return;
    try {
      // When the foreground app has bracketed paste on (Claude Code, modern
      // readline), wrap the text so embedded newlines stay literal and the
      // trailing CR is one submit. Otherwise (e.g. macOS bash 3.2) the markers
      // would arrive as garbage input — send raw with CR line breaks instead,
      // which executes line-by-line, the natural semantics for such shells.
      const bracketed = await terminalBracketedPaste(instance.ptyId).catch(() => false);
      const payload = bracketed
        ? `\x1b[200~${text}\x1b[201~\r`
        : `${text.replace(/\n/g, '\r')}\r`;
      await writeTerminal(instance.ptyId, Array.from(new TextEncoder().encode(payload)));
      value = '';
      draftDirty = true;
      persistDraft();
      await tick();
      autogrow();
      textareaEl?.focus();
    } catch (e) {
      logError(`Composer send failed: ${e}`);
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && isModKey(e)) {
      e.preventDefault();
      send();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      focusTerminal();
    }
  }

  // Re-measure height when the component mounts with a restored draft.
  $effect(() => {
    if (open && textareaEl) autogrow();
  });

  onDestroy(() => {
    persistDraft();
  });
</script>

<!-- Always mounted; see setShellHeight for why the open/close animation is
     hand-rolled. inert blocks focus/input while collapsed. -->
<div class="composer-shell" class:open inert={!open} bind:this={shellEl}>
  <div class="composer-dock">
    <textarea
      bind:this={textareaEl}
      bind:value
      class="composer-input"
      style:font-family={preferencesStore.fontFamily}
      style:font-size="{preferencesStore.fontSize}px"
      rows="1"
      placeholder="Compose… ({modLabel}+Enter to send, Esc for terminal)"
      spellcheck="false"
      oninput={onInput}
      onkeydown={onKeydown}
    ></textarea>
    <div class="composer-actions">
      <IconButton tooltip="Collapse composer ({modLabel}+Shift+C)" size={26} onclick={toggle} aria-label="Collapse composer">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <path d="M4 6.5 8 10.5 12 6.5"/>
        </svg>
      </IconButton>
      <IconButton tooltip="Send ({modLabel}+Enter)" size={26} onclick={send} aria-label="Send">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M1.7 8 1 2.4c-.1-.6.5-1 1-.8l12.6 5.7c.5.2.5 1 0 1.2L2 14.4c-.5.2-1.1-.2-1-.8L1.7 8Zm0 0h6.6"
            fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </IconButton>
    </div>
  </div>
</div>
{#if !open}
  <div class="composer-handle-pos">
    <Tooltip text="Open composer ({modLabel}+Shift+C)">
      <button class="composer-handle" onclick={toggle} aria-label="Open composer">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.5"/>
          <path d="M4.5 9.5h7"/>
        </svg>
      </button>
    </Tooltip>
  </div>
{/if}

<style>
  .composer-shell {
    height: 0;
    overflow: hidden;
    transition: height 160ms ease;
  }

  .composer-dock {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 10px 12px;
    background: var(--bg-medium);
    border-top: 1px solid var(--bg-light);
  }

  .composer-input {
    flex: 1;
    resize: none;
    overflow-y: auto;
    min-height: 30px;
    max-height: 35vh;
    padding: 6px 8px;
    background: var(--bg-dark);
    color: var(--fg);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    line-height: 1.4;
    outline: none;
  }

  .composer-input:focus {
    border-color: var(--accent);
  }

  .composer-input::placeholder {
    color: var(--fg-dim);
  }

  .composer-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    /* Keep the row vertically centered on the input's single-line height,
       pinned to the bottom as the textarea grows. */
    margin-bottom: 3px;
  }

  .composer-handle-pos {
    position: absolute;
    right: 14px;
    bottom: 8px;
    z-index: 5;
  }

  .composer-handle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    color: var(--fg-dim);
    background: var(--bg-medium);
    border: 1px solid var(--bg-light);
    border-radius: 6px;
    opacity: 0.45;
    transition: opacity 0.15s, color 0.15s, background 0.15s;
  }

  .composer-handle:hover {
    opacity: 1;
    color: var(--fg);
    background: var(--bg-light);
  }
</style>
