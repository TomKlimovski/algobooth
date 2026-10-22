import { unwrap } from 'solid-js/store';
import type { Pattern } from '../library/api';
import { sameLayout, type Layout } from './keys/bindings';
import { cpmFromCps, createDeckState } from './deckState';
test('eval error is stored per deck and cleared on next successful eval', () => {
  const d = createDeckState('A');
  d.setError('SyntaxError: x');
  expect(d.state.error).toBe('SyntaxError: x');
  d.setError(null);
  expect(d.state.error).toBeNull();
});
test('cpm defaults to 120 and orbit is fixed per deck', () => {
  expect(createDeckState('B').state.cpm).toBe(120);
});
test('an error on one deck does not touch the other', () => {
  const a = createDeckState('A'); const b = createDeckState('B');
  a.setError('boom');
  expect(b.state.error).toBeNull();
});
test('header cpm is the bpm figure written in setcpm(bpm/4)', () => {
  expect(cpmFromCps(120 / 4 / 60)).toBe(120);
  expect(cpmFromCps(126 / 4 / 60)).toBe(126);
});
test('setFile points the deck at a file and clears a pending disk change', () => {
  const d = createDeckState('A');
  expect(d.state.filePath).toBeNull();
  expect(d.state.savedCode).toBeNull();
  d.setDiskChanged(true);
  d.setFile('mine/x.json', 'code');
  expect(d.state).toMatchObject({ filePath: 'mine/x.json', savedCode: 'code', pattern: null, diskChanged: false });
});

test('a key edit on a loaded deck differs from what was loaded, and leaves the file object alone', () => {
  const d = createDeckState('A');
  const keys: Layout = { bindings: { KeyQ: { kind: 'method', name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] } } };
  const pattern = { name: 'p', code: 'x', cpm: 120, key: '', tags: [], source: { kind: 'mine' }, keys } as unknown as Pattern;
  d.setFile('mine/p.json', 'x', pattern);
  expect(sameLayout(d.state.keys, d.state.savedKeys)).toBe(true);
  d.setKeys({ bindings: { ...unwrap(d.state.keys).bindings, KeyW: null } });
  expect(sameLayout(d.state.keys, d.state.savedKeys)).toBe(false);
  expect(Object.keys(d.state.savedKeys!.bindings)).toEqual(['KeyQ']);
  expect(Object.keys(pattern.keys!.bindings)).toEqual(['KeyQ']);
});

test('a key edit on a deck with no file differs from the empty saved layer', () => {
  const d = createDeckState('A');
  d.setFile(null, null);
  d.setKeys({ bindings: { KeyW: null } });
  expect(sameLayout(d.state.keys, d.state.savedKeys)).toBe(false);
  expect(d.state.savedKeys!.bindings).toEqual({});
});
