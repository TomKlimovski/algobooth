import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Layout } from '../booth/keys/bindings';

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
  /** The deck's method keyboard layout; absent when the pattern has none. */
  keys?: Layout;
}

/**
 * Every library and watcher command. Paths are relative to the library folder, which Rust owns (it
 * follows the saved `library_dir` setting); the webview never names it. Errors reject with a string.
 */
export interface LibraryApi {
  list_tree(): Promise<TreeNode>;
  read_pattern(path: string): Promise<Pattern>;
  /** Creates a new file in `headingPath`; resolves to its relative path. */
  write_pattern(headingPath: string, pattern: Pattern): Promise<string>;
  /** Overwrites an existing pattern file in place. */
  save_pattern(path: string, pattern: Pattern): Promise<void>;
  create_heading(parentPath: string, name: string): Promise<string>;
  rename_entry(path: string, newName: string): Promise<string>;
  move_entry(path: string, newParentPath: string): Promise<string>;
  /** Moves the entry to the Trash. */
  delete_entry(path: string): Promise<void>;
  /** Creates (and seeds) the library folder if missing and checks it is writable. */
  ensure_library(): Promise<void>;
  /** Watches the library folder, replacing any earlier watch. */
  watch_library(): Promise<void>;
  /** Subscribes to the watcher's `library-changed` event; resolves to the unlisten function. */
  onLibraryChanged(handler: (paths: string[]) => void): Promise<() => void>;
}

/** False in a plain browser tab (vite page), where `invoke` cannot reach Rust. */
export const hasTauriRuntime = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const tauriApi: LibraryApi = {
  list_tree: () => invoke('list_tree'),
  read_pattern: (path) => invoke('read_pattern', { path }),
  write_pattern: (headingPath, pattern) => invoke('write_pattern', { headingPath, pattern }),
  save_pattern: (path, pattern) => invoke('save_pattern', { path, pattern }),
  create_heading: (parentPath, name) => invoke('create_heading', { parentPath, name }),
  rename_entry: (path, newName) => invoke('rename_entry', { path, newName }),
  move_entry: (path, newParentPath) => invoke('move_entry', { path, newParentPath }),
  delete_entry: (path) => invoke('delete_entry', { path }),
  ensure_library: () => invoke('ensure_library'),
  watch_library: () => invoke('watch_library'),
  onLibraryChanged: (handler) => listen<{ paths: string[] }>('library-changed', (e) => handler(e.payload.paths)),
};
