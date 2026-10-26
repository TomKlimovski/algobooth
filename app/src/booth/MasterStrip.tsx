import { For } from 'solid-js';
import { DEFAULT_MASTER_CONTROLS, type MasterControl } from '../engine/controlMap';
import { Fader } from './Fader';

const CONTROLS: MasterControl[] = ['hpf', 'lpf', 'reverb', 'glue'];

/** Master section over the whole mix: filters, reverb, glue (bus compression), volume, and start/stop for both decks. */
export function MasterStrip(props: {
  values: Record<MasterControl, number>;
  onChange: (control: MasterControl, v: number) => void;
  onStartAll: () => void;
  onStopAll: () => void;
  disabled: boolean;
}) {
  return (
    <div class="master-strip" role="group" aria-label="master">
      <span class="master-label">master</span>
      <For each={CONTROLS}>
        {(control) => (
          <Fader
            label={control}
            value={props.values[control]}
            default={DEFAULT_MASTER_CONTROLS[control]}
            onChange={(v) => props.onChange(control, v)}
          />
        )}
      </For>
      <Fader
        label="volume"
        tall
        value={props.values.volume}
        default={DEFAULT_MASTER_CONTROLS.volume}
        onChange={(v) => props.onChange('volume', v)}
      />
      <div class="master-transport">
        <button class="deck-btn" disabled={props.disabled} onClick={props.onStartAll} title="Start both decks (Space)">
          ▶ all
        </button>
        <button class="deck-btn ghost" disabled={props.disabled} onClick={props.onStopAll} title="Stop both decks (Space)">
          ■ all
        </button>
      </div>
    </div>
  );
}
