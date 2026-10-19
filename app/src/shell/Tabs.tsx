import { createSignal, For, type JSX } from 'solid-js';
import './tabs.css';

export interface TabDef {
  id: string;
  label: string;
  view: () => JSX.Element;
}

// Every tab stays mounted (hidden when inactive) so the booth keeps playing while you visit Settings.
export function Tabs(props: { tabs: TabDef[]; initial?: string }) {
  const [active, setActive] = createSignal(props.initial ?? props.tabs[0].id);
  return (
    <div class="shell">
      <nav class="shell-tabs" role="tablist">
        <For each={props.tabs}>
          {(tab) => (
            <button
              class="shell-tab"
              classList={{ on: active() === tab.id }}
              role="tab"
              aria-selected={active() === tab.id}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          )}
        </For>
      </nav>
      <For each={props.tabs}>
        {(tab) => (
          <div class="shell-pane" role="tabpanel" hidden={active() !== tab.id}>
            {tab.view()}
          </div>
        )}
      </For>
    </div>
  );
}
