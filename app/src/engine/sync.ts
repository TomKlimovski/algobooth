import type { DeckApi } from '../booth/Deck';
import type { DeckId } from '../booth/deckState';

/**
 * Seconds until the scheduler reaches its next whole cycle. Exactly on a
 * boundary waits a full cycle, so a restart never lands mid-tick.
 */
export function secondsToNextBoundary(nowCycle: number, cps: number): number {
  return (Math.floor(nowCycle) + 1 - nowCycle) / cps;
}

/** Cyclist's clock defaults (zyklus), used when a scheduler does not expose its clock. */
const DEFAULT_CLOCK_DURATION = 0.05;
const DEFAULT_MIN_LATENCY = 0.01;

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimer = (f: () => void, ms: number) => TimerHandle;

export interface SyncOptions {
  /** Called whenever sync sets a deck's cps, so its header can show the effective tempo. */
  onTempoChange?: (deck: DeckId, cps: number) => void;
  clearTimer?: (handle: TimerHandle) => void;
}

/** A start of B held back until A's next bar line. */
interface Wait {
  resolve: () => void;
  handle: TimerHandle | null;
}

/**
 * DJ-style sync: deck B follows deck A's tempo and bar line, and latches.
 *
 * Tempo: every eval of either deck re-applies A's cps to B, after B's own
 * `setcpm` ran. Phase: Cyclist has no phase API, but `start()` puts cycle 0 at
 * the moment it starts, so while engaged every start of B (engage's restart,
 * Play, master play) is held in B's `beforeStart` until A's next boundary.
 * When A restarts, it re-anchors to cycle 0, so B is realigned.
 */
export class SyncController {
  private on = false;
  private wait: Wait | null = null;
  private hooked: { a: DeckApi; b: DeckApi; beforeStart: (() => unknown) | undefined } | null = null;
  private readonly follow = () => this.applyTempo();
  private readonly onAToggle = (started: boolean) => {
    if (started) this.realign();
  };
  private readonly onBToggle = (started: boolean) => {
    if (!started) this.dropWait(); // stopped before the bar line: that start is cancelled
  };

  constructor(
    private getA: () => DeckApi | null,
    private getB: () => DeckApi | null,
    private setTimer: SetTimer = setTimeout,
    private opts: SyncOptions = {},
  ) {}

  get engaged(): boolean {
    return this.on;
  }

  engage(): { ok: true } | { ok: false; reason: string } {
    const a = this.getA();
    const b = this.getB();
    if (!a?.scheduler.started) return { ok: false, reason: 'Start deck A first' };
    if (!b) return { ok: false, reason: 'Deck B is not ready' };
    this.on = true;
    this.applyTempo();
    a.afterEval.add(this.follow);
    b.afterEval.add(this.follow);
    a.onToggle.add(this.onAToggle);
    b.onToggle.add(this.onBToggle);
    const beforeStart = b.scheduler.beforeStart;
    this.hooked = { a, b, beforeStart };
    b.scheduler.beforeStart = () => (beforeStart ? Promise.resolve(beforeStart()).then(this.holdB) : this.holdB());
    this.realign();
    return { ok: true };
  }

  /** Turns sync off and re-evaluates B so its own `setcpm` takes effect again. */
  release(): void {
    if (!this.on) return;
    const held = this.wait;
    this.dispose();
    held?.resolve(); // B was waiting for the bar line: let it play now
    void this.getB()?.evaluate();
  }

  /** Turns sync off without touching the decks, for when they are being torn down. */
  dispose(): void {
    this.on = false;
    this.dropWait();
    if (!this.hooked) return;
    const { a, b, beforeStart } = this.hooked;
    a.afterEval.delete(this.follow);
    b.afterEval.delete(this.follow);
    a.onToggle.delete(this.onAToggle);
    b.onToggle.delete(this.onBToggle);
    b.scheduler.beforeStart = beforeStart;
    this.hooked = null;
  }

  /** B's beforeStart while engaged: resolves on A's next boundary, at A's tempo. */
  private readonly holdB = (): Promise<void> | void => {
    if (!this.getA()?.scheduler.started) return; // nothing to lock to yet
    this.applyTempo();
    this.dropWait(); // a second Play replaces the first
    return new Promise<void>((resolve) => {
      this.wait = { resolve, handle: null };
      this.arm();
    });
  };

  /** Restarts a playing B on A's next boundary, or re-arms a waiting one on A's current timeline. */
  private realign(): void {
    const b = this.getB();
    if (this.wait) {
      this.arm();
    } else if (b?.scheduler.started) {
      b.scheduler.stop();
      b.scheduler.start().catch(() => {});
    }
  }

  private arm(): void {
    const w = this.wait;
    const a = this.getA();
    const b = this.getB();
    if (!w || !a || !b) return;
    if (w.handle !== null) (this.opts.clearTimer ?? clearTimeout)(w.handle);
    const setTimer = this.setTimer; // unbound: window.setTimeout rejects another `this`
    w.handle = setTimer(() => {
      if (this.wait !== w) return; // dropped or replaced meanwhile
      this.wait = null;
      w.resolve();
    }, startDelay(a, b) * 1000);
  }

  /** Forgets a held start. Its promise never settles, so that Cyclist.start() never starts the clock. */
  private dropWait(): void {
    if (this.wait?.handle != null) (this.opts.clearTimer ?? clearTimeout)(this.wait.handle);
    this.wait = null;
  }

  private applyTempo(): void {
    const a = this.getA();
    const b = this.getB();
    if (!a || !b) return;
    b.setCps(a.scheduler.cps);
    this.opts.onTempoChange?.(b.id, a.scheduler.cps);
  }
}

/**
 * Seconds from now until B should call `clock.start()` so its cycle 0 lands on
 * A's next boundary. Cyclist's `now()` reports the cycle at `t - clock.duration`,
 * and a starting clock schedules cycle 0 `minLatency` after `t`, so the plain
 * boundary wait is shortened by both; a lead past the boundary takes the next one.
 */
function startDelay(a: DeckApi, b: DeckApi): number {
  const { cps } = a.scheduler;
  const lead =
    (a.scheduler.clock?.duration ?? DEFAULT_CLOCK_DURATION) + (b.scheduler.clock?.minLatency ?? DEFAULT_MIN_LATENCY);
  const wait = secondsToNextBoundary(a.scheduler.now(), cps) - lead;
  return wait > 0 ? wait : wait + 1 / cps;
}
