import { vi } from 'vitest';
import { BUNDLED_MACHINES } from '../engine/banks';
import { examples, workshop } from './lessons';

// No audio is needed to evaluate a pattern, so webaudio is mocked as in methods/evaluate.test.ts.
const webaudio = vi.hoisted(() => ({
  initAudio: vi.fn(async () => {}),
  registerSynthSounds: vi.fn(),
  samples: vi.fn(async () => {}),
  aliasBank: vi.fn(async () => {}),
  getAudioContext: () => ({ close: vi.fn(async () => {}) }),
}));
vi.mock('@strudel/webaudio', () => webaudio);

const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');
const tonal = await import('@strudel/tonal/dist/index.mjs');
const { transpiler } = await import('@strudel/transpiler/dist/index.mjs');
await core.evalScope(core, mini, tonal);

/** The drum names that play without a bank (the 808's voices, the 909's ride) and the built-in synths. */
const PLAIN = ['bd', 'sd', 'rim', 'hh', 'oh', 'cp', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'perc', 'sh'];
const SYNTHS = ['sine', 'square', 'triangle', 'sawtooth', 'supersaw'];

const all = workshop.lessons.flatMap((l) => examples(l.blocks).map((e, i): [string, string] => [`${l.id} #${i + 1}`, e.code]));
if (all.length < 100) throw new Error(`only ${all.length} examples`); // never pass vacuously

// What the Try button promises: the example evaluates on a deck and every sound it plays ships with the booth.
test.each(all)('%s evaluates and plays shipped sounds', async (_name, code) => {
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = (await r.evaluate(code, false)) ?? r.scheduler.pattern;
  expect(pat, `${code} evaluates`).toBeDefined();
  const haps = pat.queryArc(0, 4).filter((h: { whole?: unknown }) => h.whole);
  expect(haps.length, code).toBeGreaterThan(0);
  for (const h of haps as { value: { s?: string; bank?: string } }[]) {
    const { s, bank } = h.value;
    if (s === undefined) continue; // a note with no sound plays the default triangle
    if (SYNTHS.includes(s)) continue;
    if (bank) expect(BUNDLED_MACHINES, `${code}: bank ${bank}`).toContain(bank);
    else expect(PLAIN, `${code}: sound ${s}`).toContain(s);
  }
});
