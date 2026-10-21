import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { PREVIEW_DELAY_MS } from '../library/LibraryTree';
import { catalogue, FUNCTION_GROUPS, GROUPS, type MethodDoc } from '../methods/catalogue';
import { METHOD_MIME, type MethodDrag } from './methodDrop';
import './methodPanel.css';

/** Keeps the tooltip this far inside the window when the row is near the bottom. */
const TIP_MARGIN_PX = 8;

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
  let tipEl: HTMLDivElement | undefined;
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
  // Pull a tip that would run off the bottom of the window back up; its height is known only once shown.
  createEffect(() => {
    const t = tip();
    if (!t || !tipEl) return;
    const overflow = t.y + tipEl.offsetHeight - (window.innerHeight - TIP_MARGIN_PX);
    if (overflow > 0) tipEl.style.top = `${Math.max(TIP_MARGIN_PX, t.y - overflow)}px`;
  });
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
      <Show when={tip()}>
        {(t) => (
          <div ref={tipEl} class="method-tip" role="tooltip" style={{ left: `${t().x}px`, top: `${t().y}px` }}>
            <code class="method-tip-snippet">{t().method.snippet}</code>
            <p>{t().method.description}</p>
            <Show when={t().method.synonyms.length}>
              <p class="method-tip-dim">also: {t().method.synonyms.join(', ')}</p>
            </Show>
            <For each={t().method.params}>{(p) => <div class="method-tip-param">{p.name}: {p.type}</div>}</For>
            <Show when={t().method.note}>{(note) => <p class="method-tip-note">{note()}</p>}</Show>
          </div>
        )}
      </Show>
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
