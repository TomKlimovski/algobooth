import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors the Rust `NodeKind`, `TreeNode`, `Source` and `Pattern` in src-tauri/src/library.rs. */
export type NodeKind = 'heading' | 'pattern' | 'unreadable';

export interface TreeNode {
  name: string;
  /** Relative to the library root, `/`-separated; `""` is the root. Leaf paths end in `.json`. */
  path: string;
  kind: NodeKind;
  /** Null for headings and unreadable leaves. */
  cpm: number | null;
  children: TreeNode[];
}

export type Source =
  | { kind: 'mine' }
  | { kind: 'rip'; url?: string; start?: number; end?: number; rippedAt?: string };

export interface Pattern {
  name: string;
  code: string;
  cpm: number;
  key: string;
  tags: string[];
  source: Source;
  notes: string;
}

/** Every library and watcher command; each takes the library root first. Errors reject with a string. */
export interface LibraryApi {
  list_tree(root: string): Promise<TreeNode>;
  read_pattern(root: string, path: string): Promise<Pattern>;
  /** Creates a new file in `headingPath`; resolves to its relative path. */
  write_pattern(root: string, headingPath: string, pattern: Pattern): Promise<string>;
  /** Overwrites an existing pattern file in place. */
  save_pattern(root: string, path: string, pattern: Pattern): Promise<void>;
  create_heading(root: string, parentPath: string, name: string): Promise<string>;
  rename_entry(root: string, path: string, newName: string): Promise<string>;
  move_entry(root: string, path: string, newParentPath: string): Promise<string>;
  /** Moves the entry to the Trash. */
  delete_entry(root: string, path: string): Promise<void>;
  ensure_library(root: string): Promise<void>;
  watch_library(root: string): Promise<void>;
  /** Subscribes to the watcher's `library-changed` event; resolves to the unlisten function. */
  onLibraryChanged(handler: (paths: string[]) => void): Promise<() => void>;
}

/** False in a plain browser tab (vite page), where `invoke` cannot reach Rust. */
export const hasTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const tauriApi: LibraryApi = {
  list_tree: (root) => invoke('list_tree', { root }),
  read_pattern: (root, path) => invoke('read_pattern', { root, path }),
  write_pattern: (root, headingPath, pattern) => invoke('write_pattern', { root, headingPath, pattern }),
  save_pattern: (root, path, pattern) => invoke('save_pattern', { root, path, pattern }),
  create_heading: (root, parentPath, name) => invoke('create_heading', { root, parentPath, name }),
  rename_entry: (root, path, newName) => invoke('rename_entry', { root, path, newName }),
  move_entry: (root, path, newParentPath) => invoke('move_entry', { root, path, newParentPath }),
  delete_entry: (root, path) => invoke('delete_entry', { root, path }),
  ensure_library: (root) => invoke('ensure_library', { root }),
  watch_library: (root) => invoke('watch_library', { root }),
  onLibraryChanged: (handler) => listen<{ paths: string[] }>('library-changed', (e) => handler(e.payload.paths)),
};
