/** How long a key must stay down before a press counts as a hold rather than a tap. */
export const HOLD_MS = 250;

export type PressEvent =
  | { type: 'press'; slot: string }
  | { type: 'release'; slot: string; held: boolean };

/**
 * Tracks keydown/keyup per slot against an injected clock, so tap-versus-hold
 * is decided here as pure state and tests need no timers. Auto-repeat keydowns
 * and a keyup with no keydown are ignored, since the OS can produce both.
 */
export class PressTracker {
  private readonly downAt = new Map<string, number>();

  constructor(
    private readonly now: () => number,
    private readonly holdMs: number = HOLD_MS,
  ) {}

  /** Null when the slot is already down: that is key repeat, not a new press. */
  down(slot: string): PressEvent | null {
    if (this.downAt.has(slot)) return null;
    this.downAt.set(slot, this.now());
    return { type: 'press', slot };
  }

  /** `held` is true once the key has been down for at least `holdMs`. */
  up(slot: string): PressEvent | null {
    const at = this.downAt.get(slot);
    if (at === undefined) return null;
    this.downAt.delete(slot);
    return { type: 'release', slot, held: this.now() - at >= this.holdMs };
  }

  /**
   * Forget every key at once, for window blur when keyups will never arrive.
   * The caller treats each returned slot as a held release so auditions revert.
   */
  cancelAll(): string[] {
    const slots = [...this.downAt.keys()];
    this.downAt.clear();
    return slots;
  }
}
