import { expect, test } from 'vitest';
import core from '@strudel/core/package.json';
import tonal from '@strudel/tonal/package.json';
import { catalogue, FUNCTION_GROUPS, GROUPS } from './catalogue';
import { FUNCTION_GROUP_OF, GROUP_OF } from './groups';

const methods = catalogue.methods.filter((m) => m.kind === 'method');
const functions = catalogue.methods.filter((m) => m.kind === 'function');

test('the catalogue matches the installed Strudel', () => {
  expect(catalogue.versions, 'run `pnpm build-methods`').toEqual({
    '@strudel/core': core.version,
    '@strudel/tonal': tonal.version,
  });
});

test('orbit is never offered and every row is complete', () => {
  const names = methods.map((m) => m.name);
  expect(names).not.toContain('orbit');
  expect(new Set(names).size, 'one method row per name').toBe(names.length);
  for (const m of methods) {
    expect(m.description.length, m.name).toBeGreaterThan(0);
    expect(m.snippet.startsWith(`.${m.name}(`) && m.snippet.endsWith(')'), m.snippet).toBe(true);
    expect(GROUPS, m.name).toContain(m.group);
    if (m.argRange) expect(m.snippet.slice(...m.argRange).length, m.snippet).toBeGreaterThan(0);
  }
});

test('function rows are complete expressions, one per name, and samples is never offered', () => {
  const names = functions.map((m) => m.name);
  expect(functions.length).toBeGreaterThan(0);
  expect(names).not.toContain('samples');
  expect(names).not.toContain('silence');
  expect(new Set(names).size, 'one function row per name').toBe(names.length);
  for (const m of functions) {
    expect(m.description.length, m.name).toBeGreaterThan(0);
    expect(m.snippet.includes(m.name) && !m.snippet.startsWith('.'), m.snippet).toBe(true);
    expect(FUNCTION_GROUPS, m.name).toContain(m.group);
    if (m.argRange) expect(m.snippet.slice(...m.argRange).length, m.snippet).toBeGreaterThan(0);
  }
  for (const n of Object.keys(FUNCTION_GROUP_OF)) expect(names, n).toContain(n);
  // The ones Tom could not find, in both forms
  expect(functions.find((m) => m.name === 'seq')?.snippet).toBe('seq("bd*4", "hh*8")');
  expect(functions.find((m) => m.name === 'stack')?.snippet).toBe('stack(s("bd*4"), s("hh*8"))');
  expect(methods.find((m) => m.name === 'stack')?.snippet).toBe('.stack(s("hh*8"))');
  expect(functions.find((m) => m.name === 'sine')?.snippet).toBe('sine.range(200, 2000).slow(4)');
  expect(functions.find((m) => m.name === 'setcpm')?.snippet).toBe('setcpm(120/4)');
});

test('every grouped name exists and the voicing family carries its note', () => {
  const names = new Set(methods.map((m) => m.name));
  for (const n of Object.keys(GROUP_OF)) expect(names.has(n), n).toBe(true);
  expect(catalogue.methods.find((m) => m.name === 'voicing')?.note).toBe('needs a chord() pattern');
  expect(catalogue.methods.find((m) => m.name === 'duckorbit')?.note).toBe('orbits here are decks: 1 = deck A, 2 = deck B');
  expect(catalogue.methods.find((m) => m.name === 'duckattack')?.note).toBe('needs .duckorbit(); orbits here are decks: 1 = deck A, 2 = deck B');
});

test('a hand default selects its marked literal, an example default selects the whole literal', () => {
  const row = (name: string) => catalogue.methods.find((m) => m.name === name)!;
  const selected = (name: string) => row(name).snippet.slice(...row(name).argRange!);
  expect(row('every').snippet).toBe('.every(4, x => x.fast(2))');
  expect(selected('every')).toBe('4');
  expect(row('lpf').snippet).toBe('.lpf(800)');
  expect(row('loopAt').snippet).toBe('.loopAt(2)'); // from its @example
  expect(selected('loopAt')).toBe('2');
  expect(row('rev')).toMatchObject({ snippet: '.rev()', argRange: null }); // no parameters
});

test('the catalogue is sorted by kind, then group, then name', () => {
  const key = (m: { kind: string; group: string; name: string }) =>
    [m.kind === 'method' ? GROUPS.indexOf(m.group) : GROUPS.length + FUNCTION_GROUPS.indexOf(m.group), m.name] as const;
  const sorted = [...catalogue.methods].sort((a, b) => {
    const [ga, na] = key(a);
    const [gb, nb] = key(b);
    return ga - gb || (na < nb ? -1 : na > nb ? 1 : 0);
  });
  expect(catalogue.methods.map((m) => m.name)).toEqual(sorted.map((m) => m.name));
});

test('a quoted default selects the text inside its quotes', () => {
  for (const m of catalogue.methods) {
    if (!m.argRange) continue;
    expect(`"'`.includes(m.snippet[m.argRange[0]]), `${m.snippet} selects its opening quote`).toBe(false);
    expect(`"'`.includes(m.snippet[m.argRange[1] - 1]), `${m.snippet} selects its closing quote`).toBe(false);
  }
});

test('no row lists another row as its synonym', () => {
  const names = new Set(catalogue.methods.map((m) => m.name));
  for (const m of catalogue.methods) expect(m.synonyms.filter((s) => names.has(s)), m.name).toEqual([]);
});
