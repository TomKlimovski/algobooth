import { open } from '@tauri-apps/plugin-dialog';
import { createSignal, For, Show } from 'solid-js';
import { EMPTY_LAYOUT, type Quantise } from '../booth/keys/bindings';
import { settings, settingsNotice, updateSettings, type Settings as SettingsValue } from './settings';
import './settings.css';

const QUANTISE: Quantise[] = ['now', 'beat', 'bar'];

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

  // The global layout only: a pattern's own keys live in its file and are left alone.
  const resetKeys = () => {
    if (window.confirm('Reset the global key layout? Patterns keep their own keys.')) void save({ keys: EMPTY_LAYOUT });
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
        <legend class="settings-label">Keys</legend>
        <div class="settings-row">
          <span class="settings-label">Key presses land</span>
          <For each={QUANTISE}>
            {(q) => (
              <label>
                <input type="radio" name="key_quantise" checked={settings().key_quantise === q} onChange={() => save({ key_quantise: q })} /> {q}
              </label>
            )}
          </For>
        </div>
        <div class="settings-row">
          <span class="settings-label" />
          <button type="button" class="deck-btn ghost" onClick={resetKeys}>Reset key layout</button>
        </div>
        <span class="settings-hint">
          On a Mac, F1–F8 reach the app only with “Use F1, F2, etc. keys as standard function keys” on in System Settings → Keyboard, or with Fn held.
        </span>
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
