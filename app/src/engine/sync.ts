import type { DeckApi } from '../booth/Deck';
import type { DeckId } from '../booth/deckState';
import { StartCancelled } from './evalLock';

/**
 * Seconds until the scheduler reaches its next whole cycle. Exactly on a
 * boundary waits a full cycle, so a restart never lands mid-tick.
 */
export function secondsToNextBoundary(nowCycle: number, cps: number): number {
  return (Math.floor(nowCycle) + 1 - nowCycle) / cps;
}

/** Cyclist's clock defaults (zyklus), used when a scheduler does not expose its clock. */
export const DEFAULT_CLOCK_DURATION = 0.05;
export const DEFAULT_MIN_LATENCY = 0.01;

/**
 * The decks' scheduler timing, passed to Strudel's repl (a pnpm patch of `@strudel/core` lets them through to
 * Cyclist). Strudel's defaults tick every 100 ms, query 100 ms past the tick and trigger 100 ms after that, so
 * a key press reached the speakers 200 to 330 ms after its evaluation: sounds already queried under the old
 * pattern still play, and the new pattern's first sound carries the full offset. Here the clock ticks every
 * 50 ms, looks 100 ms past the tick and triggers 50 ms on, which halves that lead. The tick duration stays at
 * Cyclist's 50 ms (`clock.duration`, which `startDelay` and the key queue read). A main-thread stall longer
 * than about 150 ms drops a sound ("cannot schedule sounds in the past") where 200 ms was tolerated before.
 */
export const DECK_CLOCK = { latency: 0.05, clockInterval: 0.05, clockOverlap: 0.1 } as const;

type TimerHandle = ReturnType<typeof setTimeout>;
type SetTimer = (f: () => void, ms: number) => TimerHandle;

export interface SyncOptions {
  /** Called whenever sync sets a deck's cps, so its header can show the effective tempo. */
  onTempoChange?: (deck: DeckId, cps: number) => void;
  clearTimer?: (handle: TimerHandle) => void;
}

/** Which deck leads a sync and which follows it. */
export interface SyncRoles {
  leader: DeckId;
  follower: DeckId;
}

/**
 * Picks the decks' roles when Sync is pressed: the playing deck leads and the stopped one follows, so the
 * stopped deck can be synced and started on the bar, then faded in. With both playing, the deck the crossfader
 * favours (0 is A, 1 is B) is the one being heard, so it leads and the other snaps to its bar; at the centre A
 * leads. With neither playing there is nothing to sync to.
 */
export function syncRoles(started: Record<DeckId, boolean>, fader: number): SyncRoles | null {
  if (!started.A && !started.B) return null;
  const leader: DeckId = started.A && started.B ? (fader > 0.5 ? 'B' : 'A') : started.A ? 'A' : 'B';
  return { leader, follower: leader === 'A' ? 'B' : 'A' };
}

/** A start of B held back until A's next bar line. */
interface Wait {
  resolve: () => void;
  reject: (reason: StartCancelled) => void;
  handle: TimerHandle | null;
}

/**
 * DJ-style sync: deck B follows deck A's tempo and bar line, and latches. A and B here are the roles, the leader
 * and the follower (see `syncRoles`); either booth deck can take either.
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
    if (!a?.scheduler.started) return { ok: false, reason: `Start deck ${a?.id ?? 'A'} first` };
    if (!b) return { ok: false, reason: `Deck ${a.id === 'A' ? 'B' : 'A'} is not ready` };
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
    const held = this.takeWait();
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
    return new Promise<void>((resolve, reject) => {
      this.wait = { resolve, reject, handle: null };
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

  /** Takes the held start (if any) and cancels its timer, leaving the caller to settle it. */
  private takeWait(): Wait | null {
    const w = this.wait;
    if (w?.handle != null) (this.opts.clearTimer ?? clearTimeout)(w.handle);
    this.wait = null;
    return w;
  }

  /**
   * Cancels a held start: its promise rejects with `StartCancelled`, so Cyclist.start() never starts the
   * clock and nothing waiting on that start is left pending.
   */
  private dropWait(): void {
    this.takeWait()?.reject(new StartCancelled());
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

// The audio graph and the Strudel scope are module singletons: a hot update would leave the
// old ones wired in while the UI drives new ones, so a change here reloads the whole page.
if (import.meta.hot) import.meta.hot.accept(() => import.meta.hot?.invalidate());
