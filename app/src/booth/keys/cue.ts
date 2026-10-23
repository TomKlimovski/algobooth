import { patternLines, type PatternLine } from './lines';

/** A cue block's first line: what the deck's code carries to say a second pattern is cued in. */
export const MARKER = '// cued: ';

/**
 * Shown when a cue is refused: Strudel plays a deck's last bare expression only while no labelled line is switched
 * on, so the first cued pad would silence it.
 */
export const REFUSED_CUE = "label the deck's lines ($: or name:) to cue into it";

/** Where a slug stops growing: the first word boundary at or after this many characters. */
const SLUG_LENGTH = 12;

/**
 * A short identifier from a pattern's name, to prefix its lines so they cannot collide with the deck's own:
 * lower-case words joined by underscores, cut at the first word boundary at or after 12 characters (the first
 * word always stays whole). A name with no word characters is `cued`; one starting with a digit gets `p_`.
 */
export function slugOf(name: string): string {
  const words = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').split('_').filter(Boolean);
  const kept: string[] = [];
  let length = 0;
  for (const w of words) {
    if (kept.length > 0 && length >= SLUG_LENGTH) break;
    kept.push(w);
    length = kept.join('_').length;
  }
  const slug = kept.join('_');
  if (slug === '') return 'cued';
  return /^\d/.test(slug) ? `p_${slug}` : slug;
}

/** The tempo calls a cued pattern must not bring along: the deck keeps its own clock. */
const TEMPO = /^\s*(setcpm|setcps)\(/;

/**
 * The text appended to a deck to cue `pattern` in: a marker comment, then the pattern's code with its tempo calls and
 * blank lines dropped and every pattern line muted and prefixed with the slug of its name, so it cannot collide with
 * the deck's own labels. A pattern line with no label (or `$:`) is numbered `_<slug>_<n>`, or is `_<slug>` when it is
 * the pattern's only line. A marker already in the code (a pattern saved mid-mix) is dropped and its cued lines are
 * prefixed again like any others. Setup lines, comments and continuations are kept as they are.
 */
export function cueBlock(pattern: { name: string; cpm: number; code: string }): string {
  const slug = slugOf(pattern.name);
  const lines = patternLines(pattern.code);
  const starts = new Map(lines.map((l) => [l.firstLine, l]));
  const single = lines.length === 1 && lines[0].label === null;
  let unlabelled = 0;
  const out: string[] = [];
  pattern.code.split('\n').forEach((text, i) => {
    if (text.trim() === '' || text.trim().startsWith(MARKER) || TEMPO.test(text)) return;
    const line = starts.get(i);
    if (!line) {
      out.push(text);
      return;
    }
    if (line.label !== null) {
      out.push(text.replace(/^(\s*)_?[\w$]+:/, `$1_${slug}_${line.label}:`));
      return;
    }
    const name = single ? `_${slug}` : `_${slug}_${++unlabelled}`;
    out.push(/^\s*\$:/.test(text) ? text.replace(/^(\s*)\$:/, `$1${name}:`) : text.replace(/^(\s*)/, `$1${name}: `));
  });
  return [`${MARKER}${pattern.name} · ${pattern.cpm} cpm · its lines are on the home row · Go finishes, Clear drops`, ...out].join('\n');
}

/**
 * `code` with `block` appended after exactly one blank line, touching nothing already there. Code that ends in a
 * newline gets one after the block too, so the two cases stay apart and `clearCode` gives back the very same text.
 */
export function appendCue(code: string, block: string): string {
  return code.endsWith('\n') ? `${code}\n${block}\n` : `${code}\n\n${block}`;
}

/** A deck's cued pattern, read back from its code: the marker line and the pattern lines under it that carry the slug. */
export interface Cue { name: string; cpm: number | null; slug: string; markerLine: number; markerFrom: number; markerTo: number; lines: PatternLine[] }

/** The marker line `cueBlock` writes. The name is greedy so a ` · ` inside it survives. */
const MARKER_LINE = /^\/\/ cued: (.*) · (\d+(?:\.\d+)?) cpm · /;

/**
 * The cue in `code`, or null when there is no marker. The first marker wins. A marker someone edited by hand still
 * counts: its name is the rest of the line and its cpm is null. The cued lines are the pattern lines below the marker
 * whose label is the slug or starts with it, so a hand-typed line with the prefix joins the cue and one without stays
 * the deck's own.
 */
export function cueOf(code: string): Cue | null {
  const physical = code.split('\n');
  const markerLine = physical.findIndex((l) => l.trim().startsWith(MARKER));
  if (markerLine < 0) return null;
  const text = physical[markerLine].trim();
  const m = MARKER_LINE.exec(text);
  const name = m ? m[1] : text.slice(MARKER.length).trim();
  const slug = slugOf(name);
  const markerFrom = physical.slice(0, markerLine).reduce((at, l) => at + l.length + 1, 0);
  const lines = patternLines(code).filter(
    (l) => l.firstLine > markerLine && l.label !== null && (l.label === slug || l.label.startsWith(`${slug}_`)),
  );
  return { name, cpm: m ? Number(m[2]) : null, slug, markerLine, markerFrom, markerTo: markerFrom + physical[markerLine].length, lines };
}

/** A cued line's label without the slug prefix (the bare slug stays as it is): what its key cap shows. */
export function cuedLabel(cue: Cue, line: PatternLine): string {
  const label = line.label ?? '';
  return label.startsWith(`${cue.slug}_`) ? label.slice(cue.slug.length + 1) : label;
}

/**
 * Whether a cue can mix into `code`: every own pattern line (those not cued) is labelled or `$:`. A bare expression
 * plays only while nothing is labelled, so the first cued pad switched on would drop it out.
 */
export function canCue(code: string): boolean {
  const physical = code.split('\n');
  const cued = new Set(cueOf(code)?.lines.map((l) => l.firstLine));
  return patternLines(code).every((l) => cued.has(l.firstLine) || l.label !== null || physical[l.firstLine].trim().startsWith('$:'));
}

/**
 * The deck's cue source when it is still the pattern the marker names, else null: a Cmd+Z of a cue, a snapshot
 * recall or a reload from disk can leave the source pointing at a pattern that is no longer the cued one.
 */
export function cueSourceFor<S extends { pattern: { name: string } }>(cue: Cue, source: S | null): S | null {
  return source && source.pattern.name === cue.name ? source : null;
}

/** True once any cued line is switched on. */
export function cueSounding(cue: Cue): boolean {
  return cue.lines.some((l) => !l.muted);
}

/** Marks `line`'s physical lines for dropping, and the `//` comment lines directly above it (no blank between). */
function dropLine(drop: Set<number>, physical: string[], line: PatternLine, floor: number): void {
  for (let i = line.firstLine; i <= line.lastLine; i++) drop.add(i);
  for (let i = line.firstLine - 1; i > floor && physical[i].trim().startsWith('//'); i--) drop.add(i);
}

/** The lines left after dropping and replacing, with leading and trailing blank lines cut and runs of blank lines folded to one. */
function assemble(physical: string[], drop: Set<number>, replace: Map<number, string>): string {
  const kept = physical.flatMap((text, i) => (drop.has(i) ? [] : [replace.get(i) ?? text]));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}

/**
 * The deck's code with the cue taken out: the marker, the blank line directly above it, the cued lines and the
 * comments that came with them. Nothing else is touched, so a cue then a Clear gives back the text as it was.
 */
export function clearCode(code: string, cue: Cue): string {
  const physical = code.split('\n');
  const drop = new Set([cue.markerLine]);
  if (cue.markerLine > 0 && physical[cue.markerLine - 1].trim() === '') drop.add(cue.markerLine - 1);
  for (const line of cue.lines) dropLine(drop, physical, line, cue.markerLine);
  return physical.filter((_, i) => !drop.has(i)).join('\n');
}

/**
 * The deck's code once the cued pattern takes over: the deck's own pattern lines (and their comments) and the marker
 * are gone, and the cued lines lose their slug prefix. A line keeps whether it was muted; a numbered or bare-slug line
 * that is switched on becomes `$:`, and a still-muted one is left as it is.
 */
export function goCode(code: string, cue: Cue): string {
  const physical = code.split('\n');
  const drop = new Set([cue.markerLine]);
  const replace = new Map<number, string>();
  const cued = new Set(cue.lines.map((l) => l.firstLine));
  for (const line of patternLines(code)) {
    if (!cued.has(line.firstLine)) {
      dropLine(drop, physical, line, -1);
      continue;
    }
    const label = line.label ?? '';
    const rest = label.startsWith(`${cue.slug}_`) ? label.slice(cue.slug.length + 1) : '';
    const text = physical[line.firstLine];
    if (rest !== '' && !/^\d+$/.test(rest)) {
      replace.set(line.firstLine, text.replace(/^(\s*)_?[\w$]+:/, `$1${line.muted ? '_' : ''}${rest}:`));
    } else if (!line.muted) {
      replace.set(line.firstLine, text.replace(/^(\s*)_?[\w$]+:/, '$1$:'));
    }
  }
  return assemble(physical, drop, replace);
}
