import { createSignal, For, Match, onMount, Show, Switch } from 'solid-js';
import type { DeckId } from '../booth/deckState';
import type { TreeNode } from './api';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { findNode, parentOf, PATTERN_MIME, type LibraryStore } from './store';
import './library.css';

const INDENT_PX = 12;
const ROOT_LABEL = 'library (top)';

/** Errors land in `store.state.error`; the UI only needs to stop the rejection escaping. */
const quietly = (p: Promise<unknown>) => void p.catch(() => {});

const isDraggingEntry = (e: DragEvent) => e.dataTransfer?.types.includes(PATTERN_MIME) ?? false;

/** Every heading path except those that `path` cannot move into (itself, its subtree, its current parent). */
function moveTargets(root: TreeNode, path: string): string[] {
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind !== 'heading' || n.path === path || n.path.startsWith(path + '/')) return;
    if (n.path !== parentOf(path)) out.push(n.path);
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

/** "new heading", or "new heading 2", 3… if a sibling already has the name. */
function freeHeadingName(parent: TreeNode | null): string {
  const taken = new Set((parent?.children ?? []).map((c) => c.name.toLowerCase()));
  let name = 'new heading';
  for (let n = 2; taken.has(name); n++) name = `new heading ${n}`;
  return name;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

export function LibraryTree(props: { store: LibraryStore }) {
  const store = props.store;
  const [menu, setMenu] = createSignal<MenuState | null>(null);
  const [renaming, setRenaming] = createSignal<string | null>(null);
  const [dropTarget, setDropTarget] = createSignal<string | null>(null);

  const unfold = (path: string) => {
    if (store.state.folded.has(path)) store.toggleFold(path);
  };
  const startRename = (path: string) => {
    store.select(path);
    setRenaming(path);
  };
  const remove = (node: TreeNode) => {
    const what = node.kind === 'heading' ? `the heading "${node.name}" and everything in it` : `"${node.name}"`;
    if (window.confirm(`Move ${what} to the Trash?`)) quietly(store.remove(node.path));
  };
  const newHeading = (parent: string) =>
    quietly(
      store.createHeading(parent, freeHeadingName(findNode(store.state.root, parent))).then((path) => {
        unfold(parent);
        startRename(path);
      }),
    );
  const newPattern = (heading: string) =>
    quietly(
      store.newPattern(heading).then((path) => {
        unfold(heading);
        startRename(path);
      }),
    );

  const openMoveMenu = (node: TreeNode, x: number, y: number) => {
    const targets = store.state.root ? moveTargets(store.state.root, node.path) : [];
    setMenu({
      x,
      y,
      items: targets.length
        ? targets.map((t) => ({ label: t === '' ? ROOT_LABEL : t, action: () => quietly(store.move(node.path, t)) }))
        : [{ label: 'No other headings', action: () => {}, disabled: true }],
    });
  };

  const openMenu = (e: MouseEvent, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    store.select(node.path === '' ? null : node.path);
    const { clientX: x, clientY: y } = e;
    const items: MenuItem[] = [];
    if (node.path === '') {
      items.push({ label: 'New heading', action: () => newHeading('') }, { label: 'New pattern', action: () => newPattern('') });
    } else {
      const leaf = node.kind !== 'heading';
      const readable = node.kind === 'pattern';
      if (leaf) {
        const loadTo = (deck: DeckId) => () => quietly(store.load(node.path, deck));
        items.push({ label: 'Load to A', action: loadTo('A'), disabled: !readable }, { label: 'Load to B', action: loadTo('B'), disabled: !readable });
      }
      items.push(
        { label: 'Rename', action: () => startRename(node.path), disabled: node.kind === 'unreadable', separated: leaf },
        { label: 'Move to…', action: () => openMoveMenu(node, x, y) },
      );
      if (leaf) items.push({ label: 'Duplicate', action: () => quietly(store.duplicate(node.path)), disabled: !readable });
      items.push({ label: 'Delete', action: () => remove(node) });
      if (!leaf) {
        items.push(
          { label: 'New heading', action: () => newHeading(node.path), separated: true },
          { label: 'New pattern', action: () => newPattern(node.path) },
        );
      }
    }
    setMenu({ x, y, items });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (renaming() !== null || e.target instanceof HTMLInputElement) return;
    const node = store.state.selected === null ? null : findNode(store.state.root, store.state.selected);
    if (!node) return;
    if (e.key === 'F2' && node.kind !== 'unreadable') {
      e.preventDefault();
      startRename(node.path);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(node);
    }
  };

  // Drop target handlers for a heading (or the root, for the empty space below the rows).
  const dropOnto = (target: () => string) => ({
    onDragOver: (e: DragEvent) => {
      if (!isDraggingEntry(e)) return;
      // Swallow it either way, so a refused heading does not fall through to the root below it.
      e.stopPropagation();
      if (!store.canDrop({ heading: target() })) {
        setDropTarget(null);
        return;
      }
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      setDropTarget(target());
    },
    onDragLeave: () => setDropTarget((t) => (t === target() ? null : t)),
    onDrop: (e: DragEvent) => {
      const path = e.dataTransfer?.getData(PATTERN_MIME);
      const heading = target();
      setDropTarget(null);
      if (!path) return;
      e.preventDefault();
      e.stopPropagation();
      if (store.canDrop({ heading })) quietly(store.move(path, heading));
    },
  });

  function RenameInput(p: { node: TreeNode }) {
    let input!: HTMLInputElement;
    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      setRenaming(null);
      if (commit && name && name !== p.node.name) quietly(store.rename(p.node.path, name));
    };
    onMount(() => {
      input.focus();
      input.select();
    });
    return (
      <input
        class="lib-rename"
        ref={input}
        value={p.node.name}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
        onClick={(e) => e.stopPropagation()}
        onDblClick={(e) => e.stopPropagation()}
      />
    );
  }

  function Row(p: { node: TreeNode; depth: number }) {
    // `p.node` is a store proxy that refreshes update in place, so read its fields reactively.
    const path = () => p.node.path;
    const isHeading = () => p.node.kind === 'heading';
    const unreadable = () => p.node.kind === 'unreadable';
    const folded = () => store.state.folded.has(path());
    // Dropping onto a leaf drops into the heading it sits in.
    const drop = dropOnto(() => (isHeading() ? path() : parentOf(path())));
    return (
      <>
        <div
          class="lib-row"
          classList={{
            'lib-heading': isHeading(),
            'lib-unreadable': unreadable(),
            sel: store.state.selected === path(),
            'drop-target': dropTarget() === path(),
          }}
          style={{ 'padding-left': `${4 + p.depth * INDENT_PX}px` }}
          title={unreadable() ? 'This file is not a valid pattern' : path()}
          draggable={renaming() !== path()}
          onDragStart={(e) => {
            e.dataTransfer!.setData(PATTERN_MIME, path());
            e.dataTransfer!.effectAllowed = 'copyMove';
            store.setDragging(path());
          }}
          onDragEnd={() => {
            store.setDragging(null);
            setDropTarget(null);
          }}
          onClick={() => store.select(path())}
          onDblClick={() => (isHeading() ? store.toggleFold(path()) : quietly(store.loadToIdleDeck(path())))}
          onContextMenu={(e) => openMenu(e, p.node)}
          {...drop}
        >
          <Show when={isHeading()}>
            <span
              class="lib-disclosure"
              onClick={(e) => {
                e.stopPropagation();
                store.toggleFold(path());
              }}
              onDblClick={(e) => e.stopPropagation()}
            >
              {folded() ? '▸' : '▾'}
            </span>
          </Show>
          <Show when={unreadable()}>
            <span class="lib-warn" aria-label="not a valid pattern">⚠</span>
          </Show>
          <Show when={renaming() === path()} fallback={<span class="lib-name">{p.node.name}</span>}>
            <RenameInput node={p.node} />
          </Show>
          <Show when={p.node.cpm !== null}>
            <span class="lib-cpm">{p.node.cpm}</span>
          </Show>
        </div>
        <Show when={isHeading() && !folded()}>
          <For each={p.node.children}>{(child) => <Row node={child} depth={p.depth + 1} />}</For>
        </Show>
      </>
    );
  }

  const toggleCollapsed = () => store.setCollapsed(!store.state.collapsed);

  return (
    <div class="lib" classList={{ collapsed: store.state.collapsed }}>
      <header class="lib-header">
        <Show when={!store.state.collapsed}>
          <span class="lib-title">Library</span>
        </Show>
        <button
          class="lib-handle"
          onClick={toggleCollapsed}
          aria-label={store.state.collapsed ? 'show library' : 'fold library away'}
          aria-expanded={!store.state.collapsed}
          title={store.state.collapsed ? 'Show library' : 'Fold library away'}
        >
          {store.state.collapsed ? '▸' : '◂'}
        </button>
        <Show when={store.state.collapsed && store.state.watchWarning}>
          {(w) => (
            <span class="lib-watch-glyph" role="img" aria-label={w()} title={w()}>⚠</span>
          )}
        </Show>
      </header>
      <Show when={!store.state.collapsed && store.state.watchWarning}>
        {(w) => <div class="lib-watch" role="status">⚠ {w()}</div>}
      </Show>
      <Show when={!store.state.collapsed}>
        <Show when={store.state.error}>
          {(err) => (
            <div class="lib-error" role="alert">
              <span>{err()}</span>
              <button class="lib-error-close" aria-label="dismiss" onClick={() => store.setError(null)}>×</button>
            </div>
          )}
        </Show>
        <div
          class="lib-tree"
          classList={{ 'drop-target': dropTarget() === '' }}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onContextMenu={(e) => store.state.root && openMenu(e, store.state.root)}
          onClick={(e) => e.target === e.currentTarget && store.select(null)}
          {...dropOnto(() => '')}
        >
          <Switch>
            <Match when={store.state.root}>
              {(root) => (
                <Show when={root().children.length} fallback={<p class="lib-empty">Empty library. Right-click to add a heading.</p>}>
                  <For each={root().children}>{(child) => <Row node={child} depth={0} />}</For>
                </Show>
              )}
            </Match>
            <Match when={!store.state.error}>
              <p class="lib-empty">loading library…</p>
            </Match>
          </Switch>
        </div>
      </Show>
      <Show when={menu()}>{(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}</Show>
    </div>
  );
}
