import { createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { ContextMenu, type MenuItem } from '../../library/ContextMenu';
import { PREVIEW_DELAY_MS } from '../../library/LibraryTree';
import { findMethod, type MethodDoc } from '../../methods/catalogue';
import type { DeckId, DeckState } from '../deckState';
import { METHOD_MIME, type MethodDrag } from '../methodDrop';
import { FILL_MIME, type FillDrag } from '../../fills/FillPanel';
import { MethodTip } from '../MethodPanel';
import { ALT_X, ALT_Z, MOD_ENTER } from '../transportKeys';
import { LETTER_ROWS, labelOf, nameOf, SLOT_LETTER, type Quantise, type Slot, type SnapshotKey } from './bindings';
import { cueOf } from './cue';
import type { KeyController, ShownKey } from './KeyController';
import './keyStrip.css';

/** What a key dragged onto another carries: its slot, so the drop can move the binding. */
export const KEY_MIME = 'application/x-algobooth-key';

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const FKEYS: SnapshotKey[] = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'];
const QUANTISE: Quantise[] = ['now', 'beat', 'bar'];
const ROW_NAMES = ['q', 'a', 'z'];
const HINT = `tap commit · hold audition · shift/ctrl+key nudge · 1–9 line · F1–F8 snapshot · tab deck · esc edit · ${MOD_ENTER} play/stop · space both · \` stop all · ${ALT_Z} play/stop · ${ALT_X} update`;

type Action = Parameters<KeyController['menu']>[2];
/** The menu per layer: a pattern's key can go global, a global key can be hidden or pinned for this pattern. */
const MENU: Record<'pattern' | 'global', [string, Action][]> = {
  pattern: [
    ['clear', 'clear'],
    ['make global', 'global'],
  ],
  global: [
    ['clear', 'clear'],
    ['hide for this pattern', 'hide'],
    ['keep with this pattern', 'keep'],
  ],
};

/** A line key shows the code's own label, so a muted line reads `_fills` as it does in the editor. */
function labelFor(k: ShownKey): string {
  if (k.binding.kind === 'line') {
    const label = k.short ?? k.binding.label;
    return k.on ? label : `_${label}`;
  }
  return labelOf(k.binding);
}

/**
 * The method keyboard under a deck: the digit and F row, the three letter rows, and a hint line with the
 * quantise and perform toggles. It draws what the controller derives from the code and calls the controller
 * for everything a mouse does to it; it never edits or evaluates the deck itself.
 */
export function KeyStrip(props: {
  deck: DeckId;
  controller: KeyController;
  state: DeckState;
  perform: () => boolean;
  /** Whether this is the deck the letters play; the other deck's strip dims while performing. */
  performing: () => boolean;
  quantise: () => Quantise;
  setQuantise: (q: Quantise) => void;
}) {
  const shown = createMemo(() => props.controller.shown(props.deck));
  const cueName = createMemo(() => cueOf(props.state.state.liveCode)?.name ?? null);
  // Remembered for the booth session only; perform mode always shows the keys.
  const [folded, setFolded] = createSignal(false);
  const [dropSlot, setDropSlot] = createSignal<Slot | null>(null);
  const [menu, setMenu] = createSignal<{ slot: Slot; x: number; y: number; items: MenuItem[] } | null>(null);
  const [tip, setTip] = createSignal<{ method: MethodDoc; x: number; y: number } | null>(null);

  // The slot a mouse press is down on, so a release (or the pointer leaving) ends only a press it started.
  let mouseDown: Slot | null = null;
  // A Ctrl+click on macOS is also a contextmenu, sent before its pointerup; that one was a nudge, not the menu.
  let nudged = false;
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  const hideTip = () => {
    clearTimeout(tipTimer);
    tipTimer = undefined;
    setTip(null);
  };
  onCleanup(hideTip);

  const showTipLater = (slot: Slot, el: HTMLElement) => {
    clearTimeout(tipTimer);
    const k = shown()[slot];
    // A macro is named for its first part, so it shows that part's doc.
    const method = k && findMethod(nameOf(k.binding));
    if (!method) return;
    tipTimer = setTimeout(() => {
      const rect = el.getBoundingClientRect();
      // The strip is at the bottom of a deck, so the tip opens above the key.
      setTip({ method, x: rect.left, y: rect.top });
    }, PREVIEW_DELAY_MS);
  };

  const pointerDown = (slot: Slot, e: MouseEvent) => {
    if (e.button !== 0) return;
    hideTip();
    nudged = e.ctrlKey;
    if (e.shiftKey) props.controller.nudge(props.deck, slot, 'up');
    else if (e.ctrlKey) props.controller.nudge(props.deck, slot, 'down');
    else {
      mouseDown = slot;
      props.controller.press(props.deck, slot);
    }
  };
  const pointerUp = (slot: Slot) => {
    nudged = false;
    if (mouseDown !== slot) return;
    mouseDown = null;
    props.controller.release(props.deck, slot);
  };
  onCleanup(() => {
    if (mouseDown) props.controller.release(props.deck, mouseDown);
  });

  const openMenu = (slot: Slot, e: MouseEvent) => {
    e.preventDefault();
    if (nudged) {
      nudged = false;
      return;
    }
    hideTip();
    const owner = shown()[slot]?.owner;
    if (owner !== 'pattern' && owner !== 'global') return;
    const items = MENU[owner].map(([label, action]) => ({ label, action: () => props.controller.menu(props.deck, slot, action) }));
    setMenu({ slot, x: e.clientX, y: e.clientY, items });
  };

  const carries = (e: DragEvent, mime: string) => e.dataTransfer?.types.includes(mime) ?? false;
  /**
   * WebKit hands the drop to the last element that accepted `dragenter`, and the editor's contenteditable
   * accepts it implicitly as a drag from the panel crosses it; a key that only accepted `dragover` (enough for
   * Chromium) never became the target, and the method landed in the code. So a key accepts `dragenter` too.
   */
  const dragEnter = (e: DragEvent) => {
    if (carries(e, METHOD_MIME) || carries(e, FILL_MIME) || carries(e, KEY_MIME)) e.preventDefault();
  };
  const dragOver = (slot: Slot, e: DragEvent) => {
    const method = carries(e, METHOD_MIME) || carries(e, FILL_MIME);
    if (!method && !carries(e, KEY_MIME)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = method ? 'copy' : 'move';
    setDropSlot(slot);
  };
  const dropOn = (slot: Slot, e: DragEvent) => {
    setDropSlot(null);
    const from = e.dataTransfer?.getData(KEY_MIME);
    const raw = e.dataTransfer?.getData(METHOD_MIME);
    const fill = e.dataTransfer?.getData(FILL_MIME);
    if (!from && !raw && !fill) return;
    e.preventDefault();
    if (from) {
      if (from !== slot) props.controller.move(props.deck, from, slot);
      return;
    }
    if (fill) {
      try {
        const drag = JSON.parse(fill) as FillDrag;
        props.controller.dropFill(props.deck, slot, drag.fill, drag.mode);
      } catch {
        // not a fill this build knows
      }
      return;
    }
    let drag: MethodDrag;
    try {
      drag = JSON.parse(raw!) as MethodDrag;
    } catch {
      return;
    }
    if (drag.kind !== 'method') {
      props.state.setError('functions go in the editor, not on a key');
      return;
    }
    props.controller.drop(props.deck, slot, { name: drag.name, snippet: drag.snippet, argRange: drag.argRange });
  };

  const LetterKey = (p: { slot: Slot }) => {
    const k = () => shown()[p.slot];
    const line = () => k()?.binding.kind === 'line';
    return (
      <div
        class="key"
        classList={{
          bound: !!k(),
          on: !!k()?.on && !line(),
          held: !!k()?.held,
          pending: !!k()?.pending,
          refused: !!k()?.refused,
          line: line(),
          derived: k()?.owner === 'derived',
          cued: k()?.owner === 'cued',
          fill: k()?.binding.kind === 'fill',
          muted: line() && !k()!.on,
          drop: dropSlot() === p.slot,
        }}
        data-slot={p.slot}
        role="button"
        draggable={!!k() && k()!.owner !== 'derived' && k()!.owner !== 'cued'}
        onPointerDown={(e) => pointerDown(p.slot, e)}
        onPointerUp={() => pointerUp(p.slot)}
        onPointerLeave={() => pointerUp(p.slot)}
        onPointerCancel={() => pointerUp(p.slot)}
        onMouseEnter={(e) => showTipLater(p.slot, e.currentTarget)}
        onMouseLeave={hideTip}
        onContextMenu={(e) => openMenu(p.slot, e)}
        onDragStart={(e) => {
          hideTip();
          // A drag is not a press: no pointerup follows its start, and the key's toggle must not stand.
          if (mouseDown === p.slot) {
            mouseDown = null;
            props.controller.cancel(props.deck, p.slot);
          }
          e.dataTransfer!.setData(KEY_MIME, p.slot);
          e.dataTransfer!.effectAllowed = 'move';
        }}
        onDragEnter={dragEnter}
        onDragOver={(e) => dragOver(p.slot, e)}
        onDragLeave={() => dropSlot() === p.slot && setDropSlot(null)}
        onDrop={(e) => dropOn(p.slot, e)}
      >
        <span class="key-letter">{SLOT_LETTER[p.slot]}</span>
        <span class="key-label">{k() ? labelFor(k()!) : ''}</span>
      </div>
    );
  };

  return (
    <div
      class="key-strip"
      classList={{ folded: folded() && !props.perform(), dimmed: props.perform() && !props.performing() }}
      data-deck={props.deck}
      onDragEnd={() => setDropSlot(null)}
    >
      <div class="key-row" data-row="digits">
        <For each={DIGITS}>
          {(n) => (
            <div
              class="key num"
              classList={{ on: props.state.state.targetLine === n }}
              data-n={n}
              role="button"
              onClick={() => props.controller.selectLine(props.deck, n)}
            >
              {n}
            </div>
          )}
        </For>
        <span class="key-gap" />
        <For each={FKEYS}>
          {(f) => (
            <div
              class="key fn"
              classList={{ filled: props.state.state.keys.snapshots?.[f] !== undefined }}
              data-key={f}
              role="button"
              title={`${f} recall · shift+${f} save`}
              onClick={(e) => props.controller.snapshot(props.deck, f, e.shiftKey)}
            >
              {f}
            </div>
          )}
        </For>
      </div>
      <For each={LETTER_ROWS}>
        {(row, i) => (
          <div class="key-row" data-row={ROW_NAMES[i()]}>
            <For each={row}>{(slot) => <LetterKey slot={slot} />}</For>
          </div>
        )}
      </For>
      <div class="key-row key-hint" data-row="hint">
        <button
          class="key-fold"
          type="button"
          aria-expanded={!folded() || props.perform()}
          aria-label="show keys"
          onClick={() => setFolded((f) => !f)}
        >
          {!folded() || props.perform() ? '▾' : '▸'}
        </button>
        <span class="key-hint-text">{cueName() ? `${HINT} · home row: ${cueName()}` : HINT}</span>
        <span class="key-quantise" role="group" aria-label="key quantise">
          <For each={QUANTISE}>
            {(q) => (
              <button type="button" data-q={q} classList={{ on: props.quantise() === q }} onClick={() => props.setQuantise(q)}>
                {q}
              </button>
            )}
          </For>
        </span>
        <button class="key-perform" type="button" aria-pressed={props.perform()} onClick={() => props.controller.togglePerform()}>
          perform
        </button>
      </div>
      <Show when={tip()}>{(t) => <MethodTip method={t().method} x={t().x} y={t().y} above />}</Show>
      <Show when={menu()}>{(m) => <ContextMenu x={m().x} y={m().y} items={m().items} onClose={() => setMenu(null)} />}</Show>
    </div>
  );
}
