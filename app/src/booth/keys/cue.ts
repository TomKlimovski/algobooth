import { patternLines, type PatternLine } from './lines';

/** A cue block's first line: what the deck's code carries to say a second pattern is cued in. */
export const MARKER = '// cued: ';

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
