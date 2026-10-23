import type { Block, Lesson } from './lessons';

/**
 * The workshop's sounds that the booth does not ship (it is offline, with drum machines and synths only),
 * and what plays in their place. Swapped in code, never in prose.
 */
export const SOUND_SWAPS: Record<string, string> = {
  piano: 'triangle',
  casio: 'rim',
  jazz: 'lt',
  metal: 'mt',
  insect: 'ht',
  wind: 'oh',
  east: 'cp',
  crow: 'rd',
  space: 'cr',
  numbers: 'sd',
  perc: 'rim',
  gm_acoustic_bass: 'sawtooth',
  gm_synth_bass_1: 'sawtooth',
  gm_xylophone: 'triangle',
  gm_electric_guitar_muted: 'square',
  gm_accordion: 'sawtooth',
  gm_synth_strings_1: 'supersaw',
  gm_voice_oohs: 'sine',
  gm_blown_bottle: 'supersaw',
};

/** The workshop's drum machines that the booth does not ship, and the bundled one that stands in. */
export const BANK_SWAPS: Record<string, string> = {
  AkaiLinn: 'LinnDrum',
  RhythmAce: 'RolandTR606',
  ViscoSpaceDrum: 'BossDR110',
  RolandCompurhythm1000: 'RolandTR606',
  CasioRZ1: 'EmuSP12',
};

/** The list of sound names the first chapter asks to try, as the booth's names. */
const SOUND_LIST = 'bd sd rim hh oh cp lt mt ht cr rd';

/** Swaps the unshipped sounds in a piece of code; a synth swapped for a GM sound drops its `:n` variant. */
export function swapSounds(code: string): string {
  return code
    .replace(/\b(gm_[a-z0-9_]+|[a-z]+)(:\d+)?\b/g, (whole, name: string, variant = '') => {
      const swap = SOUND_SWAPS[name];
      if (!swap) return whole;
      return name.startsWith('gm_') ? swap : swap + variant;
    })
    .replace(/\b[A-Z][A-Za-z0-9]+\b/g, (name) => BANK_SWAPS[name] ?? name);
}

/** Swaps sounds inside `code` spans only, so prose keeps its words. */
const swapInline = (text: string) => text.replace(/`([^`]*)`/g, (_, code: string) => '`' + swapSounds(code) + '`');

/** The text of a MiniRepl's `tune` prop (a template literal or a quoted string) and where the prop ends in `tag`. */
function tuneOf(tag: string): { code: string; end: number } | null {
  const template = /tune=\{`((?:[^`\\]|\\.)*)`\}/.exec(tag);
  if (template) return { code: template[1].replace(/\\([`$\\])/g, '$1'), end: template.index + template[0].length };
  const quoted = /tune=\{'((?:[^'\\]|\\.)*)'\}/.exec(tag) ?? /tune=\{"((?:[^"\\]|\\.)*)"\}/.exec(tag);
  if (!quoted) return null;
  return { code: quoted[1].replace(/\\n/g, '\n').replace(/\\(.)/g, '$1'), end: quoted.index + quoted[0].length };
}

/** Trims a tune's indentation (template literals in the MDX are indented to their tag). */
function dedent(code: string): string {
  const lines = code.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => /^ */.exec(l)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}

const EXAMPLE = (i: number) => `@@example ${i}@@`;
const EXAMPLE_RE = /@@example (\d+)@@/;

/**
 * Replaces each `<MiniRepl … />` with a placeholder, returning the text and the codes in order. A tag that
 * plays a list of tunes (the intro's showcase) is dropped.
 */
function lift(mdx: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  let text = '';
  let rest = mdx;
  for (let at = rest.indexOf('<MiniRepl'); at >= 0; at = rest.indexOf('<MiniRepl')) {
    text += rest.slice(0, at);
    const tag0 = rest.slice(at);
    // Only this tag's text is searched for its tune, never the next tag's.
    const next = tag0.indexOf('<MiniRepl', 1);
    const tune = tuneOf(next < 0 ? tag0 : tag0.slice(0, next));
    // The tag ends at the first `/>` after its tune (its other props hold arrows, so not any `>`).
    const end = tag0.indexOf('/>', tune?.end ?? 0);
    if (end < 0) throw new Error('unclosed MiniRepl');
    if (tune) {
      text += EXAMPLE(codes.length);
      codes.push(dedent(swapSounds(tune.code)));
    }
    rest = tag0.slice(end + 2);
  }
  return { text: text + rest, codes };
}

/** Markdown that only works on the website: images, raw HTML, line breaks; escaped table characters. */
function clean(text: string): string {
  return text
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/<img[^>]*>/g, '')
    .replace(/<a [^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/<div[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/\\([[\]<>*~|])/g, '$1')
    .trim();
}

/** A table row's cells, the outer pipes dropped. */
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => clean(c.trim()));

/** Markdown (with example placeholders and Box / QA tags) to blocks. */
function parse(text: string, codes: string[]): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;
  const example = (line: string): Block | null => {
    const m = EXAMPLE_RE.exec(line);
    return m && line.trim() === m[0] ? { kind: 'example', code: codes[Number(m[1])] } : null;
  };
  /** Lines up to the closing tag, honouring nesting of the same tag. */
  const until = (close: string): string => {
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== close) body.push(lines[i++]);
    i++;
    return body.join('\n');
  };
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (!t) {
      i++;
      continue;
    }
    if (t === '<Box>') {
      i++;
      const inner = parse(until('</Box>'), codes);
      if (inner.length) blocks.push({ kind: 'box', blocks: inner });
      continue;
    }
    const qa = /^<QA q="([^"]*)"/.exec(t);
    if (qa) {
      i++;
      blocks.push({ kind: 'solution', question: qa[1], blocks: parse(until('</QA>'), codes) });
      continue;
    }
    if (t.startsWith('```')) {
      i++;
      let body = until('```');
      if (/\bcasio\b/.test(body)) body = SOUND_LIST;
      blocks.push({ kind: 'pre', text: swapSounds(body.trim()) });
      continue;
    }
    const ex = example(line);
    if (ex) {
      blocks.push(ex);
      i++;
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(t);
    if (heading) {
      blocks.push({ kind: 'heading', text: swapInline(clean(heading[2])) });
      i++;
      continue;
    }
    if (t.startsWith('|')) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      // The first row is the header and the second its rule; each other row is a labelled example.
      for (const row of rows.slice(2)) {
        const parts = cells(row);
        const codeCell = parts.findIndex((c) => EXAMPLE_RE.test(c));
        const label = parts
          .map((c) => c.replace(EXAMPLE_RE, '').trim())
          .filter(Boolean)
          .join(' · ');
        if (codeCell < 0) blocks.push({ kind: 'text', text: swapInline(label) });
        else blocks.push({ kind: 'example', code: codes[Number(EXAMPLE_RE.exec(parts[codeCell])![1])], label: swapInline(label) });
      }
      continue;
    }
    const listItem = /^(?:[-*]|\d+\.)\s+/;
    if (listItem.test(t)) {
      const ordered = /^\d+\./.test(t);
      const items: string[] = [];
      // A list may be loose (blank lines between items); it runs until a line that is neither item nor blank.
      while (i < lines.length) {
        const l = lines[i].trim();
        if (listItem.test(l)) items.push(l.replace(listItem, ''));
        else if (l && !EXAMPLE_RE.test(l) && items.length && /^\s/.test(lines[i])) items[items.length - 1] += ' ' + l;
        else if (l) break;
        i++;
      }
      blocks.push({ kind: 'list', ordered, items: items.map((s) => (/^[a-z0-9_]+$/.test(s) ? swapSounds(s) : swapInline(clean(s)))) });
      continue;
    }
    // A paragraph: lines up to a blank or the start of another block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (!l || l.startsWith('<') || l.startsWith('|') || l.startsWith('#') || l.startsWith('```') || EXAMPLE_RE.test(l))
        break;
      para.push(l);
      i++;
    }
    if (!para.length) {
      i++; // a stray tag line
      continue;
    }
    const prose = clean(para.join(' '));
    if (prose) blocks.push({ kind: 'text', text: swapInline(prose) });
  }
  return blocks;
}

/** One workshop page to a lesson: its `# ` heading is the title; front matter and imports go. */
export function convertLesson(id: string, mdx: string): Lesson {
  const body = mdx
    .replace(/^---[\s\S]*?---\s*/, '')
    .replace(/^import .*$/gm, '')
    // Website-only markup that may span lines: MDX comments, image credits, layout divs.
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<a [^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/<div[^>]*>[\s\S]*?<\/div>|<div[^>]*\/>/g, '');
  const { text, codes } = lift(body);
  const blocks = parse(text, codes);
  const first = blocks.findIndex((b) => b.kind === 'heading');
  const title = first >= 0 ? (blocks.splice(first, 1)[0] as { text: string }).text : id;
  return { id, title, blocks };
}
