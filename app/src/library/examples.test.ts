import { vi } from 'vitest';
import { BUNDLED_MACHINES } from '../engine/banks';
import { DIRT_SOUNDS, SOUNDFONTS } from '../engine/packs';

// The library's seed examples (`library-example/`): each one evaluates and plays only sounds the booth ships.
// No audio is needed to evaluate a pattern, so webaudio is mocked as in lessons/evaluate.test.ts.
vi.mock('@strudel/webaudio', () => ({}));

const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');
const tonal = await import('@strudel/tonal/dist/index.mjs');
const { transpiler } = await import('@strudel/transpiler/dist/index.mjs');
await core.evalScope(core, mini, tonal);

const files = import.meta.glob<{ code: string; cpm: number }>('../../../library-example/**/*.json', { eager: true, import: 'default' });
const examples = Object.entries(files).map(([path, json]): [string, { code: string; cpm: number }] => [path.replace('../../../library-example/', ''), json]);
if (examples.length < 8) throw new Error(`only ${examples.length} examples`); // never pass vacuously

/** The drum names that play without a bank, the built-in synths and the bundled packs. */
const SHIPPED = new Set([
  ...['bd', 'sd', 'rim', 'hh', 'oh', 'cp', 'lt', 'mt', 'ht', 'cr', 'rd', 'cb', 'perc', 'sh'],
  ...['sine', 'square', 'triangle', 'sawtooth', 'supersaw'],
  'piano',
  ...DIRT_SOUNDS,
  ...Object.keys(SOUNDFONTS),
]);
/** The short bank names `aliasBank` gives the bundled machines. */
const ALIASES: Record<string, string> = { tr909: 'RolandTR909', tr808: 'RolandTR808' };

/** Each named pattern line of `code` (`bass: note(...)`), with the code's setup (`setcpm(...)`) before it. */
function lines(code: string): string[] {
  const all = code.split('\n');
  const setup = all.filter((l) => /^setcpm\(/.test(l));
  return all.filter((l) => /^[A-Za-z_$][\w$]*:\s/.test(l)).map((l) => [...setup, l].join('\n'));
}

// A chord symbol the voicing dictionary does not know (`Dbmaj7`, `Eb7sus4`) voices to nothing, silently.
test.each(examples.flatMap(([name, { code }]) => lines(code).map((l): [string, string] => [name, l])))(
  '%s: every line plays in each of its first four bars: %s',
  async (_name, line) => {
    const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
    const pat = (await r.evaluate(line, false)) ?? r.scheduler.pattern;
    for (let bar = 0; bar < 4; bar++) {
      expect(pat.queryArc(bar, bar + 1).filter((h: { whole?: unknown }) => h.whole).length, `bar ${bar + 1}`).toBeGreaterThan(0);
    }
  },
);

test.each(examples)('%s evaluates, keeps its tempo and plays shipped sounds', async (_name, { code, cpm }) => {
  const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
  const pat = (await r.evaluate(code, false)) ?? r.scheduler.pattern;
  expect(pat, `${code} evaluates`).toBeDefined();
  expect(Math.round(r.scheduler.cps * 60 * 4)).toBe(cpm);
  const haps = pat.queryArc(0, 4).filter((h: { whole?: unknown }) => h.whole);
  expect(haps.length, code).toBeGreaterThan(0);
  for (const h of haps as { value: { s?: string; bank?: string; note?: unknown; orbit?: number } }[]) {
    const { s, bank } = h.value;
    if (s === undefined) continue;
    if (bank) expect(BUNDLED_MACHINES, `bank ${bank}`).toContain(ALIASES[bank] ?? bank);
    else expect(SHIPPED.has(s), `sound ${s}`).toBe(true);
    if (s.startsWith('gm_') || s === 'piano' || s === 'supersaw') expect(h.value.note, `${s} has a note`).toBeDefined();
  }
});
