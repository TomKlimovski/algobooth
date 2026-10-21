import { vi } from 'vitest';
import { catalogue, type MethodDoc } from './catalogue';

// No audio is needed to evaluate a pattern, so webaudio is mocked as in roundtrip.test.ts.
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

if (catalogue.methods.length === 0) throw new Error('the catalogue is empty'); // never pass vacuously

const base = (m: MethodDoc) =>
  m.base ?? (m.group === 'Pitch' ? 'note("c3 e3 g3 c4").s("sawtooth")' : 's("bd*4").bank("tr909")');

/** A function's carrier: where its expression goes in a line that plays. */
// A deck's lines are labelled, and the repl plays only labelled patterns once any exist: so a bare expression
// is tested the way a blank-line drop writes it, under a `$:` label.
const CARRIER: Record<string, string> = {
  Combine: '$: {}',
  Sources: '$: {}',
  Signals: 's("hh*8").gain({})',
  Random: 's("hh*8").gain({})',
  Setup: '{}\n$: s("bd*4")',
  Other: '$: {}',
};
const carried = (m: MethodDoc) => (m.base ?? CARRIER[m.group]).replace('{}', m.snippet);

// What a drop promises: the method chained onto a playing pattern with its default evaluates and plays, and a
// function's expression plays in the place it is written for.
test.each(catalogue.methods.map((m): [string, MethodDoc] => [`${m.kind} ${m.name}`, m]))(
  '%s evaluates and sounds with its default',
  async (_name: string, m: MethodDoc) => {
    const r = core.repl({ transpiler, defaultOutput: async () => {}, getTime: () => 0 });
    const code = m.kind === 'method' ? base(m) + m.snippet : carried(m);
    const pat = (await r.evaluate(code, false)) ?? r.scheduler.pattern;
    expect(pat, `${code} evaluates`).toBeDefined(); // the repl reports an error by returning nothing
    const haps = pat.queryArc(0, 1).filter((h: { whole?: unknown }) => h.whole);
    expect(haps.length, code).toBeGreaterThan(0);
  },
);
