import { patternLines, type PatternLine } from './lines';
import { applyEdits, flipMute, type Edit } from './press';

/**
 * How a fill meets the track: `inject` plays it over everything, `switch` mutes the deck's drum lines while it
 * plays (the fill takes their place) and brings them back after.
 */
export type FillMode = 'inject' | 'switch';

/** One fill in the catalogue: a single Strudel expression that runs for `bars` bars from a bar line. */
export interface Fill {
  id: string;
  name: string;
  bars: number;
  /** What the panel and a key offer first. */
  mode: FillMode;
  code: string;
  about: string;
}

/**
 * The fills the booth ships. Each is one expression on the 909 (the rip's kit), written so its first bar is the
 * first `<...>` step and any ramp starts at the bottom: `fillLine` aligns a fill longer than a bar to the bar it
 * lands on, so it always plays from its start.
 */
export const FILLS: readonly Fill[] = [
  {
    id: 'snare_roll',
    name: 'Snare roll',
    bars: 2,
    mode: 'inject',
    code: 's("<sd*8 [sd*8 sd*16]>").bank("tr909").gain(saw.range(0.2, 0.7).slow(2)).hpf(saw.range(200, 1500).slow(2))',
    about: 'the build-up: 8ths, then 16ths, then 32nds, rising',
  },
  {
    id: 'long_roll',
    name: 'Long build',
    bars: 4,
    mode: 'inject',
    code: 's("<sd*4 sd*8 sd*16 [sd*16 sd*32]>").bank("tr909").gain(saw.range(0.15, 0.7).slow(4)).hpf(saw.range(150, 2000).slow(4))',
    about: 'four bars of snare doubling up into the drop',
  },
  {
    id: 'kick_build',
    name: 'Kick build',
    bars: 2,
    mode: 'switch',
    code: 's("<bd*4 [bd*8 bd*16]>").bank("tr909").gain(0.65).lpf(saw.range(400, 8000).slow(2))',
    about: 'the kick alone, doubling and opening up',
  },
  {
    id: 'clap_fill',
    name: 'Clap fill',
    bars: 1,
    mode: 'inject',
    code: 's("[~ cp] [~ cp] [cp cp] [cp*4]").bank("tr909").gain(0.5)',
    about: 'off-beat claps into a roll on beat 4',
  },
  {
    id: 'tom_fill',
    name: 'Tom fill',
    bars: 1,
    mode: 'inject',
    code: 's("~ ~ [ht ht mt mt] [lt lt lt lt]").bank("tr909").gain(0.55)',
    about: 'toms high to low over the last two beats',
  },
  {
    id: 'hat_roll',
    name: 'Hat roll',
    bars: 1,
    mode: 'inject',
    code: 's("hh*16").bank("tr909").gain(saw.range(0.1, 0.4))',
    about: '16th hats swelling over the bar',
  },
  {
    id: 'riser',
    name: 'Riser',
    bars: 2,
    mode: 'inject',
    code: 's("white*16").gain(saw.range(0.02, 0.2).slow(2)).hpf(saw.range(500, 8000).slow(2))',
    about: 'white noise sweeping up',
  },
  {
    id: 'half_time',
    name: 'Half time',
    bars: 2,
    mode: 'switch',
    code: 's("[bd ~ ~ ~ ~ ~ ~ ~], [~ ~ ~ ~ sd ~ ~ ~], [~ hh]*4").bank("tr909").gain(0.55)',
    about: 'the drums at half speed',
  },
  {
    id: 'drop',
    name: 'Drop out',
    bars: 1,
    mode: 'switch',
    code: 'silence',
    about: 'the drums cut for a bar',
  },
  {
    id: 'crash',
    name: 'Crash',
    bars: 1,
    mode: 'inject',
    code: 's("cr").bank("tr909").gain(0.45)',
    about: 'a crash on the one',
  },
];

export const fillById = (id: string): Fill | undefined => FILLS.find((f) => f.id === id);

/** A fill block's first line: the deck's code says a fill is playing and what it muted. */
export const FILL_MARKER = '// fill: ';
const MUTING = ' · muting ';
/** The fill's own line label; one fill at a time per deck. */
export const FILL_LABEL = 'fill';

/** Drum names a `s("...")` mini-notation may use; a line playing any of them is a drum line. */
const DRUMS = new Set(['bd', 'sd', 'cp', 'hh', 'oh', 'rim', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'sh', 'perc', 'tb']);
const SOUND_STRING = /\b(?:s|sound)\(\s*(["'`])([^"'`]*)\1/g;

/** Whether a line's text plays drums: an `s()`/`sound()` string naming a drum (`bd:3`, `[~ cp]*2` and the like). */
export function isDrumLine(text: string): boolean {
  for (const m of text.matchAll(SOUND_STRING)) {
    if (m[2].split(/[^a-z0-9_]+/i).some((w) => DRUMS.has(w.replace(/_\d+$/, '').toLowerCase()))) return true;
  }
  return false;
}

/** A fill as the code carries it: the marker, its line, and the labels it muted. */
export interface FillBlock {
  name: string;
  /** Document offsets of the marker line's start and the fill line's end. */
  from: number;
  to: number;
  muted: string[];
}

/** The fill block in `code`: a marker comment directly above a `fill:` line; null when there is none. */
export function fillOf(code: string): FillBlock | null {
  const at = code.indexOf('\n' + FILL_MARKER) + 1 || (code.startsWith(FILL_MARKER) ? 0 : -1);
  if (at < 0) return null;
  const markerEnd = code.indexOf('\n', at);
  if (markerEnd < 0) return null;
  const line = patternLines(code).find((l) => l.from === markerEnd + 1);
  if (!line || line.label !== FILL_LABEL) return null;
  const marker = code.slice(at + FILL_MARKER.length, markerEnd);
  const [head, muting] = marker.split(MUTING);
  return {
    name: head.split(' · ')[0],
    from: at,
    to: line.to,
    muted: muting ? muting.split(' · ')[0].split(/,\s*/).map((s) => s.trim()).filter(Boolean) : [],
  };
}

/**
 * The fill's line: its code, shifted with `.late(k)` when it is longer than a bar and lands on a bar that is not a
 * multiple of its length, so its first bar plays first (`<...>` and `.slow(n)` count from cycle 0).
 */
export function fillLine(fill: Fill, landing: number): string {
  const k = ((Math.round(landing) % fill.bars) + fill.bars) % fill.bars;
  return `${FILL_LABEL}: ${fill.code}${k ? `.late(${k})` : ''}`;
}

/** The deck's unmuted drum lines that a switch mutes: labelled, not the fill's own. */
function drumLines(code: string, lines: PatternLine[]): PatternLine[] {
  return lines.filter((l) => l.label !== null && l.label !== FILL_LABEL && !l.muted && isDrumLine(code.slice(l.from, l.to)));
}

/**
 * `code` with `fill` playing from cycle `landing`: any fill already there is taken out first (its mutes restored),
 * a switch mutes the drum lines, and the block goes at the end. Taking it out again with `withoutFill` gives back
 * the code as it was, so the deck does not show as changed once the fill is over.
 */
export function withFill(code: string, fill: Fill, mode: FillMode, landing: number): string {
  let base = withoutFill(code);
  const muted: string[] = [];
  if (mode === 'switch') {
    const edits: Edit[] = [];
    for (const l of drumLines(base, patternLines(base))) {
      const o = flipMute(base, l);
      if (o.ok) {
        edits.push(...o.edits);
        muted.push(l.label!);
      }
    }
    base = applyEdits(base, edits);
  }
  const marker = `${FILL_MARKER}${fill.name} · ${fill.bars} bar${fill.bars > 1 ? 's' : ''} · ${mode}` +
    (muted.length ? `${MUTING}${muted.join(', ')}` : '') + ' · goes out on its own';
  const block = `${marker}\n${fillLine(fill, landing)}`;
  return base.endsWith('\n') ? `${base}${block}\n` : `${base}\n${block}`;
}

/** `code` with its fill taken out and the lines it muted (still muted) unmuted; `code` itself when it has none. */
export function withoutFill(code: string): string {
  const b = fillOf(code);
  if (!b) return code;
  const out = b.to < code.length && code[b.to] === '\n' ? code.slice(0, b.from) + code.slice(b.to + 1) : code.slice(0, Math.max(0, b.from - 1)) + code.slice(b.to);
  const edits: Edit[] = [];
  const lines = patternLines(out);
  for (const label of b.muted) {
    const l = lines.find((x) => x.label === label);
    if (!l || !l.muted) continue;
    const o = flipMute(out, l);
    if (o.ok) edits.push(...o.edits);
  }
  return applyEdits(out, edits);
}
