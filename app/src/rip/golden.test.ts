import { vi } from 'vitest';
import { expectShippedSounds } from '../test/shippedSounds';

// No audio is needed to evaluate a pattern, so webaudio is mocked as in strudel.test.ts.
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

await core.evalScope(core, mini, tonal); // chord().voicing() comes from tonal

// The service's golden outputs (app/src/rip -> repo root -> service/tests/golden), loaded as text by vite.
const golden = import.meta.glob<string>('../../../service/tests/golden/*.strudel', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const files = Object.keys(golden).sort();

if (files.length === 0) throw new Error('no golden .strudel files in service/tests/golden'); // never pass vacuously

test('the glob sees every golden on disk (a cached glob would skip new files)', async () => {
  // Node's fs, typed by hand: the app's tsconfig has no Node types. Vitest runs from the repo root.
  const fs: { readdirSync(dir: string): string[] } = await import(/* @vite-ignore */ `node:${'fs'}`);
  const cwd: string = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
  const onDisk = fs.readdirSync(`${cwd}/service/tests/golden`).filter((f) => f.endsWith('.strudel'));
  expect(onDisk.length).toBeGreaterThan(0);
  // vitest 5 keeps transformed modules in node_modules/.vitest-cache, keyed by file: after a golden is added
  // this file's cached transform still lists the old set. `pnpm exec vitest run --clearCache` fixes it.
  expect(files.length, 'stale glob: run `pnpm exec vitest run --clearCache`').toBe(onDisk.length);
});

test.each(files)('%s evaluates headlessly and plays in its first cycle', async (file: string) => {
  const code = golden[file];
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate(code, false);
  expect((pat ?? r.scheduler.pattern).queryArc(0, 1).length).toBeGreaterThan(0);
});

/** Each named line of a golden (`bass: note(...)`, muted `_bass2:` too) with the golden's `setcpm(...)` before it. */
function namedLines(code: string): { name: string; code: string }[] {
  const all = code.split('\n');
  const setup = all.filter((l) => /^setcpm\(/.test(l));
  return all
    .filter((l) => /^[A-Za-z_$][\w$]*:\s/.test(l))
    .map((l) => ({ name: l.slice(0, l.indexOf(':')), code: [...setup, l].join('\n') }));
}

const lineCases = files.flatMap((file) =>
  namedLines(golden[file]).map((l): [string, string, string] => [file.slice(file.lastIndexOf('/') + 1), l.name, l.code]),
);

// A chord symbol the voicing dictionary lacks voices to nothing, silently; a sound the booth does not ship is silent
// too. Every line plays only shipped sounds; every playing line (not a muted `_` one: those are variations and
// fills, silent in the bars they do not cover) sounds in every bar of the clip, and a chord is at least a triad.
test.each(lineCases)('%s: the %s line plays shipped sounds in every bar', async (file, name, code) => {
  const bars = Number(/· (\d+) bars?/.exec(golden[files.find((f) => f.endsWith(`/${file}`))!])![1]);
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = (await r.evaluate(code, false)) ?? r.scheduler.pattern;
  const whole = (h: { whole?: unknown }) => h.whole;
  expectShippedSounds(pat.queryArc(0, bars).filter(whole), `${file} ${name}`);
  if (name.startsWith('_')) return;
  for (let bar = 0; bar < bars; bar++) {
    const haps = pat.queryArc(bar, bar + 1).filter(whole);
    expect(haps.length, `${file} ${name} bar ${bar + 1}`).toBeGreaterThan(0);
    if (name === 'chords') expect(haps.length, `${file} chords bar ${bar + 1} is voiced`).toBeGreaterThanOrEqual(3);
  }
});

test('a flat bar with weighted rests sustains each note for its weight', async () => {
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate('note("~@6 g1@6 ~@2 g1 ~")', false);
  const haps = (pat ?? r.scheduler.pattern).queryArc(0, 1);
  const spans = haps.map((h: any) => [h.value.note, h.whole.begin.valueOf() * 16, h.whole.end.valueOf() * 16]);
  expect(spans).toEqual([
    ['g1', 6, 12],
    ['g1', 14, 15],
  ]);
});
