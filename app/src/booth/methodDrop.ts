// Run-time dependencies pinned to the copies @strudel/codemirror resolves: a second copy makes appendConfig throw.
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The MIME type the Methods panel puts on a drag; the payload is a `MethodDrag` as JSON. */
export const METHOD_MIME = 'application/x-algobooth-method';

/**
 * What a drag carries: the catalogue's snippet, where its first argument sits within it, and whether it is a
 * method (lands at a line's end) or a standalone function (an expression: lands at the pointer).
 */
export interface MethodDrag { name: string; snippet: string; argRange: [number, number] | null; kind: 'method' | 'function' }

/**
 * Scans one line: where its first `//` outside a string is (-1 when none), and whether it ends inside a template
 * literal. `inTemplate` says whether it starts inside one; only backticks span lines.
 */
function scanLine(line: string, inTemplate: boolean): { comment: number; inTemplate: boolean } {
  let quote: string | null = inTemplate ? '`' : null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && line[i + 1] === '/') return { comment: i, inTemplate: false };
  }
  return { comment: -1, inTemplate: quote === '`' };
}

/** A line that sets the deck up rather than playing: never a target. */
const SETUP = /^(setcpm\(|setcps\(|samples\(|const\s|let\s|var\s|await\s)/;
/** Code ending in an arrow or a binary operator: the expression goes on, so nothing can be appended. */
const UNFINISHED = /(=>|[-+*/%?:=&|<>])$/;
/** A numeric literal at the end of the code. */
const NUMBER_END = /(?<![\w$.])(\d+\.?\d*|\.\d+)$/;
/** A named-pattern label on its own (`$:`, `bass:`): the pattern body is on the lines below. */
const BARE_LABEL = /^[\w$]+:$/;

/**
 * Where a snippet goes on a line: after its code, before a trailing `;`, `,`, whitespace or comment.
 * Null for a line with no code or a setup line (both skipped); 'down' for a bare label, whose body is below;
 * 'refuse' for one where nothing can be appended: it opens a bracket, ends inside a template literal, ends in
 * an operator or arrow, or has a number before a trailing comma.
 */
function codeEnd(line: string, startsInTemplate: boolean): number | 'refuse' | 'down' | null {
  const scan = scanLine(line, startsInTemplate);
  if (scan.inTemplate) return 'refuse';
  const code = (scan.comment < 0 ? line : line.slice(0, scan.comment)).trimEnd();
  if (code.trim() === '') return null;
  if (!startsInTemplate && SETUP.test(code.trimStart())) return null;
  if (!startsInTemplate && BARE_LABEL.test(code.trim())) return 'down';
  if (/[([{]$/.test(code)) return 'refuse';
  const comma = code.endsWith(',');
  const body = /[;,]$/.test(code) ? code.slice(0, -1).trimEnd() : code;
  if (UNFINISHED.test(body) || (comma && NUMBER_END.test(body))) return 'refuse';
  return /[;,]$/.test(code) ? code.length - 1 : code.length;
}

/**
 * Inserts a dropped method at the end of a line's code, wherever the pointer was on it, so it can never
 * split a string or a word. A blank, comment-only or setup line (`setcpm(`, `samples(`, `const` ...) borrows the
 * nearest pattern line above, else the next one below; a bare label (`$:` alone) sends it to the body below it;
 * null when there is none, or when the line it settles on cannot take a method (see `codeEnd`). `selection` is
 * the argument's range in the new code, for the editor to select.
 */
export function insertAtLineEnd(code: string, lineIndex: number, drag: MethodDrag): { code: string; selection: [number, number] | null } | null {
  const at = landing(code, lineIndex);
  if (at === null) return null;
  return { code: code.slice(0, at) + drag.snippet + code.slice(at), selection: argSelection(at, drag) };
}

/** The offset in `code` where a method dropped on line `lineIndex` goes, by the rules of `insertAtLineEnd`. */
function landing(code: string, lineIndex: number): number | null {
  const lines = code.split('\n');
  // Template-literal state carries from the document start; each line's offset with it.
  const starts: boolean[] = [];
  const offsets: number[] = [];
  let inTemplate = false;
  let offset = 0;
  for (const l of lines) {
    starts.push(inTemplate);
    offsets.push(offset);
    inTemplate = scanLine(l, inTemplate).inTemplate;
    offset += l.length + 1;
  }
  const from = Math.min(lineIndex, lines.length - 1);
  const at = (i: number) => {
    const end = codeEnd(lines[i], starts[i]);
    return typeof end === 'number' ? offsets[i] + end : end;
  };
  // The first line below `i` that decides: a label met on the way down counts as its own body's start.
  const down = (i: number): number | null => {
    for (let j = i + 1; j < lines.length; j++) {
      const end = at(j);
      if (end === 'down') continue;
      if (end !== null) return end === 'refuse' ? null : end;
    }
    return null;
  };
  for (let i = from; i >= 0; i--) {
    const end = at(i);
    if (end === 'down') return down(i);
    if (end !== null) return end === 'refuse' ? null : end;
  }
  return down(from);
}

const argSelection = (at: number, drag: MethodDrag): [number, number] | null =>
  drag.argRange && [at + drag.argRange[0], at + drag.argRange[1]];

/** A character that continues an identifier or number, or ends an expression: no expression can start after it. */
const EXPRESSION_END = /[\w$)\]"'`]/;
const WORD = /[\w$]/;

/**
 * Inserts a function's expression where the pointer is: the offset must be a place an expression can start,
 * outside strings, comments and template literals, not inside a word or number and not right after an
 * expression (`)`, a quote, a name). Null when it is not; the deck shows the refusal. `selection` as for
 * `insertAtLineEnd`.
 */
export function insertAtPointer(code: string, offset: number, drag: MethodDrag): { code: string; selection: [number, number] | null } | null {
  const at = Math.max(0, Math.min(offset, code.length));
  if (!canStartExpression(code, at)) return null;
  return { code: code.slice(0, at) + drag.snippet + code.slice(at), selection: argSelection(at, drag) };
}

/** Whether an expression may be inserted at `at`: see `insertAtPointer`. */
function canStartExpression(code: string, at: number): boolean {
  // Scan up to `at`, tracking strings, template literals and comments the way `scanLine` does.
  let quote: string | null = null;
  let comment = false;
  for (let i = 0; i < at; i++) {
    const c = code[i];
    if (comment) {
      if (c === '\n') comment = false;
    } else if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      else if (c === '\n' && quote !== '`') quote = null; // an unterminated string ends with its line
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && code[i + 1] === '/') comment = true;
  }
  if (quote || comment) return false;
  const prev = at > 0 ? code[at - 1] : '';
  const next = at < code.length ? code[at] : '';
  return !EXPRESSION_END.test(prev) && !WORD.test(next);
}

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
      if (!applyDrag(v, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? doc.length, drag)) onRefused();
      return true;
    },
  });
}

/**
 * Inserts `drag` by its kind's rule (a method at the end of the line holding `offset`, a function at `offset`
 * itself), selects its argument and focuses; false when refused.
 */
export function applyDrag(view: EditorView, offset: number, drag: MethodDrag): boolean {
  const code = view.state.doc.toString();
  const at = drag.kind === 'function' ? (canStartExpression(code, offset) ? offset : null) : landing(code, view.state.doc.lineAt(offset).number - 1);
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

/** Inserts `drag` at the cursor (the panel's double-click): a method on its line, a function at it; false when refused. */
export function insertAtCursor(view: EditorView, drag: MethodDrag): boolean {
  return applyDrag(view, view.state.selection.main.head, drag);
}
