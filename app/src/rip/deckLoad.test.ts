import type { DeckApi } from '../booth/Deck';
import type { Pattern } from '../library/api';
import { LOAD_OVER_EDITS_PROMPT } from '../library/store';
import type { SaveChoice } from '../booth/saveChoice';
import { loadToDeck } from './deckLoad';

const pattern: Pattern = {
  name: 'Song 1:12',
  code: 'setcpm(124/4)\n$: s("bd*4")',
  cpm: 124,
  key: 'A minor',
  tags: [],
  notes: '',
  source: { kind: 'rip', url: 'https://www.youtube.com/watch?v=x', start: 72, end: 88, rippedAt: '2026-10-20T00:00:00.000Z' },
};

function fakeDeck(opts: { dirty: boolean; saves?: boolean }) {
  return {
    isDirty: vi.fn(() => opts.dirty),
    save: vi.fn(async () => opts.saves ?? true),
    setCode: vi.fn(),
    setName: vi.fn(),
    setFile: vi.fn(),
  } satisfies Partial<DeckApi>;
}
const asDeck = (d: ReturnType<typeof fakeDeck>) => d as unknown as DeckApi;

test('a clean deck loads at once and stays unsaved with the rip source (review focus 5)', async () => {
  const deck = fakeDeck({ dirty: false });
  const confirm = vi.fn(async (): Promise<SaveChoice> => 'cancel');
  expect(await loadToDeck(asDeck(deck), pattern, confirm)).toBe(true);
  expect(confirm).not.toHaveBeenCalled();
  expect(deck.save).not.toHaveBeenCalled();
  expect(deck.setCode).toHaveBeenCalledWith(pattern.code);
  expect(deck.setName).toHaveBeenCalledWith(pattern.name);
  expect(deck.setFile).toHaveBeenCalledWith(null, null, pattern);
});

test('a dirty deck asks; cancel keeps the edits', async () => {
  const deck = fakeDeck({ dirty: true });
  const confirm = vi.fn(async (): Promise<SaveChoice> => 'cancel');
  expect(await loadToDeck(asDeck(deck), pattern, confirm)).toBe(false);
  expect(confirm).toHaveBeenCalledWith(LOAD_OVER_EDITS_PROMPT);
  expect(deck.save).not.toHaveBeenCalled();
  expect(deck.setCode).not.toHaveBeenCalled();
  expect(deck.setName).not.toHaveBeenCalled();
  expect(deck.setFile).not.toHaveBeenCalled();
});

test("a dirty deck with Don't Save loads without saving", async () => {
  const deck = fakeDeck({ dirty: true });
  expect(await loadToDeck(asDeck(deck), pattern, async () => 'discard')).toBe(true);
  expect(deck.save).not.toHaveBeenCalled();
  expect(deck.setCode).toHaveBeenCalledWith(pattern.code);
});

test('a dirty deck with Save saves first', async () => {
  const saved = fakeDeck({ dirty: true, saves: true });
  expect(await loadToDeck(asDeck(saved), pattern, async () => 'save')).toBe(true);
  expect(saved.save).toHaveBeenCalledTimes(1);
  expect(saved.save.mock.invocationCallOrder[0]).toBeLessThan(saved.setCode.mock.invocationCallOrder[0]);
  expect(saved.setFile).toHaveBeenCalledWith(null, null, pattern);

  const failed = fakeDeck({ dirty: true, saves: false });
  expect(await loadToDeck(asDeck(failed), pattern, async () => 'save')).toBe(false);
  expect(failed.setCode).not.toHaveBeenCalled();
  expect(failed.setFile).not.toHaveBeenCalled();
});
