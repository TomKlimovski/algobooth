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
