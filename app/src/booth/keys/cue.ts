import { patternLines } from './lines';

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
