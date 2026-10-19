import { open } from '@tauri-apps/plugin-dialog';
import { createSignal, Show } from 'solid-js';
import { settings, settingsNotice, updateSettings, type Settings as SettingsValue } from './settings';
import './settings.css';

export function SettingsTab() {
  const [error, setError] = createSignal<string | null>(null);

  const save = async (patch: Partial<SettingsValue>) => {
    try {
      await updateSettings({ ...settings(), ...patch });
      setError(null);
    } catch (e) {
      setError(`Could not save settings: ${e}`);
    }
  };
  const choose = async () => {
    try {
      const dir = await open({ directory: true, defaultPath: settings().library_dir });
      if (typeof dir === 'string') await save({ library_dir: dir });
    } catch (e) {
      setError(`Could not open the folder chooser: ${e}`);
    }
  };

  return (
    <form class="settings" onSubmit={(e) => e.preventDefault()}>
      <Show when={settingsNotice()}>{(n) => <p class="settings-notice" role="status">{n()}</p>}</Show>
      <Show when={error()}>{(n) => <p class="settings-error" role="alert">{n()}</p>}</Show>

      <label class="settings-row">
        <span class="settings-label">Library folder</span>
        <input class="settings-input" type="text" readOnly value={settings().library_dir} />
        <button type="button" class="deck-btn ghost" onClick={choose}>Choose…</button>
      </label>

      <fieldset class="settings-row">
        <legend class="settings-label">Visualiser</legend>
        <label><input type="radio" name="visualiser" checked={settings().visualiser === 'pianoroll'} onChange={() => save({ visualiser: 'pianoroll' })} /> Pianoroll</label>
        <label><input type="radio" name="visualiser" checked={settings().visualiser === 'scope'} onChange={() => save({ visualiser: 'scope' })} /> Scope</label>
        <span class="settings-hint">Applies on the deck's next evaluation.</span>
      </fieldset>

      <fieldset class="settings-row">
        <legend class="settings-label">Engine</legend>
        <label><input type="radio" name="engine" checked={settings().engine === 'webaudio'} onChange={() => save({ engine: 'webaudio' })} /> Web Audio</label>
        <label class="settings-disabled"><input type="radio" name="engine" disabled /> SuperDirt via OSC <em>(coming later)</em></label>
      </fieldset>
    </form>
  );
}
