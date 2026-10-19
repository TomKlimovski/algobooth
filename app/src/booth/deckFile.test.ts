import type { DeckFields } from './deckState';
import { isDirty, newPatternDecision, onDiskChange, patternFromDeck } from './deckFile';

const deck = (fields: Pick<DeckFields, 'name' | 'code' | 'cpm'>) => fields;

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
test('new pattern never discards unsaved edits', () => {
  expect(newPatternDecision(false, false)).toBe('start');
  expect(newPatternDecision(true, true)).toBe('save-then-start');
  expect(newPatternDecision(true, false)).toBe('abort');
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
