import { vi } from 'vitest';

// vitest.config.ts stubs @kabelsalat/web (browser-only), which the repls here never use.
// The bundles, so the repls, the transpiler and mini share one Pattern class (as in the app).
const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');
const { transpiler } = await import('@strudel/transpiler/dist/index.mjs');
const { evaluateExclusive, StartCancelled, withEvalLock } = await import('./evalLock');

await core.evalScope(core, mini);

function makeRepl() {
  return core.repl({ transpiler, getTime: () => 0, defaultOutput: async () => {} });
}

/** Distinct `s` values the evaluated pattern plays in its first cycle. */
const sounds = (r: any): string[] =>
  [...new Set<string>(r.state.pattern.queryArc(0, 1).map((h: any) => h.value.s))].sort();

test('two decks evaluated at once each keep their own tempo and $: lines', async () => {
  const a = makeRepl();
  const b = makeRepl();
  const codeA = 'setcpm(100/4)\n$: s("bd")\n$: s("hh")';
  const codeB = 'setcpm(140/4)\n$: s("sd")';
  await Promise.all([evaluateExclusive(a, codeA, false), evaluateExclusive(b, codeB, false)]);
  expect(a.scheduler.cps * 60 * 4).toBeCloseTo(100);
  expect(b.scheduler.cps * 60 * 4).toBeCloseTo(140);
  expect(sounds(a)).toEqual(['bd', 'hh']);
  expect(sounds(b)).toEqual(['sd']);
});

test('the lock runs one evaluation at a time and survives a failure', async () => {
  const order: string[] = [];
  const step = (name: string, fail = false) => async () => {
    order.push(`${name} in`);
    await new Promise((r) => setTimeout(r, 5));
    order.push(`${name} out`);
    if (fail) throw new Error(name);
    return name;
  };
  const first = withEvalLock(step('a', true));
  const second = withEvalLock(step('b'));
  await expect(first).rejects.toThrow('a');
  await expect(second).resolves.toBe('b');
  expect(order).toEqual(['a in', 'a out', 'b in', 'b out']);
});

test('autostart happens after the lock is released, so a held start cannot block the other deck', async () => {
  let release!: () => void;
  const held = {
    evaluate: vi.fn(async () => ({})),
    scheduler: {
      started: false,
      start: vi.fn(() => new Promise<void>((r) => (release = r))), // a sync-held start
    },
  };
  const other = { evaluate: vi.fn(async () => ({})), scheduler: { started: true, start: vi.fn(async () => {}) } };
  const heldDone = evaluateExclusive(held, 'x', true);
  await expect(evaluateExclusive(other, 'y', false)).resolves.toBe(true);
  expect(held.evaluate).toHaveBeenCalledWith('x', false);
  expect(held.scheduler.start).toHaveBeenCalled();
  release();
  await expect(heldDone).resolves.toBe(true);
});

test('a failed evaluation does not start the deck', async () => {
  const r = { evaluate: vi.fn(async () => undefined), scheduler: { started: false, start: vi.fn(async () => {}) } };
  await expect(evaluateExclusive(r, 'bad', true)).resolves.toBe(false);
  expect(r.scheduler.start).not.toHaveBeenCalled();
});

test('a cancelled start resolves quietly', async () => {
  const r = {
    evaluate: vi.fn(async () => ({})),
    scheduler: { started: false, start: vi.fn(async () => Promise.reject(new StartCancelled())) },
  };
  await expect(evaluateExclusive(r, 'x', true)).resolves.toBe(true);
});
