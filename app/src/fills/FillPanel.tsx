import { For } from 'solid-js';
import { FILLS, type Fill, type FillMode } from '../booth/keys/fills';
import './fillPanel.css';

/** What a fill dragged from the panel carries; the payload is `{ fill, mode }` as JSON. */
export const FILL_MIME = 'application/x-algobooth-fill';
export interface FillDrag { fill: string; mode: FillMode }

const MODES: [FillMode, string, string][] = [
  ['inject', 'inject', 'play it over the track'],
  ['switch', 'switch', "mute the deck's drum lines while it plays"],
];

/**
 * The Fills panel: the catalogue in `keys/fills.ts`, each with an inject and a switch button. A click plays the
 * fill on the performing deck from the next bar line; either button dragged onto a key binds it there.
 */
export function FillPanel(props: {
  /** The performing deck's playing fill, by name, so its row lights up. */
  playing: () => string | null;
  onFire: (fill: string, mode: FillMode) => void;
}) {
  const bars = (f: Fill) => `${f.bars} bar${f.bars > 1 ? 's' : ''}`;
  return (
    <div class="fills">
      <p class="fills-hint">Lands on the next bar and goes out on its own. Drag a button onto a key to play it from the keyboard; hold the key to keep it going.</p>
      <div class="fills-list">
        <For each={FILLS}>
          {(f) => (
            <div class="fill-row" classList={{ playing: props.playing() === f.name }} data-fill={f.id}>
              <div class="fill-head">
                <span class="fill-name">{f.name}</span>
                <span class="fill-bars">{bars(f)}</span>
              </div>
              <div class="fill-about">{f.about}</div>
              <div class="fill-modes">
                <For each={MODES}>
                  {([mode, label, title]) => (
                    <button
                      class="fill-mode"
                      classList={{ preferred: f.mode === mode }}
                      title={title}
                      draggable={true}
                      onDragStart={(e) => {
                        e.dataTransfer!.setData(FILL_MIME, JSON.stringify({ fill: f.id, mode } satisfies FillDrag));
                        e.dataTransfer!.effectAllowed = 'copy';
                      }}
                      onClick={() => props.onFire(f.id, mode)}
                    >
                      {label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
