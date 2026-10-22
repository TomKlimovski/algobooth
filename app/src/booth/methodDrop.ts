// Run-time dependencies pinned to the copies @strudel/codemirror resolves: a second copy makes appendConfig throw.
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** The MIME type the Methods panel puts on a drag; the payload is a `MethodDrag` as JSON. */
export const METHOD_MIME = 'application/x-algobooth-method';

/**
 * What a drag carries: the catalogue's snippet, where its first argument sits within it, whether it is a
 * method (lands at a line's end) or a standalone function (an expression: lands at the pointer), and the
 * function's folder, which decides what a blank-line drop writes.
 */
export interface MethodDrag { name: string; snippet: string; argRange: [number, number] | null; kind: 'method' | 'function'; group: string }

/**
 * Scans one line: where its first `//` outside a string is (-1 when none), and whether it ends inside a template
 * literal. `inTemplate` says whether it starts inside one; only backticks span lines.
 */
export function scanLine(line: string, inTemplate: boolean): { comment: number; inTemplate: boolean } {
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
export const SETUP = /^(setcpm\(|setcps\(|samples\(|const\s|let\s|var\s|await\s)/;
/** Code ending in an arrow or a binary operator: the expression goes on, so nothing can be appended. */
const UNFINISHED = /(=>|[-+*/%?:=&|<>])$/;
/** A numeric literal at the end of the code. */
const NUMBER_END = /(?<![\w$.])(\d+\.?\d*|\.\d+)$/;
/** A named-pattern label on its own (`$:`, `bass:`): the pattern body is on the lines below. */
export const BARE_LABEL = /^[\w$]+:$/;

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
  const at = landingOffset(code, lineIndex);
  if (at === null) return null;
  return { code: code.slice(0, at) + drag.snippet + code.slice(at), selection: argSelection(at, drag) };
}

/** The offset in `code` where a method dropped on line `lineIndex` goes, by the rules of `insertAtLineEnd`. */
export function landingOffset(code: string, lineIndex: number): number | null {
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

/** Before the pointer, past spaces: a character an expression may follow. */
const OPENER = /[([{,:=?+\-*/%!&|<>]/;
/** After the pointer, past spaces: a character an expression may precede. */
const CLOSER = /[)\]},;]/;
/** Folders whose expression is a pattern: on a blank line it gets a `$:` label so the deck plays it. */
const PLAYS_AS_LINE = new Set(['Combine', 'Sources', 'Other']);
/** Folders whose expression only drives a parameter: a blank line has nothing for it to drive. */
const NEEDS_A_TARGET = new Set(['Signals', 'Random']);

/** One edit: replace `[from, to)` with `insert`; `selection` is the argument's range afterwards. */
interface Edit { from: number; to: number; insert: string; selection: [number, number] | null }

/**
 * Where a function's expression goes when dropped at `offset`: at the pointer when an expression can start
 * there (outside strings and comments; after an opener, a label or nothing but spaces; before a closer, a
 * comment or the line's end). On a blank line a combinator is written as its own `$:` line, a setup call as
 * it is, and a signal refuses (nothing to drive). Null when the drop is refused.
 */
function functionEdit(code: string, offset: number, drag: MethodDrag): Edit | null {
  const at = Math.max(0, Math.min(offset, code.length));
  const spot = expressionSpot(code, at);
  if (spot === 'no') return null;
  if (spot === 'blank') {
    if (NEEDS_A_TARGET.has(drag.group)) return null;
    const from = code.lastIndexOf('\n', at - 1) + 1;
    let to = code.indexOf('\n', at);
    if (to === -1) to = code.length;
    const prefix = PLAYS_AS_LINE.has(drag.group) ? '$: ' : '';
    const sel = argSelection(from + prefix.length, drag);
    return { from, to, insert: prefix + drag.snippet, selection: sel };
  }
  return { from: at, to: at, insert: drag.snippet, selection: argSelection(at, drag) };
}

/** `insertAtLineEnd`'s counterpart for a function: the code after the drop, or null when refused. */
export function insertAtPointer(code: string, offset: number, drag: MethodDrag): { code: string; selection: [number, number] | null } | null {
  const e = functionEdit(code, offset, drag);
  if (e === null) return null;
  return { code: code.slice(0, e.from) + e.insert + code.slice(e.to), selection: e.selection };
}

/** Whether an expression may start at `at`: 'ok', 'blank' (the line holds only whitespace) or 'no'. */
function expressionSpot(code: string, at: number): 'ok' | 'blank' | 'no' {
  // Scan up to `at`, tracking strings, template literals and both kinds of comment.
  let quote: string | null = null;
  let comment: 'line' | 'block' | null = null;
  for (let i = 0; i < at; i++) {
    const c = code[i];
    if (comment === 'line') {
      if (c === '\n') comment = null;
    } else if (comment === 'block') {
      if (c === '*' && code[i + 1] === '/') {
        comment = null;
        i++;
      }
    } else if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      else if (c === '\n' && quote !== '`') quote = null; // an unterminated string ends with its line
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && code[i + 1] === '/') comment = 'line';
    else if (c === '/' && code[i + 1] === '*') comment = 'block';
  }
  if (quote || comment) return 'no';
  let b = at;
  while (b > 0 && (code[b - 1] === ' ' || code[b - 1] === '\t')) b--;
  const prev = b > 0 && code[b - 1] !== '\n' ? code[b - 1] : '';
  let f = at;
  while (f < code.length && (code[f] === ' ' || code[f] === '\t')) f++;
  const next = f < code.length && code[f] !== '\n' ? code.slice(f, f + 2) : '';
  if (prev === '' && next === '') return 'blank';
  const prevOk = prev === '' || OPENER.test(prev);
  const nextOk = next === '' || CLOSER.test(next[0]) || next === '//';
  return prevOk && nextOk ? 'ok' : 'no';
}

/**
 * Lets an editor take a method dropped from the panel: it lands at the end of the line under the pointer, its argument
 * selected. Every method drop is claimed, a refused one too, so CodeMirror never inserts the text/plain copy mid-token;
 * other drags are left to CodeMirror. Nothing is evaluated.
 */
export function methodDropExtension(view: () => EditorView, onRefused: (kind: MethodDrag['kind']) => void): Extension {
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
      if (!applyDrag(v, v.posAtCoords({ x: e.clientX, y: e.clientY }) ?? doc.length, drag)) onRefused(drag.kind);
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
  let edit: Edit | null;
  if (drag.kind === 'function') edit = functionEdit(code, offset, drag);
  else {
    const at = landingOffset(code, view.state.doc.lineAt(offset).number - 1);
    edit = at === null ? null : { from: at, to: at, insert: drag.snippet, selection: argSelection(at, drag) };
  }
  if (edit === null) return false;
  // Only the snippet is inserted, so the rest of the document (and its undo history) stays put.
  const { from, to, insert, selection: sel } = edit;
  view.dispatch({
    changes: { from, to, insert },
    selection: sel ? { anchor: sel[0], head: sel[1] } : { anchor: from + insert.length },
    userEvent: 'input.drop',
  });
  view.focus();
  return true;
}

/** Inserts `drag` at the cursor (the panel's double-click): a method on its line, a function at it; false when refused. */
export function insertAtCursor(view: EditorView, drag: MethodDrag): boolean {
  return applyDrag(view, view.state.selection.main.head, drag);
}
