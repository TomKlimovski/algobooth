import { vi } from 'vitest';
import type { DeckApi } from '../booth/Deck';
import { applyEdits, type Edit } from '../booth/keys/press';

export type Clock = { duration?: number; minLatency?: number };

export interface FakeDeckOptions {
  id?: 'A' | 'B';
  started?: boolean;
  cps?: number;
  now?: number;
  clock?: Clock | null;
  /** The editor text; `applyEdits` and `setCode` change it, `getCode` reads it. */
  code?: string;
  /** Called with the new text whenever it changes, as the real deck's `onUpdateState` does. */
  onCode?: (code: string) => void;
}

/**
 * A DeckApi whose scheduler behaves like Cyclist where sync and the key queue rely on it:
 * start() awaits beforeStart before it starts, and both start and stop fire onToggle.
 * The clock defaults to zero lead so cycle math in tests reads directly; `clock: null` drops it
 * to exercise the fallback. The editor is an in-memory string, so key edits can be checked as text.
 */
export function fakeDeck(opts: FakeDeckOptions = {}) {
  const onToggle = new Set<(started: boolean) => void>();
  const onLoad = new Set<() => void>();
  const editor = { code: opts.code ?? '' };
  const write = (code: string) => {
    editor.code = code;
    opts.onCode?.(code);
  };
  const scheduler = {
    cps: opts.cps ?? 0.5,
    started: opts.started ?? false,
    now: vi.fn(() => opts.now ?? 0),
    clock: opts.clock === null ? undefined : (opts.clock ?? { duration: 0, minLatency: 0 }),
    beforeStart: undefined as undefined | (() => unknown),
    start: vi.fn(async () => {
      await scheduler.beforeStart?.();
      scheduler.started = true;
      onToggle.forEach((f) => f(true));
    }),
    stop: vi.fn(() => {
      scheduler.started = false;
      onToggle.forEach((f) => f(false));
    }),
  };
  const deck = {
    id: opts.id ?? 'A',
    evaluate: vi.fn(async (_autostart?: boolean) => {}),
    stop: vi.fn(),
    toggle: vi.fn(),
    setCode: vi.fn((code: string) => write(code)),
    getCode: vi.fn(() => editor.code),
    setName: vi.fn(),
    // A pattern given is a load, as the real deck's api fires it.
    setFile: vi.fn((_path: string | null, _saved: string | null, pattern?: unknown) => {
      if (pattern) onLoad.forEach((f) => f());
    }),
    diskChanged: vi.fn(),
    filePath: vi.fn(() => null),
    moveFile: vi.fn(),
    unpointFile: vi.fn(),
    isDirty: vi.fn(() => false),
    save: vi.fn(async () => true),
    insertSnippet: vi.fn(() => true),
    applyEdits: vi.fn((edits: Edit[], _userEvent?: string) => write(applyEdits(editor.code, edits))),
    cue: vi.fn(),
    setLocked: vi.fn(),
    focusLine: vi.fn(),
    cursor: vi.fn(() => 0),
    scheduler,
    setCps: vi.fn((cps: number) => { scheduler.cps = cps; }),
    afterEval: new Set<() => void>(),
    onToggle,
    onLoad,
  } satisfies DeckApi;
  return deck;
}

export type FakeDeck = ReturnType<typeof fakeDeck>;
