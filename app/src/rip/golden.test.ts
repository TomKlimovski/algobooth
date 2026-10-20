import { vi } from 'vitest';

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

test.each(files)('%s evaluates headlessly and plays in its first cycle', async (file: string) => {
  const code = golden[file];
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = await r.evaluate(code, false);
  expect((pat ?? r.scheduler.pattern).queryArc(0, 1).length).toBeGreaterThan(0);
});
