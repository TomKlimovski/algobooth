import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyQueue, waitSeconds, type QueueDeck } from './quantise';
import type { Quantise } from './bindings';

/** A Cyclist-like scheduler: `now` in cycles, zero clock lead unless asked. */
function fakeDeck(o: { started?: boolean; cps?: number; now?: number; lead?: { duration?: number; minLatency?: number } } = {}): QueueDeck {
  return {
    scheduler: {
      started: o.started ?? true,
      cps: o.cps ?? 0.5,
      now: () => o.now ?? 0,
      clock: o.lead ?? { duration: 0, minLatency: 0 },
    },
  };
}

describe('waitSeconds', () => {
  it('waits to the next bar, beat, or not at all', () => {
    const d = fakeDeck({ now: 0.25 });
    expect(waitSeconds(d, 'bar')).toBeCloseTo(1.5);
    expect(waitSeconds(d, 'beat')).toBeCloseTo(0.5);
    expect(waitSeconds(d, 'now')).toBe(0);
  });
  it('on a bar line waits a full bar, like secondsToNextBoundary', () => {
    expect(waitSeconds(fakeDeck({ now: 1 }), 'bar')).toBeCloseTo(2);
  });
  it('subtracts the clock lead, and never goes negative', () => {
    expect(waitSeconds(fakeDeck({ now: 0.25, lead: { duration: 0.05, minLatency: 0.01 } }), 'bar')).toBeCloseTo(1.44);
    expect(waitSeconds(fakeDeck({ now: 0.999, lead: { duration: 0.05, minLatency: 0.01 } }), 'bar')).toBe(0);
  });
  it('falls back to the default lead without a clock', () => {
    const d = fakeDeck({ now: 0.25 });
    d.scheduler.clock = undefined;
    expect(waitSeconds(d, 'bar')).toBeCloseTo(1.44);
  });
});

describe('KeyQueue', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = (deck: QueueDeck | null, q: Quantise = 'bar') => {
    const flushed: Array<Array<() => void>> = [];
    const queue = new KeyQueue(() => deck, (jobs) => flushed.push(jobs), { quantise: () => q });
    return { queue, flushed };
  };

  it('arms once and flushes all jobs in order at the boundary', () => {
    const { queue, flushed } = make(fakeDeck({ now: 0.25 }));
    const a = vi.fn(), b = vi.fn();
    queue.push(a);
    vi.advanceTimersByTime(1000);
    queue.push(b);
    expect(queue.pending).toBe(2);
    vi.advanceTimersByTime(499);
    expect(flushed).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(flushed).toEqual([[a, b]]);
    expect(queue.pending).toBe(0);
    expect(queue.secondsLeft()).toBeNull();
  });

  it('flushes synchronously on a stopped deck, or none', () => {
    for (const deck of [fakeDeck({ started: false }), null]) {
      const { queue, flushed } = make(deck);
      const a = vi.fn();
      queue.push(a);
      expect(flushed).toEqual([[a]]);
    }
  });

  it('flushes synchronously for quantise now, including what was pending', () => {
    let q: Quantise = 'bar';
    const flushed: Array<Array<() => void>> = [];
    const queue = new KeyQueue(() => fakeDeck(), (j) => flushed.push(j), { quantise: () => q });
    const a = vi.fn(), b = vi.fn();
    queue.push(a);
    q = 'now';
    queue.push(b);
    expect(flushed).toEqual([[a, b]]);
    vi.advanceTimersByTime(10000);
    expect(flushed).toHaveLength(1);
  });

  it('drop discards and clears the timer', () => {
    const { queue, flushed } = make(fakeDeck());
    queue.push(vi.fn());
    queue.drop();
    vi.advanceTimersByTime(10000);
    expect(flushed).toHaveLength(0);
    expect(queue.pending).toBe(0);
    expect(queue.secondsLeft()).toBeNull();
  });

  it('flushNow runs what is queued at once and clears the timer', () => {
    const { queue, flushed } = make(fakeDeck());
    const a = vi.fn();
    queue.push(a);
    queue.flushNow();
    expect(flushed).toEqual([[a]]);
    vi.advanceTimersByTime(10000);
    expect(flushed).toHaveLength(1);
    queue.flushNow(); // idle: nothing to deliver
    expect(flushed).toHaveLength(1);
  });

  it('reports time and beats left', () => {
    const { queue } = make(fakeDeck({ now: 0.25 }));
    expect(queue.beatsLeft()).toBeNull();
    queue.push(vi.fn());
    expect(queue.secondsLeft()).toBeCloseTo(1.5);
    expect(queue.beatsLeft()).toBe(3);
    vi.advanceTimersByTime(500);
    expect(queue.secondsLeft()).toBeCloseTo(1);
    expect(queue.beatsLeft()).toBe(2);
  });

  it('a job pushed during a flush re-arms cleanly', () => {
    const flushed: number[] = [];
    let queue!: KeyQueue;
    queue = new KeyQueue(() => fakeDeck(), (jobs) => { flushed.push(jobs.length); if (flushed.length === 1) queue.push(vi.fn()); }, { quantise: () => 'bar' });
    queue.push(vi.fn());
    vi.advanceTimersByTime(2000);
    expect(queue.pending).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(flushed).toEqual([1, 1]);
  });
});
