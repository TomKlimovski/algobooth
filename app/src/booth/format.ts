import type { Edit } from './keys/press';
import { SETUP, scanLine } from './methodDrop';

/**
 * The deck's Format button: every top-level `.method(...)` of a chain goes on its own line, indented two
 * spaces under the chain's first line, as a rip writes a long chain by hand:
 *
 *     bass: note("g1*4")
 *       .s("sawtooth")
 *       .lpf(370)
 *
 * A chain is a physical line plus the lines under it that start with `.`; those are rejoined first, so the
 * result is the same however the chain was spread before (idempotent). Only dots at bracket depth zero and
 * outside strings split, so a chain nested in an argument (`.lpf(sine.range(200,3000).slow(8))`) stays
 * inline and a `.5` or `1.5` is never touched. A trailing `//` comment stays on the line whose code it ended.
 * Blank, comment-only and setup lines are left alone, and so is any chain that runs through a template
 * literal (backticks span lines, and that layout is the author's).
 */

/** Two spaces, as the rip's own output indents a continued chain. */
const INDENT = '  ';
const IDENT_START = /[A-Za-z_$]/;

interface Segment { code: string; comment: string }

/** Where the top-level `.name` dots of `code` are: outside strings, at bracket depth zero, before an identifier. */
function splitPoints(code: string): number[] {
  const out: number[] = [];
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '.' && depth === 0 && i > 0 && IDENT_START.test(code[i + 1] ?? '')) out.push(i);
  }
  return out;
}

/** The lines of one chain laid out as Format wants them; the original lines when there is nothing to split. */
function layout(lines: string[]): string[] {
  const segments: Segment[] = lines.map((line) => {
    const { comment } = scanLine(line, false);
    return comment < 0 ? { code: line.trim(), comment: '' } : { code: line.slice(0, comment).trim(), comment: line.slice(comment).trim() };
  });
  const joined = segments.map((s) => s.code).join('');
  const points = splitPoints(joined).filter((p) => p > 0);
  if (points.length === 0) return lines;
  // Each comment belongs after the piece its line's code ended in.
  const ends: number[] = [];
  let at = 0;
  for (const s of segments) {
    at += s.code.length;
    ends.push(at);
  }
  const bounds = [0, ...points, joined.length];
  const indent = lines[0].slice(0, lines[0].length - lines[0].trimStart().length);
  const out: string[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const [from, to] = [bounds[i], bounds[i + 1]];
    let piece = joined.slice(from, to).trimEnd();
    segments.forEach((s, k) => {
      if (s.comment && ends[k] > from && ends[k] <= to) piece += ' ' + s.comment;
    });
    out.push((i === 0 ? indent : indent + INDENT) + piece);
  }
  return out;
}

/** The edits Format makes to `code`: one replacement per chain whose layout changes; none when it is formatted already. */
export function formatEdits(code: string): Edit[] {
  const lines = code.split('\n');
  const edits: Edit[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  let inTemplate = false;
  let i = 0;
  while (i < lines.length) {
    const startsInTemplate = inTemplate;
    const scan = scanLine(lines[i], inTemplate);
    inTemplate = scan.inTemplate;
    const code0 = scan.comment < 0 ? lines[i] : lines[i].slice(0, scan.comment);
    const body = code0.trim();
    if (startsInTemplate || body === '' || SETUP.test(body)) {
      i++;
      continue;
    }
    // The chain: this line and the `.`-led lines under it.
    let end = i + 1;
    let template = scan.inTemplate;
    while (end < lines.length) {
      const next = scanLine(lines[end], template);
      const nextCode = (next.comment < 0 ? lines[end] : lines[end].slice(0, next.comment)).trim();
      if (template || !nextCode.startsWith('.')) break;
      template = next.inTemplate;
      end++;
    }
    inTemplate = template;
    const group = lines.slice(i, end);
    if (!template && !scan.inTemplate) {
      const formatted = layout(group);
      const before = group.join('\n');
      const after = formatted.join('\n');
      if (after !== before) edits.push({ from: offsets[i], to: offsets[i] + before.length, insert: after });
    }
    i = end;
  }
  return edits;
}

/** `code` with every chain laid out as the Format button lays it. */
export function formatChains(code: string): string {
  return formatEdits(code)
    .sort((a, b) => b.from - a.from)
    .reduce((acc, e) => acc.slice(0, e.from) + e.insert + acc.slice(e.to), code);
}
