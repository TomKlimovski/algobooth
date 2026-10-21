import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

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
  const at = landing(code, lineIndex);
  if (at === null) return null;
  return { code: code.slice(0, at) + drag.snippet + code.slice(at), selection: argSelection(at, drag) };
}

/** The offset in `code` where a method dropped on line `lineIndex` goes, by the rules of `insertAtLineEnd`. */
function landing(code: string, lineIndex: number): number | null {
  const lines = code.split('\n');
  for (let i = Math.min(lineIndex, lines.length - 1); i >= 0; i--) {
    const end = codeEnd(lines[i]);
    if (end === 'open') return null;
    if (end === null) continue;
    return lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + end;
  }
  return null;
}

const argSelection = (at: number, drag: MethodDrag): [number, number] | null =>
  drag.argRange && [at + drag.argRange[0], at + drag.argRange[1]];

/**
 * Lets an editor take a method dropped from the panel: it lands at the end of the line under the pointer, its argument
 * selected. Every method drop is claimed, a refused one too, so CodeMirror never inserts the text/plain copy mid-token;
 * other drags are left to CodeMirror. Nothing is evaluated.
 */
export function methodDropExtension(view: () => EditorView, onRefused: () => void): Extension {
  const isMethod = (e: DragEvent) => e.dataTransfer?.types.includes(METHOD_MIME) ?? false;
  return EditorView.domEventHandlers({
    dragover(e) {
      if (!isMethod(e)) return false;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      return true;
    },
    drop(e) {
      if (!isMethod(e)) return false;
      e.preventDefault();
      const v = view();
      const drag = JSON.parse(e.dataTransfer!.getData(METHOD_MIME)) as MethodDrag;
      const doc = v.state.doc;
      const lineIndex = doc.lineAt(v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? doc.length).number - 1;
      if (!applyDrag(v, lineIndex, drag)) onRefused();
      return true;
    },
  });
}

/** Inserts `drag` on line `lineIndex` (0-based) by `insertAtLineEnd`'s rules, selects its argument and focuses; false when refused. */
export function applyDrag(view: EditorView, lineIndex: number, drag: MethodDrag): boolean {
  const at = landing(view.state.doc.toString(), lineIndex);
  if (at === null) return false;
  // Only the snippet is inserted, so the rest of the document (and its undo history) stays put.
  const sel = argSelection(at, drag);
  view.dispatch({
    changes: { from: at, insert: drag.snippet },
    selection: sel ? { anchor: sel[0], head: sel[1] } : { anchor: at + drag.snippet.length },
    userEvent: 'input.drop',
  });
  view.focus();
  return true;
}
