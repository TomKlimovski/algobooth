import { invoke } from '@tauri-apps/api/core';
import { createSignal } from 'solid-js';
import type { Layout, Quantise } from '../booth/keys/bindings';

export interface Settings {
  library_dir: string;
  visualiser: 'pianoroll' | 'scope';
  engine: 'webaudio' | 'superdirt';
  /** Where the analysis service keeps downloads, stems and analyses. */
  rip_cache_dir: string;
  keep_downloads: boolean;
  /** Optional; the tidy pass is off unless this is set. */
  claude_api_key: string;
  /** The default method keyboard layout, for patterns that carry none. */
  keys: Layout;
  key_quantise: Quantise;
}

export function defaultSettings(home: string): Settings {
  return {
    library_dir: `${home}/Algobooth/library`,
    visualiser: 'pianoroll',
    engine: 'webaudio',
    rip_cache_dir: `${home}/Algobooth/cache`,
    keep_downloads: false,
    claude_api_key: '',
    keys: { bindings: {} },
    key_quantise: 'bar',
  };
}

const [settings, setSettings] = createSignal<Settings>(defaultSettings('~'));
/** Set when the settings store could not be reached (no Tauri runtime); the UI shows defaults. */
const [settingsNotice, setNotice] = createSignal<string | null>(null);
export { settings, settingsNotice };

export const loadSettings = (): Promise<Settings> => invoke<Settings>('get_settings');
export const saveSettings = (s: Settings): Promise<void> => invoke<void>('set_settings', { settings: s });

/** Loads the stored settings into the signal, keeping defaults (with a notice) when that fails. */
export async function initSettings(): Promise<void> {
  try {
    setSettings(await loadSettings());
    setNotice(null);
  } catch {
    setNotice('Settings store unavailable (no Tauri runtime): showing defaults, changes will not persist.');
  }
}

/** Saves and, on success, publishes the new settings to the signal. */
export async function updateSettings(next: Settings): Promise<void> {
  await saveSettings(next);
  setSettings(next);
}
