import { landingOffset } from '../methodDrop';
import type { Binding, MethodPart } from './bindings';
import type { PatternLine } from './lines';

/** One replacement of `[from, to)` in the document by `insert`. */
export interface Edit { from: number; to: number; insert: string }
export type Outcome = { ok: true; edits: Edit[]; on: boolean } | { ok: false; reason: string };
export const REFUSED_LINE = 'this line cannot take a method';
export const REFUSED_ARG = 'nothing to nudge';

/** A `.name(...)` call found in code: `from` at the dot, `open` at the paren, `to` just past the closing paren. */
interface Call { from: number; open: number; to: number }

/**
 * Which characters of `text` are code, i.e. outside strings and `//` comments. Backticks span lines; the other
 * quotes end with their line, so one stray quote cannot swallow the rest of a pattern.
 */
function codeMask(text: string): boolean[] {
  const mask: boolean[] = new Array(text.length).fill(false);
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote || (c === '\n' && quote !== '`')) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      i--;
    } else mask[i] = true;
  }
  return mask;
}

/** The `.name(` calls in `text`, in order, each with its balanced end; `to` is -1 when the parens never balance. */
function callsOf(text: string, name: string): Call[] {
  const mask = codeMask(text);
  const head = `.${name}(`;
  const out: Call[] = [];
  for (let i = text.indexOf(head); i >= 0; i = text.indexOf(head, i + 1)) {
    if (!mask[i]) continue;
    const open = i + head.length - 1;
    let depth = 0;
    let to = -1;
    for (let j = open; j < text.length; j++) {
      if (!mask[j]) continue;
      if (text[j] === '(') depth++;
      else if (text[j] === ')' && --depth === 0) { to = j + 1; break; }
    }
    out.push({ from: i, open, to });
  }
  return out;
}

const partsOf = (binding: Binding): MethodPart[] =>
  binding.kind === 'macro' ? binding.parts : binding.kind === 'method' ? [binding] : [];

/** Each part's call in order (the first after the previous part's); null when one is missing. */
function presence(text: string, parts: MethodPart[]): Call[] | null {
  const found: Call[] = [];
  let after = -1;
  for (const part of parts) {
    const call = callsOf(text, part.name).find((c) => c.from > after);
    if (!call) return null;
    found.push(call);
    after = call.from;
  }
  return found;
}

const lineText = (code: string, line: PatternLine) => code.slice(line.from, line.to);

/** Whether the binding is present on the line: `.name(` outside strings and comments, every part in order for a macro; a line key is "on" when not muted. */
export function isOn(code: string, line: PatternLine, binding: Binding): boolean {
  if (binding.kind === 'line') return !line.muted;
  return presence(lineText(code, line), partsOf(binding)) !== null;
}

/**
 * Toggle: insert the snippet at the landing point of the line's last physical line when off, remove the last
 * balanced `.name(...)` when on (a macro: each part, last first). `on` is the state after the edit. Undoing is
 * just toggling again on the new code, so the caller re-derives it. Only a whole call is ever removed and the
 * insertion only goes where a drop would, so no string, word or bracket is split.
 */
export function toggle(code: string, line: PatternLine, binding: Binding): Outcome {
  if (binding.kind === 'line') return flipMute(code, line);
  const parts = partsOf(binding);
  if (parts.length === 0) return { ok: false, reason: REFUSED_LINE };
  const text = lineText(code, line);
  if (presence(text, parts)) {
    const edits: Edit[] = [];
    for (const part of [...parts].reverse()) {
      const calls = callsOf(text, part.name);
      const last = calls[calls.length - 1];
      if (last.to < 0) return { ok: false, reason: REFUSED_LINE };
      edits.push({ from: line.from + last.from, to: line.from + last.to, insert: '' });
    }
    return { ok: true, edits, on: false };
  }
  const at = landingOffset(code, line.lastLine);
  if (at === null) return { ok: false, reason: REFUSED_LINE };
  return { ok: true, edits: [{ from: at, to: at, insert: parts.map((p) => p.snippet).join('') }], on: true };
}

const PLAIN_NUMBER = /^(\d+\.?\d*|\.\d+)$/;

/** Shift/Ctrl on a bound key: double or halve the first argument of the (first part's) call, if it is a bare number. */
export function nudge(code: string, line: PatternLine, binding: Binding, dir: 'up' | 'down'): Outcome {
  const part = partsOf(binding)[0];
  if (!part || !part.argRange) return { ok: false, reason: REFUSED_ARG };
  const text = lineText(code, line);
  const calls = callsOf(text, part.name);
  const call = calls[calls.length - 1];
  if (!call || call.to < 0) return { ok: false, reason: REFUSED_ARG };
  const mask = codeMask(text);
  let end = call.to - 1;
  let depth = 0;
  for (let j = call.open + 1; j < call.to - 1; j++) {
    if (!mask[j]) continue;
    if ('([{'.includes(text[j])) depth++;
    else if (')]}'.includes(text[j])) depth--;
    else if (text[j] === ',' && depth === 0) { end = j; break; }
  }
  const raw = text.slice(call.open + 1, end);
  const arg = raw.trim();
  if (!PLAIN_NUMBER.test(arg)) return { ok: false, reason: REFUSED_ARG };
  const next = Math.max(0.001, Number(((dir === 'up' ? 2 : 0.5) * Number(arg)).toPrecision(3)));
  const from = line.from + call.open + 1 + raw.indexOf(arg);
  return { ok: true, edits: [{ from, to: from + arg.length, insert: String(next) }], on: true };
}

/** Flips a named line's leading underscore: `_x:` becomes `x:` (playing), `x:` becomes `_x:` (muted). `$:` and unlabelled lines have nothing to flip. */
export function flipMute(code: string, line: PatternLine): Outcome {
  if (line.label === null) return { ok: false, reason: REFUSED_LINE };
  const at = code.slice(line.from).search(/\S/) + line.from;
  if (line.muted) return { ok: true, edits: [{ from: at, to: at + 1, insert: '' }], on: true };
  return { ok: true, edits: [{ from: at, to: at, insert: '_' }], on: false };
}

/** Applies non-overlapping edits from the highest `from` down, so earlier offsets stay valid. */
export function applyEdits(code: string, edits: Edit[]): string {
  return [...edits]
    .sort((a, b) => b.from - a.from)
    .reduce((acc, e) => acc.slice(0, e.from) + e.insert + acc.slice(e.to), code);
}
