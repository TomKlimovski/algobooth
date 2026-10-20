import { vi } from 'vitest';

// No audio is needed to evaluate a pattern, so webaudio is mocked as in golden.test.ts.
const webaudio = vi.hoisted(() => ({
  initAudio: vi.fn(async () => {}),
  registerSynthSounds: vi.fn(),
  samples: vi.fn(async () => {}),
  aliasBank: vi.fn(async () => {}),
  getAudioContext: () => ({ close: vi.fn(async () => {}) }),
}));
vi.mock('@strudel/webaudio', () => webaudio);

// The bundles, so the repl, the transpiler, mini and tonal share one Pattern class (see evalLock.test.ts).
const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');
const tonal = await import('@strudel/tonal/dist/index.mjs');
const { transpiler } = await import('@strudel/transpiler/dist/index.mjs');

await core.evalScope(core, mini, tonal);

// The service's goldens (app/src/rip -> repo root -> service/tests/golden), loaded as text by vite.
const eventsFiles = import.meta.glob<string>('../../../service/tests/golden/*.bass-events.json', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const strudelFiles = import.meta.glob<string>('../../../service/tests/golden/*.strudel', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const base = (path: string, suffix: string) => path.slice(path.lastIndexOf('/') + 1, -suffix.length);
const events: Record<string, string> = {};
for (const [p, text] of Object.entries(eventsFiles)) events[base(p, '.bass-events.json')] = text;
const strudel: Record<string, string> = {};
for (const [p, text] of Object.entries(strudelFiles)) strudel[base(p, '.strudel')] = text;
const names = Object.keys(events).sort();

if (names.length === 0) throw new Error('no golden .bass-events.json files in service/tests/golden'); // never pass vacuously

type Row = [string, number, number];
type Event = { line: string; cycle: number; step: number; length: number; note: string };
const byStart = (a: Row, b: Row) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

// One case per (golden, Strudel line) its events name: `bass` for the loop, `_bass2` for its layer.
// An empty events file is a golden with no loop: it has nothing to play, so it has no case.
const cases: [string, string][] = names.flatMap((name) => {
  const lines = [...new Set((JSON.parse(events[name]) as Event[]).map((e) => e.line))].sort();
  return lines.map((line): [string, string] => [name, line]);
});

// The `<line>: ` line of <name>.strudel, evaluated and queried over `cycles` cycles (1 + that line's last
// event's cycle), plays exactly that line's events.
test.each(cases)('%s: the %s line plays its loop', async (name: string, line: string) => {
  const expectedEvents = (JSON.parse(events[name]) as Event[]).filter((e) => e.line === line);
  const code = strudel[name].split('\n').find((l) => l.startsWith(`${line}: `));
  expect(code, `${name}.strudel has a ${line}: line`).toBeDefined();
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate(code!.slice(`${line}: `.length), false);
  const cycles = 1 + Math.max(0, ...expectedEvents.map((e) => e.cycle));
  const haps = (pat ?? r.scheduler.pattern).queryArc(0, cycles);
  const played = haps
    .filter((h: any) => h.whole) // only whole events; a fragment has no onset of its own
    .map((h: any): Row => [h.value.note, Math.round(h.whole.begin.valueOf() * 16), Math.round(h.whole.end.valueOf() * 16)])
    .sort(byStart);
  const expected = expectedEvents
    .map((e): Row => [e.note, e.cycle * 16 + e.step, e.cycle * 16 + e.step + e.length])
    .sort(byStart);
  expect(played).toEqual(expected);
});

test('every bass-events file has a strudel file and the glob is not empty', () => {
  expect(names.length).toBeGreaterThan(0);
  expect(cases.length).toBeGreaterThan(0);
  for (const name of names) expect(strudel[name], `${name}.strudel`).toBeDefined();
});

// One case per golden with a `_fills:` line: the comment above it names the bars (1-based, inclusive) the
// fills play in, and the header names the clip's bar count.
const fillsCases: [string, number, number, number][] = Object.keys(strudel)
  .sort()
  .flatMap((name): [string, number, number, number][] => {
    const text = strudel[name];
    if (!text.split('\n').some((l) => l.startsWith('_fills: '))) return [];
    const m = /^\/\/ bars (\d+)–(\d+) add these hits/m.exec(text);
    const b = /· (\d+) bars?\s*$/m.exec(text.split('\n')[0]);
    if (!m || !b) throw new Error(`${name}.strudel has a _fills: line but no readable bars comment or header`);
    return [[name, Number(m[1]), Number(m[2]), Number(b[1])]];
  });

test.each(fillsCases)('%s: the _fills line plays only in bars %i–%i of %i', async (name: string, lo: number, hi: number, bars: number) => {
  const code = strudel[name].split('\n').find((l) => l.startsWith('_fills: '));
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate(code!.slice('_fills: '.length), false); // the underscore removed: it plays
  const pattern = pat ?? r.scheduler.pattern;
  const whole = (b: number, e: number) => pattern.queryArc(b, e).filter((h: any) => h.whole);
  expect(whole(lo - 1, lo).length, `${name}: a hit in bar ${lo}`).toBeGreaterThan(0);
  const cycles = new Set(whole(0, bars).map((h: any) => Math.floor(h.whole.begin.valueOf())));
  for (const c of cycles) {
    expect(c, `${name}: hit in cycle ${c}`).toBeGreaterThanOrEqual(lo - 1);
    expect(c, `${name}: hit in cycle ${c}`).toBeLessThanOrEqual(hi - 1);
  }
});

test('at least one golden has a _fills line', () => {
  expect(fillsCases.length).toBeGreaterThan(0);
});
