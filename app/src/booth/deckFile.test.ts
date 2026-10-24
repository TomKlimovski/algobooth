import { createDeckState, type DeckFields } from './deckState';
import type { Layout } from './keys/bindings';
import { isDirty, newPatternDecision, onDiskChange, patternFromDeck, unpointsDecks } from './deckFile';

const deck = ({ cpm, ...rest }: Pick<DeckFields, 'name' | 'code'> & { cpm: number }) => ({ ...rest, codeCpm: cpm });

test('dirty rules', () => {
  expect(isDirty('a', 'a')).toBe(false);
  expect(isDirty('a', 'b')).toBe(true);
  expect(isDirty('', null)).toBe(false);
});
test('a never-saved deck is dirty only once it differs from its default code', () => {
  expect(isDirty('default', null, 'default')).toBe(false);
  expect(isDirty('edited', null, 'default')).toBe(true);
});
test('line endings do not make a deck dirty', () => {
  expect(isDirty('a\nb', 'a\r\nb')).toBe(false);
  expect(isDirty('a\nb', null, 'a\r\nb')).toBe(false);
});
test('a root change in the batch counts as a change to every open file', () => {
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: false }, [''])).toBe('reload');
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: true }, ['', 'other.json'])).toBe('prompt');
  expect(onDiskChange({ filePath: null, dirty: true }, [''])).toBe('ignore');
});
test('new pattern on a dirty deck saves, discards or keeps editing as answered', () => {
  expect(newPatternDecision(false, null)).toBe('start');
  expect(newPatternDecision(true, 'save')).toBe('save-then-start');
  expect(newPatternDecision(true, 'discard')).toBe('start');
  expect(newPatternDecision(true, 'cancel')).toBe('abort');
  expect(newPatternDecision(true, null)).toBe('abort');
});
test('disk change decision', () => {
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: false }, ['mine/y.json'])).toBe('ignore');
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: false }, ['mine/x.json'])).toBe('reload');
  expect(onDiskChange({ filePath: 'mine/x.json', dirty: true }, ['mine/x.json'])).toBe('prompt');
  expect(onDiskChange({ filePath: null, dirty: true }, ['mine/x.json'])).toBe('ignore');
});
test('patternFromDeck keeps rip source and fills mine defaults', () => {
  const rip = { kind: 'rip', url: 'u', start: 1, end: 2, rippedAt: 't' } as const;
  expect(patternFromDeck(deck({ name: 'n', code: 'c', cpm: 126 }), { name: 'n', code: 'old', cpm: 120, key: 'A minor', tags: ['x'], source: rip, notes: 'k' }))
    .toEqual({ name: 'n', code: 'c', cpm: 126, key: 'A minor', tags: ['x'], source: rip, notes: 'k' });
  expect(patternFromDeck(deck({ name: 'n', code: 'c', cpm: 120 })).source).toEqual({ kind: 'mine' });
  expect(patternFromDeck(deck({ name: 'n', code: 'c', cpm: 120 }))).toEqual({
    name: 'n', code: 'c', cpm: 120, key: '', tags: [], source: { kind: 'mine' }, notes: '',
  });
});
test('a synced deck saves its own code tempo, not the effective tempo the header shows', () => {
  const b = createDeckState('B');
  b.setCpm(100); // afterEval: B's own setcpm(100/4)...
  b.setCodeCpm(100);
  b.setCpm(126); // ...then sync pulls B to A's tempo
  expect(b.state.cpm).toBe(126);
  expect(patternFromDeck({ ...b.state, name: 'n', code: 'c' }).cpm).toBe(100);
});
test('changing the library folder unpoints the decks; loading the first folder does not', () => {
  expect(unpointsDecks(undefined, '/lib')).toBe(false); // settings just loaded
  expect(unpointsDecks(null, '/lib')).toBe(false);
  expect(unpointsDecks('/lib', '/other')).toBe(true);
  expect(unpointsDecks('/lib', '/lib')).toBe(false);
});

test('patternFromDeck writes keys only when the layout has something', () => {
  const base = { name: 'n', code: 'c', codeCpm: 120 };
  expect(patternFromDeck(base)).not.toHaveProperty('keys');
  expect(patternFromDeck({ ...base, keys: { bindings: {} } })).not.toHaveProperty('keys');
  const keys: Layout = { bindings: { KeyQ: { kind: 'method', name: 'lpenv', snippet: '.lpenv(2)', argRange: [7, 8] } } };
  expect(patternFromDeck({ ...base, keys }).keys).toEqual(keys);
  expect(patternFromDeck({ ...base, keys: { bindings: {}, snapshots: { F1: 'x' } } }).keys).toEqual({ bindings: {}, snapshots: { F1: 'x' } });
});
