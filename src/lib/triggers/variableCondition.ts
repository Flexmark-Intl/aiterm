/**
 * Variable condition parser and evaluator.
 *
 * Syntax:
 *   expr     := and_expr ('||' and_expr)*
 *   and_expr := atom ('&&' atom)*
 *   atom     := '!' IDENT | IDENT ('==' | '!=') STRING | IDENT
 *   STRING   := "..." | '...'
 *   IDENT    := [a-zA-Z_]\w*
 *
 * Examples:
 *   claudeSessionId                          — truthy (non-empty)
 *   !claudeSessionId                         — falsy
 *   claudeSessionId == "abc"                 — equals
 *   claudeSessionId || claudeResumeCommand   — OR
 *   a && b                                   — AND (higher precedence than ||)
 */

export type ConditionNode =
  | { type: 'truthy'; name: string }
  | { type: 'falsy'; name: string }
  | { type: 'eq'; name: string; value: string }
  | { type: 'neq'; name: string; value: string }
  | { type: 'and'; children: ConditionNode[] }
  | { type: 'or'; children: ConditionNode[] };

// Cache parsed ASTs by expression string
const parseCache = new Map<string, ConditionNode>();

class Parser {
  private pos = 0;
  private input: string;

  constructor(input: string) {
    this.input = input;
  }

  parse(): ConditionNode {
    const node = this.parseOr();
    this.skipWhitespace();
    if (this.pos < this.input.length) {
      throw new Error(`Unexpected character at position ${this.pos}: '${this.input[this.pos]}'`);
    }
    return node;
  }

  private parseOr(): ConditionNode {
    const children: ConditionNode[] = [this.parseAnd()];
    while (this.match('||')) {
      children.push(this.parseAnd());
    }
    return children.length === 1 ? children[0] : { type: 'or', children };
  }

  private parseAnd(): ConditionNode {
    const children: ConditionNode[] = [this.parseAtom()];
    while (this.match('&&')) {
      children.push(this.parseAtom());
    }
    return children.length === 1 ? children[0] : { type: 'and', children };
  }

  private parseAtom(): ConditionNode {
    this.skipWhitespace();

    if (this.pos >= this.input.length) {
      throw new Error('Unexpected end of expression');
    }

    // Negation
    if (this.input[this.pos] === '!') {
      this.pos++;
      const name = this.readIdent();
      return { type: 'falsy', name };
    }

    const name = this.readIdent();

    this.skipWhitespace();

    // Comparison operators
    if (this.match('==')) {
      const value = this.readString();
      return { type: 'eq', name, value };
    }
    if (this.match('!=')) {
      const value = this.readString();
      return { type: 'neq', name, value };
    }

    // Bare identifier = truthy check
    return { type: 'truthy', name };
  }

  private readIdent(): string {
    this.skipWhitespace();
    const start = this.pos;
    while (this.pos < this.input.length && /[\w]/.test(this.input[this.pos])) {
      this.pos++;
    }
    if (this.pos === start) {
      throw new Error(`Expected identifier at position ${this.pos}`);
    }
    return this.input.slice(start, this.pos);
  }

  private readString(): string {
    this.skipWhitespace();
    if (this.pos >= this.input.length) {
      throw new Error('Expected string literal');
    }
    const quote = this.input[this.pos];
    if (quote !== '"' && quote !== "'") {
      throw new Error(`Expected string literal at position ${this.pos}, got '${this.input[this.pos]}'`);
    }
    this.pos++; // skip opening quote
    const start = this.pos;
    while (this.pos < this.input.length && this.input[this.pos] !== quote) {
      this.pos++;
    }
    if (this.pos >= this.input.length) {
      throw new Error(`Unterminated string literal starting at position ${start - 1}`);
    }
    const value = this.input.slice(start, this.pos);
    this.pos++; // skip closing quote
    return value;
  }

  private match(token: string): boolean {
    this.skipWhitespace();
    if (this.input.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  private skipWhitespace() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }
}

/** Parse a condition expression string into an AST node. Results are cached. */
export function parseCondition(expr: string): ConditionNode {
  const cached = parseCache.get(expr);
  if (cached) return cached;
  const node = new Parser(expr).parse();
  parseCache.set(expr, node);
  return node;
}

/** Evaluate a condition AST against a variable map. */
export function evaluateCondition(node: ConditionNode, vars: Map<string, string>): boolean {
  switch (node.type) {
    case 'truthy':
      return !!(vars.get(node.name));
    case 'falsy':
      return !(vars.get(node.name));
    case 'eq':
      return vars.get(node.name) === node.value;
    case 'neq':
      return vars.get(node.name) !== node.value;
    case 'and':
      return node.children.every(c => evaluateCondition(c, vars));
    case 'or':
      return node.children.some(c => evaluateCondition(c, vars));
  }
}
