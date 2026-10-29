import { patternLines, type PatternLine } from './lines';

// A key flush changes a line; Strudel only hears it at the line's next note, and a chord lasts a bar. The deck
// re-strikes instead: the line's notes already handed to superdough in the old form are taken back, and its long
// notes that are ringing are cut and struck again in the new form. See docs/superpowers/specs/2026-10-29-restrike-design.md.

/** How far ahead of the audio clock a re-strike lands, so its first note is never in the past. */
export const RESTRIKE_LEAD = 0.03;
/** A cut's fade, in seconds: short enough to feel instant, long enough not to click. */
export const CUT_FADE = 0.008;
/** A ringing note is struck again only when it is pitched, at least this long (cycles) ... */
export const LONG_CYCLES = 1 / 8;
/** ... and has at least this much (cycles) left: a drum hit, or a note about to end anyway, is left alone. */
export const MIN_REST_CYCLES = 1 / 16;

/** The slice of a Strudel hap the re-strike reads. */
export interface HapLike {
  whole?: { begin: { valueOf(): number }; end: { valueOf(): number } } | null;
  value: unknown;
  /** The heard length in cycles, after `.clip`/`.legato` and `.duration`; the whole's span when absent. */
  duration?: { valueOf(): number };
  context?: { locations?: { start: number; end: number }[]; onTrigger?: unknown; dominantTrigger?: boolean };
  hasOnset(): boolean;
}

/** The slice of an AudioParam a cut drives. */
interface ParamLike {
  value: number;
  cancelScheduledValues(t: number): unknown;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
}

/** A voice superdough built for a hap of a labelled line; `begin`/`end` are audio seconds, without the release. */
export interface Voice {
  label: string;
  begin: number;
  end: number;
  /** The hap's heard length in cycles. */
  cycles: number;
  pitched: boolean;
  post: { gain: ParamLike };
}

/** A hap to play: at audio time `t`, for `duration` seconds. */
export interface Strike<H extends HapLike = HapLike> { hap: H; t: number; duration: number }

/** Whether a hap's sound has a pitch, so striking it again mid-note is a re-attack rather than an extra hit. */
export const isPitched = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && ('note' in value || 'freq' in value);

/** The label of the line a hap came from, by its first mini-notation location in the code `lines` were read from. */
export function labelOf(hap: HapLike, lines: PatternLine[]): string | null {
  const at = hap.context?.locations?.[0]?.start;
  if (at === undefined) return null;
  return lines.find((l) => at >= l.from && at <= l.to)?.label ?? null;
}

/** The labels whose line differs between `before` and `after`: its text or mute changed, or it came or went. */
export function changedLabels(before: string, after: string): Set<string> {
  const text = (code: string) => {
    const out = new Map<string, string>();
    for (const l of patternLines(code)) if (l.label !== null) out.set(l.label, (l.muted ? '_' : '') + code.slice(l.from, l.to).trim());
    return out;
  };
  const a = text(before);
  const b = text(after);
  const out = new Set<string>();
  for (const [label, t] of a) if (b.get(label) !== t) out.add(label);
  for (const label of b.keys()) if (!a.has(label)) out.add(label);
  return out;
}

/** The voices of live lines, as the deck's output hands them to superdough; ended ones are dropped as new ones come. */
export class Voices {
  private list: Voice[] = [];

  add(v: Voice, now: number): void {
    this.list = this.list.filter((x) => x.end > now);
    this.list.push(v);
  }

  /** Still sounding (or still to start) at `t`. */
  live(t: number): Voice[] {
    return this.list.filter((v) => v.end > t);
  }

  /** Forgets cut voices, so a second cut cannot read their gain before the first fade and raise them again. */
  remove(cut: Voice[]): void {
    this.list = this.list.filter((v) => !cut.includes(v));
  }

  clear(): void {
    this.list = [];
  }
}

const long = (pitched: boolean, cycles: number, restCycles: number) =>
  pitched && cycles >= LONG_CYCLES && restCycles >= MIN_REST_CYCLES;

export interface RestrikeInput<H extends HapLike> {
  labels: ReadonlySet<string>;
  voices: Voice[];
  /** The new pattern's haps over [c0, max(c0, end)], each with its line's label. */
  haps: { hap: H; label: string | null }[];
  t0: number;
  c0: number;
  /** The cycle Cyclist had queried up to when the new pattern took over: onsets from here on are still its to play. */
  end: number;
  cps: number;
  /** Audio seconds of cycle `c` on this deck's clock. */
  toSeconds: (c: number) => number;
}

/**
 * What a re-strike does at `t0` for the changed lines: which tracked voices to cut, and which of the new
 * pattern's haps to play. A voice starting at or after `t0` was handed over in the old form: it is cut and its
 * new form (if any) plays at its own time. A long note ringing at `t0` is cut and its new form struck at `t0` for
 * the rest of its length. Anything short that is already sounding is left to finish.
 */
export function planRestrike<H extends HapLike>(input: RestrikeInput<H>): { cut: Voice[]; play: Strike<H>[] } {
  const { labels, t0, c0, end, cps, toSeconds } = input;
  const cut = input.voices.filter(
    (v) => labels.has(v.label) && v.end > t0 && (v.begin >= t0 || long(v.pitched, v.cycles, (v.end - t0) * cps)),
  );
  const play: Strike<H>[] = [];
  for (const { hap, label } of input.haps) {
    // A hap a trigger hook sends elsewhere (.midi()) never reached superdough, so it is not struck there either.
    if (label === null || !labels.has(label) || !hap.whole || (hap.context?.onTrigger && hap.context.dominantTrigger)) continue;
    const begin = hap.whole.begin.valueOf();
    // Where the note is heard to stop, as Cyclist plays it: a clipped chord can be silent before its whole ends.
    const length = hap.duration?.valueOf() ?? hap.whole.end.valueOf() - begin;
    const stop = begin + length;
    if (begin >= c0) {
      if (begin < end && hap.hasOnset()) play.push({ hap, t: toSeconds(begin), duration: length / cps });
    } else if (stop > c0 && long(isPitched(hap.value), length, stop - c0)) {
      play.push({ hap, t: t0, duration: (stop - c0) / cps });
    }
  }
  return { cut, play };
}

/** Ramps each voice's last gain to silence from `t0`; one not yet started never sounds. */
export function cutVoices(voices: Voice[], t0: number): void {
  for (const v of voices) {
    const g = v.post.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(g.value, t0);
    g.linearRampToValueAtTime(0, t0 + CUT_FADE);
  }
}
