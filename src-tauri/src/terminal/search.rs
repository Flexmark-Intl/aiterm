use alacritty_terminal::event::EventListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::{Column, Point};
use alacritty_terminal::term::Term;
use alacritty_terminal::term::search::RegexSearch;

#[derive(serde::Serialize)]
pub struct SearchMatch {
    pub line: i32,
    pub start_col: usize,
    pub end_col: usize,
    pub text: String,
}

#[derive(serde::Serialize)]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub total_count: usize,
}

/// Search the terminal buffer for a pattern.
pub fn search_buffer<T: EventListener>(
    term: &mut Term<T>,
    query: &str,
    case_sensitive: bool,
) -> Result<SearchResult, String> {
    if query.is_empty() {
        return Ok(SearchResult {
            matches: Vec::new(),
            total_count: 0,
        });
    }

    // Build regex pattern — escape special chars for literal search
    let escaped = escape_regex(query);
    let pattern = if case_sensitive {
        escaped
    } else {
        format!("(?i){}", escaped)
    };

    let mut regex = RegexSearch::new(&pattern).map_err(|e| format!("Invalid search pattern: {}", e))?;

    let mut matches = Vec::new();

    // Search from top of scrollback to bottom of visible area
    let topmost = term.grid().topmost_line();
    let bottommost = term.grid().bottommost_line();

    let mut point = Point::new(topmost, Column(0));

    while point.line <= bottommost {
        if let Some(m) = term.search_next(
            &mut regex,
            point,
            alacritty_terminal::index::Direction::Right,
            alacritty_terminal::index::Side::Left,
            None,
        ) {
            let start = *m.start();
            let end = *m.end();

            // Extract matched text from grid
            let mut text = String::new();
            let mut p = start;
            while p <= end {
                let cell = &term.grid()[p];
                if cell.c != '\0' {
                    text.push(cell.c);
                }
                if p.column.0 + 1 < term.columns() {
                    p.column = Column(p.column.0 + 1);
                } else {
                    p.column = Column(0);
                    p.line += 1;
                }
            }

            matches.push(SearchMatch {
                line: start.line.0,
                start_col: start.column.0,
                end_col: end.column.0,
                text,
            });

            // Move past this match
            point = Point::new(end.line, Column(end.column.0 + 1));
            if point.column.0 >= term.columns() {
                point.column = Column(0);
                point.line += 1;
            }
        } else {
            break;
        }
    }

    let total_count = matches.len();
    Ok(SearchResult {
        matches,
        total_count,
    })
}

/// Escape regex special characters for literal matching.
fn escape_regex(s: &str) -> String {
    let mut result = String::with_capacity(s.len() * 2);
    for c in s.chars() {
        match c {
            '\\' | '.' | '+' | '*' | '?' | '(' | ')' | '|' | '[' | ']' | '{' | '}' | '^'
            | '$' => {
                result.push('\\');
                result.push(c);
            }
            _ => result.push(c),
        }
    }
    result
}
