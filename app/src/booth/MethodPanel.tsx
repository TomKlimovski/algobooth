import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { PREVIEW_DELAY_MS } from '../library/LibraryTree';
import { catalogue, FUNCTION_GROUPS, GROUPS, type MethodDoc } from '../methods/catalogue';
import { METHOD_MIME, type MethodDrag } from './methodDrop';
import './methodPanel.css';

/** Keeps the tooltip this far inside the window when the row is near the bottom. */
export const TIP_MARGIN_PX = 8;

/**
 * Where a tip of `height` goes so it stays inside the window. Beside its anchor it opens at `y`, pulled back
 * up when it would run off the bottom; `above` it opens over `y` (the anchor's top), as the key strip at the
 * bottom of a deck wants, and drops no higher than the window's top.
 */
export function tipTop(y: number, height: number, above = false): number {
  if (above) return Math.max(TIP_MARGIN_PX, y - height - TIP_MARGIN_PX);
  const overflow = y + height - (window.innerHeight - TIP_MARGIN_PX);
  return overflow > 0 ? Math.max(TIP_MARGIN_PX, y - overflow) : y;
}

/**
 * A method's description, snippet, synonyms and parameters, fixed at (x, y) in viewport pixels. The Methods
 * panel's CSS opens it leftwards of its row; `above` opens it over the anchor instead, kept inside the window.
 */
export function MethodTip(props: { method: MethodDoc; x: number; y: number; above?: boolean }) {
  let el!: HTMLDivElement;
  // Its size is known only once shown, so the fit is a second step.
  createEffect(() => {
    el.style.top = `${tipTop(props.y, el.offsetHeight, props.above)}px`;
    if (!props.above) return;
    const right = props.x + el.offsetWidth - (window.innerWidth - TIP_MARGIN_PX);
    el.style.left = `${Math.max(TIP_MARGIN_PX, right > 0 ? props.x - right : props.x)}px`;
  });
  return (
    <div ref={el} class="method-tip" role="tooltip" style={{ left: `${props.x}px`, top: `${props.y}px` }}>
      <code class="method-tip-snippet">{props.method.snippet}</code>
      <p>{props.method.description}</p>
      <Show when={props.method.synonyms.length}>
        <p class="method-tip-dim">also: {props.method.synonyms.join(', ')}</p>
      </Show>
      <For each={props.method.params}>{(p) => <div class="method-tip-param">{p.name}: {p.type}</div>}</For>
      <Show when={props.method.note}>{(note) => <p class="method-tip-note">{note()}</p>}</Show>
    </div>
  );
}

const toDrag = (m: MethodDoc): MethodDrag => ({ name: m.name, snippet: m.snippet, argRange: m.argRange, kind: m.kind, group: m.group });

const matches = (m: MethodDoc, q: string) =>
  m.name.toLowerCase().includes(q) || m.synonyms.some((s) => s.toLowerCase().includes(q)) || m.description.toLowerCase().includes(q);

/** The two sections of the panel: each kind of row with its own folder order and heading. */
const SECTIONS: { kind: MethodDoc['kind']; title: string; groups: string[] }[] = [
  { kind: 'method', title: 'Methods', groups: GROUPS },
  { kind: 'function', title: 'Functions', groups: FUNCTION_GROUPS },
];

/**
 * Strudel's chainable methods and standalone functions in folders; drag one onto a deck, or double-click to
 * insert it. A method lands at the end of a line, a function where the pointer is.
 */
export function MethodPanel(props: { onInsert?: (drag: MethodDrag) => void }) {
  const [query, setQuery] = createSignal('');
  // Folder names the user opened; kept for the app's lifetime, not persisted.
  const [open, setOpen] = createSignal<Set<string>>(new Set());
  const toggle = (group: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (!next.delete(group)) next.add(group);
      return next;
    });

  // Folder keys are "kind/group", so a method folder and a function folder never share an open state.
  const sections = createMemo(() => {
    const q = query().trim().toLowerCase();
    return SECTIONS.map((s) => ({
      ...s,
      folders: s.groups
        .map((group) => ({
          key: `${s.kind}/${group}`,
          group,
          methods: catalogue.methods.filter((m) => m.kind === s.kind && m.group === group && (!q || matches(m, q))),
        }))
        .filter((f) => f.methods.length > 0),
    })).filter((s) => s.folders.length > 0);
  });
  // A search shows every folder with a hit expanded, whatever the user had open.
  const expanded = (key: string) => query().trim() !== '' || open().has(key);

  // The tooltip, beside the row once the pointer (or focus) has rested on it, as the library's preview.
  const [tip, setTip] = createSignal<{ method: MethodDoc; x: number; y: number } | null>(null);
  let tipTimer: ReturnType<typeof setTimeout> | undefined;
  const hideTip = () => {
    clearTimeout(tipTimer);
    tipTimer = undefined;
    setTip(null);
  };
  const showTipLater = (method: MethodDoc, row: HTMLElement) => {
    clearTimeout(tipTimer);
    tipTimer = setTimeout(() => {
      const rect = row.getBoundingClientRect();
      // The panel sits at the window's right edge, so the tip opens to the row's left.
      setTip({ method, x: rect.left - TIP_MARGIN_PX, y: rect.top });
    }, PREVIEW_DELAY_MS);
  };
  onCleanup(hideTip);

  return (
    <div class="methods" onMouseLeave={hideTip}>
      <header class="methods-header">
        <span class="methods-title">Methods</span>
      </header>
      <input
        class="method-search"
        type="search"
        placeholder="search"
        aria-label="search methods"
        spellcheck={false}
        value={query()}
        onInput={(e) => {
          hideTip();
          setQuery(e.currentTarget.value);
        }}
      />
      <Show when={tip()}>{(t) => <MethodTip method={t().method} x={t().x} y={t().y} />}</Show>
      <div class="methods-tree">
        <For each={sections()}>
          {(s) => (
            <section class="methods-section" data-kind={s.kind}>
              <h2 class="methods-section-title">{s.title}</h2>
        <For each={s.folders}>
          {(f) => (
            <>
              <button class="method-folder" aria-expanded={expanded(f.key)} onClick={() => toggle(f.key)}>
                <span class="method-disclosure">{expanded(f.key) ? '▾' : '▸'}</span>
                <span class="method-folder-name">{f.group}</span>
                <span class="method-count">{f.methods.length}</span>
              </button>
              <Show when={expanded(f.key)}>
                <For each={f.methods}>
                  {(m) => (
                    <div
                      class="method-row"
                      data-name={m.name}
                      draggable={true}
                      tabIndex={0}
                      onDragStart={(e) => {
                        hideTip();
                        e.dataTransfer!.setData('text/plain', m.snippet);
                        e.dataTransfer!.setData(METHOD_MIME, JSON.stringify(toDrag(m)));
                        e.dataTransfer!.effectAllowed = 'copy';
                      }}
                      onMouseEnter={(e) => showTipLater(m, e.currentTarget)}
                      onMouseLeave={hideTip}
                      onFocus={(e) => showTipLater(m, e.currentTarget)}
                      onBlur={hideTip}
                      onDblClick={() => {
                        hideTip();
                        props.onInsert?.(toDrag(m));
                      }}
                    >
                      {m.name}
                    </div>
                  )}
                </For>
              </Show>
            </>
          )}
        </For>
            </section>
          )}
        </For>
      </div>
    </div>
  );
}
