import { vi } from 'vitest';
import type { DeckApi } from '../booth/Deck';
import { secondsToNextBoundary, SyncController } from './sync';

function fakeDeck(opts: { id?: 'A' | 'B'; started?: boolean; cps?: number; now?: number } = {}) {
  const scheduler = {
    cps: opts.cps ?? 0.5,
    started: opts.started ?? false,
    now: vi.fn(() => opts.now ?? 0),
    start: vi.fn(async () => {}),
    stop: vi.fn(),
  };
  const deck = {
    id: opts.id ?? 'A',
    evaluate: vi.fn(async () => {}),
    stop: vi.fn(),
    setCode: vi.fn(),
    getCode: vi.fn(() => ''),
    setName: vi.fn(),
    setFile: vi.fn(),
    scheduler,
    setCps: vi.fn((cps: number) => { scheduler.cps = cps; }),
    afterEval: new Set<() => void>(),
  } satisfies DeckApi;
  return deck;
}

test('seconds to the next cycle boundary', () => {
  expect(secondsToNextBoundary(3.25, 0.5)).toBeCloseTo(1.5);
  expect(secondsToNextBoundary(4.0, 2)).toBeCloseTo(0.5); // exactly on a boundary waits a full cycle
});
test('engage refuses when A is stopped (review focus 4)', () => {
  const a = fakeDeck({ started: false }); const b = fakeDeck({ started: false });
  const s = new SyncController(() => a, () => b);
  expect(s.engage()).toEqual({ ok: false, reason: 'Start deck A first' });
  expect(s.engaged).toBe(false);
});
test('engage copies cps to B and schedules B start on the boundary', () => {
  const timers: Array<[() => void, number]> = [];
  const a = fakeDeck({ started: true, cps: 0.5, now: 3.25 });
  const b = fakeDeck({ started: true, cps: 0.6 });
  const s = new SyncController(() => a, () => b, (f, ms) => { timers.push([f, ms]); return 0 as any; });
  expect(s.engage()).toEqual({ ok: true });
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(b.scheduler.stop).toHaveBeenCalled();
  expect(timers[0][1]).toBeCloseTo(1500);
  timers[0][0]();
  expect(b.scheduler.start).toHaveBeenCalled();
});
test('while engaged, A re-eval propagates cps to B', () => {
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: true, cps: 0.5 });
  const s = new SyncController(() => a, () => b, () => 0 as any);
  s.engage();
  a.scheduler.cps = 0.55; a.afterEval.forEach(f => f());
  expect(b.setCps).toHaveBeenLastCalledWith(0.55);
});
test('while engaged, B re-eval is pulled back to A tempo and reported', () => {
  const onTempoChange = vi.fn();
  const a = fakeDeck({ started: true, cps: 0.525 }); const b = fakeDeck({ id: 'B', started: true, cps: 0.525 });
  const s = new SyncController(() => a, () => b, () => 0 as any, { onTempoChange });
  s.engage();
  b.scheduler.cps = 0.4167; b.afterEval.forEach(f => f()); // B's own setcpm(100/4)
  expect(b.scheduler.cps).toBe(0.525);
  expect(onTempoChange).toHaveBeenLastCalledWith('B', 0.525);
});
test('release unhooks and re-evaluates B so its own setcpm applies again', () => {
  const timers: Array<() => void> = [];
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: true, cps: 0.5 });
  const s = new SyncController(() => a, () => b, (f) => { timers.push(f); return 0 as any; });
  s.engage();
  timers[0](); // B restarted on the boundary
  s.release();
  expect(s.engaged).toBe(false);
  expect(b.evaluate).toHaveBeenCalledWith();
  expect(a.afterEval.size).toBe(0);
  expect(b.afterEval.size).toBe(0);
  b.setCps.mockClear();
  a.scheduler.cps = 0.7; a.afterEval.forEach(f => f());
  expect(b.setCps).not.toHaveBeenCalled();
});
test('release before the boundary cancels the pending B restart', () => {
  const timers: Array<() => void> = [];
  const cancel = vi.fn();
  const a = fakeDeck({ started: true, cps: 0.5, now: 1.5 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, (f) => { timers.push(f); return 7 as any; }, { clearTimer: cancel });
  s.engage();
  s.release();
  expect(cancel).toHaveBeenCalledWith(7);
  expect(b.evaluate).toHaveBeenCalledWith(true); // B was playing before engage, so it plays again
});
test('engage on a stopped B matches tempo without starting it', () => {
  const timers: Array<() => void> = [];
  const a = fakeDeck({ started: true, cps: 0.5 }); const b = fakeDeck({ started: false, cps: 0.4 });
  const s = new SyncController(() => a, () => b, (f) => { timers.push(f); return 0 as any; });
  expect(s.engage()).toEqual({ ok: true });
  expect(b.setCps).toHaveBeenCalledWith(0.5);
  expect(b.scheduler.stop).not.toHaveBeenCalled();
  expect(timers).toHaveLength(0);
});
test('calls the timer unbound, as window.setTimeout requires', () => {
  const calls: number[] = [];
  // window.setTimeout throws "Illegal invocation" when called with another receiver.
  function strictTimer(this: unknown, _f: () => void, ms: number) {
    if (this !== undefined) throw new TypeError('Illegal invocation');
    calls.push(ms);
    return 0 as any;
  }
  const a = fakeDeck({ started: true, cps: 0.5, now: 0.5 }); const b = fakeDeck({ started: true });
  const s = new SyncController(() => a, () => b, strictTimer);
  expect(s.engage()).toEqual({ ok: true });
  expect(calls).toEqual([1000]);
});
