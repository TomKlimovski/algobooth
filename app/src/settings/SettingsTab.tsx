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
  const chooseFolder = async (key: 'library_dir' | 'rip_cache_dir') => {
    try {
      const dir = await open({ directory: true, defaultPath: settings()[key] });
      if (typeof dir === 'string') await save({ [key]: dir });
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
        <button type="button" class="deck-btn ghost" onClick={() => chooseFolder('library_dir')}>Choose…</button>
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

      <fieldset class="settings-group">
        <legend class="settings-label">Rip</legend>
        <label class="settings-row">
          <span class="settings-label">Cache folder</span>
          <input class="settings-input" type="text" readOnly value={settings().rip_cache_dir} />
          <button type="button" class="deck-btn ghost" onClick={() => chooseFolder('rip_cache_dir')}>Choose…</button>
          <span class="settings-hint">Changing the cache folder restarts the analysis service</span>
        </label>
        <label class="settings-row">
          <span class="settings-label" />
          <input type="checkbox" checked={settings().keep_downloads} onChange={(e) => save({ keep_downloads: e.currentTarget.checked })} />
          Keep downloaded audio
        </label>
        <label class="settings-row">
          <span class="settings-label">Claude API key (optional, for the tidy pass)</span>
          <input
            class="settings-input"
            type="password"
            autocomplete="off"
            value={settings().claude_api_key}
            onChange={(e) => save({ claude_api_key: e.currentTarget.value.trim() })}
          />
        </label>
        <span class="settings-hint">Off unless a key is set and Tidy is ticked on the Rip tab</span>
      </fieldset>
    </form>
  );
}
