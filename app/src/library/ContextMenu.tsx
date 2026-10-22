import { For, onCleanup, onMount, Show } from 'solid-js';

export interface MenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separated?: boolean;
}

/** A small menu at (x, y) in viewport pixels; closes on an outside click, Escape, or after an item runs. */
export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  let menu!: HTMLDivElement;
  const onPointerDown = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) props.onClose();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Handled here, so the booth's Escape (perform mode) leaves it alone.
    e.preventDefault();
    props.onClose();
  };
  onMount(() => {
    // Capture, so a click on another row closes this menu before that row handles it.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    // Keep the whole menu on screen.
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(props.x, window.innerWidth - r.width))}px`;
    menu.style.top = `${Math.max(0, Math.min(props.y, window.innerHeight - r.height))}px`;
  });
  onCleanup(() => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
  });

  // Close first, so an item may open a follow-up menu (Move to…).
  const run = (item: MenuItem) => {
    props.onClose();
    item.action();
  };

  return (
    <div class="lib-menu" role="menu" ref={menu} style={{ left: `${props.x}px`, top: `${props.y}px` }} onContextMenu={(e) => e.preventDefault()}>
      <For each={props.items}>
        {(item) => (
          <>
            <Show when={item.separated}>
              <div class="lib-menu-sep" role="separator" />
            </Show>
            <button class="lib-menu-item" role="menuitem" disabled={item.disabled} onClick={() => run(item)}>
              {item.label}
            </button>
          </>
        )}
      </For>
    </div>
  );
}
