import { DEFAULT_CLOCK_DURATION, DEFAULT_MIN_LATENCY, secondsToNextBoundary } from '../../engine/sync';
import type { Quantise } from './bindings';

/** The slice of a deck the queue reads: a Cyclist-like scheduler. */
export interface QueueDeck {
  scheduler: { started: boolean; cps: number; now(): number; clock?: { duration?: number; minLatency?: number } };
}

/** An edit that re-derives itself from the live code when run, so queued presses never go stale. */
export type Job = () => void;

export interface QueueOptions {
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  /** Read at push time, so a change of quantise applies to the next press. */
  quantise: () => Quantise;
  /** Wall clock in ms for `secondsLeft`; injectable for tests. Defaults to `Date.now`. */
  now?: () => number;
}

/**
 * Seconds until a quantise mode's next boundary on this deck, less the clock lead
 * (duration + minLatency, as sync's `startDelay`). A cycle is a bar and a beat is a quarter of one.
 * Unlike `startDelay`, a lead past the boundary clamps to 0 instead of taking the next one:
 * an edit a few ms early beats one a whole bar late.
 */
export function waitSeconds(deck: QueueDeck, q: Quantise): number {
  if (q === 'now') return 0;
  const { cps, now, clock } = deck.scheduler;
  const cycle = now.call(deck.scheduler);
  const raw = q === 'bar' ? secondsToNextBoundary(cycle, cps) : secondsToNextBoundary(cycle * 4, cps * 4);
  const lead = (clock?.duration ?? DEFAULT_CLOCK_DURATION) + (clock?.minLatency ?? DEFAULT_MIN_LATENCY);
  return Math.max(0, raw - lead);
}

/**
 * Key presses for one deck, held and applied together at the deck's next bar or beat line
 * like a DJ's loop button. A stopped deck, or quantise 'now', applies at once.
 */
export class KeyQueue {
  private jobs: Job[] = [];
  private handle: ReturnType<typeof setTimeout> | null = null;
  private deadline = 0; // ms on `opts.now`'s clock
  private readonly setTimer: typeof setTimeout;
  private readonly clearTimer: typeof clearTimeout;
  private readonly clockMs: () => number;

  constructor(
    private deck: () => QueueDeck | null,
    private onFlush: (jobs: Job[]) => void,
    private opts: QueueOptions,
  ) {
    this.setTimer = opts.setTimer ?? setTimeout;
    this.clearTimer = opts.clearTimer ?? clearTimeout;
    this.clockMs = opts.now ?? Date.now;
  }

  get pending(): number {
    return this.jobs.length;
  }

  /** Adds a job; arms the timer if none. A stopped deck or 'now' flushes synchronously. */
  push(job: Job): void {
    this.jobs.push(job);
    const deck = this.deck();
    const q = this.opts.quantise();
    if (!deck || !deck.scheduler.started || q === 'now') {
      this.flushNow();
      return;
    }
    if (this.handle !== null) return; // already armed: this press lands with the others
    const ms = waitSeconds(deck, q) * 1000;
    this.deadline = this.clockMs() + ms;
    const setTimer = this.setTimer; // unbound: window.setTimeout rejects another `this`
    this.handle = setTimer(() => {
      this.handle = null;
      this.flushNow();
    }, ms);
  }

  /** Seconds until the armed boundary; null when idle. */
  secondsLeft(): number | null {
    return this.handle === null ? null : Math.max(0, (this.deadline - this.clockMs()) / 1000);
  }

  /** Beats until the boundary, rounded up; null when idle. */
  beatsLeft(): number | null {
    const s = this.secondsLeft();
    const deck = this.deck();
    if (s === null || !deck) return null;
    return Math.ceil(s * deck.scheduler.cps * 4);
  }

  /** Takes one job back out before it runs (a cancelled press); idle again once nothing is left. */
  remove(job: Job): boolean {
    const i = this.jobs.indexOf(job);
    if (i < 0) return false;
    this.jobs.splice(i, 1);
    if (this.jobs.length === 0) this.disarm();
    return true;
  }

  /** Whether any queued job satisfies `test`. */
  some(test: (job: Job) => boolean): boolean {
    return this.jobs.some(test);
  }

  /** Stop pressed: the queued edits are discarded. */
  drop(): void {
    this.disarm();
    this.jobs = [];
  }

  /** Play pressed: run what is queued at once. */
  flushNow(): void {
    this.disarm();
    if (this.jobs.length === 0) return;
    const jobs = this.jobs;
    this.jobs = []; // emptied first, so a job that pushes during the flush re-arms cleanly
    this.onFlush(jobs);
  }

  private disarm(): void {
    if (this.handle === null) return;
    const clearTimer = this.clearTimer;
    clearTimer(this.handle);
    this.handle = null;
  }
}
