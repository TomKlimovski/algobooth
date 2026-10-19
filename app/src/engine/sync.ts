import type { DeckApi } from '../booth/Deck';
import type { DeckId } from '../booth/deckState';

/**
 * Seconds until the scheduler reaches its next whole cycle. Exactly on a
 * boundary waits a full cycle, so a restart never lands mid-tick.
 */
export function secondsToNextBoundary(nowCycle: number, cps: number): number {
  return (Math.floor(nowCycle) + 1 - nowCycle) / cps;
}

type SetTimer = (f: () => void, ms: number) => ReturnType<typeof setTimeout>;

export interface SyncOptions {
  /** Called whenever sync sets a deck's cps, so its header can show the effective tempo. */
  onTempoChange?: (deck: DeckId, cps: number) => void;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * DJ-style sync: deck B follows deck A's tempo and starts on A's bar line.
 * Cyclist has no phase API, but `start()` makes cycle 0 begin at that moment,
 * so B is stopped and restarted on A's next cycle boundary. It latches: every
 * eval of either deck re-applies A's cps to B (after B's own `setcpm` ran).
 */
export class SyncController {
  private on = false;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private hooked: DeckApi[] = [];
  private readonly follow = () => this.applyTempo();

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
    for (const deck of [a, b]) deck.afterEval.add(this.follow);
    this.hooked = [a, b];
    if (b.scheduler.started) {
      b.scheduler.stop();
      const wait = secondsToNextBoundary(a.scheduler.now(), a.scheduler.cps);
      const setTimer = this.setTimer; // unbound: window.setTimeout rejects another `this`
      this.pending = setTimer(() => {
        this.pending = null;
        void b.scheduler.start();
      }, wait * 1000);
    }
    return { ok: true };
  }

  release(): void {
    if (!this.on) return;
    this.on = false;
    // Released before the bar line: B was stopped by engage, so bring it back.
    const restartB = this.pending !== null;
    if (this.pending !== null) {
      (this.opts.clearTimer ?? clearTimeout)(this.pending);
      this.pending = null;
    }
    for (const deck of this.hooked) deck.afterEval.delete(this.follow);
    this.hooked = [];
    const b = this.getB();
    void (restartB ? b?.evaluate(true) : b?.evaluate());
  }

  private applyTempo(): void {
    const a = this.getA();
    const b = this.getB();
    if (!a || !b) return;
    b.setCps(a.scheduler.cps);
    this.opts.onTempoChange?.(b.id, a.scheduler.cps);
  }
}
