import { createStore, reconcile } from 'solid-js/store';
import type { DeckApi } from '../booth/Deck';
import type { DeckId } from '../booth/deckState';
import type { LibraryApi, Pattern, TreeNode } from './api';

/** HTML5 drag type for a library entry; the data is its relative path. */
export const PATTERN_MIME = 'application/x-algobooth-pattern';

export interface LibraryFields {
  root: TreeNode | null;
  /** Heading paths whose children are hidden. */
  folded: Set<string>;
  selected: string | null;
  /** Sidebar folded away to its handle. */
  collapsed: boolean;
  /** Last failed library action, shown in the sidebar; cleared by the next success. */
  error: string | null;
}

export const NEW_PATTERN: Pattern = {
  name: 'untitled',
  code: 'setcpm(120/4)',
  cpm: 120,
  key: '',
  tags: [],
  source: { kind: 'mine' },
  notes: '',
};

/** The deck that is not playing; B when neither or both are (A is usually the one you mix from). */
export function pickDeckForDoubleClick(decks: Record<DeckId, { started: boolean } | null>): DeckId {
  const playing = (id: DeckId) => decks[id]?.started ?? false;
  if (playing('B') && !playing('A')) return 'A';
  return 'B';
}

export function findNode(node: TreeNode | null, path: string): TreeNode | null {
  if (!node) return null;
  if (node.path === path) return node;
  for (const child of node.children) {
    if (path === child.path || path.startsWith(child.path + '/')) return findNode(child, path);
  }
  return null;
}

/** Parent heading path of an entry (`""` for the root's children). */
export const parentOf = (path: string): string => path.slice(0, Math.max(0, path.lastIndexOf('/')));

const collectHeadings = (node: TreeNode, out: Set<string>): Set<string> => {
  if (node.kind === 'heading') {
    out.add(node.path);
    node.children.forEach((c) => collectHeadings(c, out));
  }
  return out;
};

/** Rewrites `path` (or anything under it) to live under `next` after a rename or move. */
const reroot = (p: string, from: string, to: string): string =>
  p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p;

export type LibraryStore = ReturnType<typeof createLibraryStore>;

export function createLibraryStore(
  api: LibraryApi,
  decks: () => Record<DeckId, DeckApi | null>,
  dir: () => string,
) {
  const [state, set] = createStore<LibraryFields>({
    root: null,
    folded: new Set(),
    selected: null,
    collapsed: false,
    error: null,
  });

  /** Runs a library call, recording its failure in `state.error` and rethrowing it. */
  const attempt = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      const value = await run();
      set('error', null);
      return value;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set('error', message);
      throw e instanceof Error ? e : new Error(message);
    }
  };

  const refresh = () =>
    attempt(async () => {
      const root = await api.list_tree(dir());
      const headings = collectHeadings(root, new Set());
      // Keyed by path, so rows that survive a refresh keep their DOM (and an in-progress rename).
      set('root', reconcile(root, { key: 'path' }));
      set('folded', new Set([...state.folded].filter((p) => headings.has(p))));
      if (state.selected !== null && !findNode(root, state.selected)) set('selected', null);
    });

  /** After an entry moves from `from` to `to`, keep it selected and keep folds under it. */
  const followEntry = (from: string, to: string) => {
    set('folded', new Set([...state.folded].map((p) => reroot(p, from, to))));
    if (state.selected !== null) set('selected', reroot(state.selected, from, to));
  };

  const load = (path: string, deckId: DeckId) =>
    attempt(async () => {
      const node = findNode(state.root, path);
      if (node?.kind === 'unreadable') throw new Error('This file is not a valid pattern');
      if (node?.kind === 'heading') throw new Error('Only patterns can be loaded onto a deck');
      const deck = decks()[deckId];
      if (!deck) throw new Error(`Deck ${deckId} is not ready yet`);
      const pattern = await api.read_pattern(dir(), path);
      deck.setCode(pattern.code);
      deck.setName(pattern.name);
      deck.setFile(path, pattern.code);
    });

  return {
    state,
    refresh,
    toggleFold: (path: string) => {
      const next = new Set(state.folded);
      if (!next.delete(path)) next.add(path);
      set('folded', next);
    },
    select: (path: string | null) => set('selected', path),
    setCollapsed: (collapsed: boolean) => set('collapsed', collapsed),
    load,
    /** Double-click: loads into whichever deck `pickDeckForDoubleClick` chooses; resolves to that deck. */
    loadToIdleDeck: async (path: string): Promise<DeckId> => {
      const all = decks();
      const started = (id: DeckId) => (all[id] ? { started: all[id]!.scheduler.started } : null);
      const id = pickDeckForDoubleClick({ A: started('A'), B: started('B') });
      await load(path, id);
      return id;
    },
    rename: (path: string, name: string) =>
      attempt(async () => {
        const next = await api.rename_entry(dir(), path, name);
        followEntry(path, next);
        await refresh();
        return next;
      }),
    move: (path: string, parent: string) =>
      attempt(async () => {
        const next = await api.move_entry(dir(), path, parent);
        followEntry(path, next);
        await refresh();
        return next;
      }),
    remove: (path: string) =>
      attempt(async () => {
        await api.delete_entry(dir(), path);
        await refresh();
      }),
    createHeading: (parent: string, name: string) =>
      attempt(async () => {
        const path = await api.create_heading(dir(), parent, name);
        await refresh();
        return path;
      }),
    /** Writes the "untitled" starter pattern into `heading`. */
    newPattern: (heading: string) =>
      attempt(async () => {
        const path = await api.write_pattern(dir(), heading, NEW_PATTERN);
        await refresh();
        return path;
      }),
    /** Copies a pattern next to itself as "<name> copy". */
    duplicate: (path: string) =>
      attempt(async () => {
        const pattern = await api.read_pattern(dir(), path);
        const copy = await api.write_pattern(dir(), parentOf(path), { ...pattern, name: `${pattern.name} copy` });
        await refresh();
        return copy;
      }),
    /** Shows `message` (or clears it) without running a library call, e.g. when there is no Tauri runtime. */
    setError: (message: string | null) => set('error', message),
  };
}
