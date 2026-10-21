/** The MIME type the Methods panel puts on a drag; the payload is a `MethodDrag` as JSON. */
export const METHOD_MIME = 'application/x-algobooth-method';

/** What a drag carries: the catalogue's snippet and where its first argument sits within it. */
export interface MethodDrag { name: string; snippet: string; argRange: [number, number] | null }

/** Index of the first `//` outside a string on the line, or -1. */
function commentStart(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return i;
  }
  return -1;
}

/**
 * Where a snippet goes on a line: after its code, before a trailing `;`, `,`, whitespace or comment.
 * Null for a line with no code; 'open' for one ending in an opening bracket, where nothing can be appended.
 */
function codeEnd(line: string): number | 'open' | null {
  const c = commentStart(line);
  const code = (c < 0 ? line : line.slice(0, c)).trimEnd();
  if (code.trim() === '') return null;
  if (/[([{]$/.test(code)) return 'open';
  return /[;,]$/.test(code) ? code.length - 1 : code.length;
}

/**
 * Inserts a dropped method at the end of a line's code, wherever the pointer was on it, so it can never
 * split a string or a word. A blank or comment-only line borrows the nearest pattern line above; null when
 * there is none, as it is for a line that opens a bracket. `selection` is the argument's range in the new code, for the editor to select.
 */
export function insertAtLineEnd(code: string, lineIndex: number, drag: MethodDrag): { code: string; selection: [number, number] | null } | null {
  const lines = code.split('\n');
  for (let i = Math.min(lineIndex, lines.length - 1); i >= 0; i--) {
    const end = codeEnd(lines[i]);
    if (end === 'open') return null;
    if (end === null) continue;
    const at = lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + end;
    return {
      code: code.slice(0, at) + drag.snippet + code.slice(at),
      selection: drag.argRange && [at + drag.argRange[0], at + drag.argRange[1]],
    };
  }
  return null;
}
