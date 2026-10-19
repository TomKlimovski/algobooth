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
  /** Why live refresh is off (watcher or listener failed); only a reconnect clears it, never a library action. */
  watchWarning: string | null;
  /** Path of the entry being dragged from the tree, so drop targets can refuse it during dragover. */
  dragging: string | null;
}

/** Where a dragged entry could land: a deck, or a heading (`""` is the root). */
export type DropTarget = { deck: true } | { heading: string };

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

export function createLibraryStore(api: LibraryApi, decks: () => Record<DeckId, DeckApi | null>) {
  const [state, set] = createStore<LibraryFields>({
    root: null,
    folded: new Set(),
    selected: null,
    collapsed: false,
    error: null,
    watchWarning: null,
    dragging: null,
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
      const root = await api.list_tree();
      const headings = collectHeadings(root, new Set());
      // Keyed by path, so rows that survive a refresh keep their DOM (and an in-progress rename).
      set('root', reconcile(root, { key: 'path' }));
      set('folded', new Set([...state.folded].filter((p) => headings.has(p))));
      if (state.selected !== null && !findNode(root, state.selected)) set('selected', null);
    });

  /** After an entry moves from `from` to `to`, keep it selected, keep folds under it, and keep decks on their files. */
  const followEntry = (from: string, to: string) => {
    set('folded', new Set([...state.folded].map((p) => reroot(p, from, to))));
    if (state.selected !== null) set('selected', reroot(state.selected, from, to));
    for (const deck of Object.values(decks())) {
      const file = deck?.filePath() ?? null;
      if (file !== null && reroot(file, from, to) !== file) deck!.moveFile(reroot(file, from, to));
    }
  };

  const load = (path: string, deckId: DeckId) =>
    attempt(async () => {
      const node = findNode(state.root, path);
      if (node?.kind === 'unreadable') throw new Error('This file is not a valid pattern');
      if (node?.kind === 'heading') throw new Error('Only patterns can be loaded onto a deck');
      const deck = decks()[deckId];
      if (!deck) throw new Error(`Deck ${deckId} is not ready yet`);
      const pattern = await api.read_pattern(path);
      deck.setCode(pattern.code);
      deck.setName(pattern.name);
      deck.setFile(path, pattern.code, pattern);
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
        const next = await api.rename_entry(path, name);
        // Renaming a pattern also renames it inside the file, so a deck showing it follows the new name.
        for (const deck of Object.values(decks())) if (deck?.filePath() === path) deck.setName(name);
        followEntry(path, next);
        await refresh();
        return next;
      }),
    move: (path: string, parent: string) =>
      attempt(async () => {
        const next = await api.move_entry(path, parent);
        followEntry(path, next);
        await refresh();
        return next;
      }),
    remove: (path: string) =>
      attempt(async () => {
        await api.delete_entry(path);
        await refresh();
      }),
    createHeading: (parent: string, name: string) =>
      attempt(async () => {
        const path = await api.create_heading(parent, name);
        await refresh();
        return path;
      }),
    /** Writes the "untitled" starter pattern into `heading`. */
    newPattern: (heading: string) =>
      attempt(async () => {
        const path = await api.write_pattern(heading, NEW_PATTERN);
        await refresh();
        return path;
      }),
    /** Reads one pattern (a deck reconciling with a change on disk). */
    readPattern: (path: string) => attempt(() => api.read_pattern(path)),
    /** Overwrites the pattern at `path` (a deck's Save). */
    savePattern: (path: string, pattern: Pattern) => attempt(() => api.save_pattern(path, pattern)),
    /** Writes `pattern` as a new file in `heading` (a deck's Save as); resolves to its path. */
    writePattern: (heading: string, pattern: Pattern) =>
      attempt(async () => {
        const path = await api.write_pattern(heading, pattern);
        await refresh();
        return path;
      }),
    /** Copies a pattern next to itself as "<name> copy". */
    duplicate: (path: string) =>
      attempt(async () => {
        const pattern = await api.read_pattern(path);
        const copy = await api.write_pattern(parentOf(path), { ...pattern, name: `${pattern.name} copy` });
        await refresh();
        return copy;
      }),
    /** Shows `message` (or clears it) without running a library call, e.g. when there is no Tauri runtime. */
    setError: (message: string | null) => set('error', message),
    setWatchWarning: (message: string | null) => set('watchWarning', message),
    setDragging: (path: string | null) => set('dragging', path),
    /**
     * Whether the entry being dragged may drop on `target`: only patterns load onto a deck, and an entry
     * cannot move onto itself, into its own subtree, or into the heading it is already in.
     */
    canDrop: (target: DropTarget): boolean => {
      const dragged = state.dragging;
      if (dragged === null) return false;
      if ('deck' in target) return findNode(state.root, dragged)?.kind === 'pattern';
      const h = target.heading;
      return h !== dragged && !h.startsWith(dragged + '/') && parentOf(dragged) !== h;
    },
  };
}
