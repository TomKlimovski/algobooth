import { createEffect, createMemo, createSignal, on, onCleanup, onMount, Show } from 'solid-js';
import { Booth } from './booth/Booth';
import type { DeckApi } from './booth/Deck';
import type { DeckId } from './booth/deckState';
import { hasTauriRuntime, tauriApi } from './library/api';
import { createLibraryStore } from './library/store';
import { RipPlaceholder } from './rip/RipPlaceholder';
import { initSettings, settings } from './settings/settings';
import { SettingsTab } from './settings/SettingsTab';
import { Tabs } from './shell/Tabs';

export function App() {
  const [tab, setTab] = createSignal('booth');
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  /** Why `ensure_library` refused the configured folder; shown as a banner linking to Settings. */
  const [libraryError, setLibraryError] = createSignal<string | null>(null);

  let boothDecks: () => Record<DeckId, DeckApi | null> = () => ({ A: null, B: null });
  const library = createLibraryStore(tauriApi, () => boothDecks(), () => settings().library_dir);
  const refresh = () => void library.refresh().catch(() => {});

  // Settings load here, before anything reads `library_dir` (they used to load in SettingsTab's onMount).
  onMount(async () => {
    await initSettings();
    setSettingsLoaded(true);
  });

  // Each connect bumps the generation; a slower, older connect that finishes late drops its listener.
  let generation = 0;
  let unlisten: (() => void) | undefined;
  const disconnect = () => {
    generation++;
    unlisten?.();
    unlisten = undefined;
  };
  const connect = async (dir: string) => {
    disconnect();
    const gen = generation;
    if (!hasTauriRuntime()) {
      library.setError('No Tauri runtime: the library needs the desktop app.');
      return;
    }
    try {
      await tauriApi.ensure_library(dir);
    } catch (e) {
      if (gen === generation) setLibraryError(String(e));
      return;
    }
    if (gen !== generation) return;
    setLibraryError(null);
    try {
      await tauriApi.watch_library(dir);
      const off = await tauriApi.onLibraryChanged(refresh);
      if (gen !== generation) return off();
      unlisten = off;
    } catch (e) {
      if (gen === generation) library.setError(`Live refresh is off: ${e}`);
    }
    if (gen === generation) refresh();
  };
  // A memo, so saving an unrelated setting (the visualiser) does not reconnect.
  const libraryDir = createMemo(() => (settingsLoaded() ? settings().library_dir : null));
  createEffect(on(libraryDir, (dir) => dir !== null && void connect(dir)));
  onCleanup(disconnect);

  return (
    <div class="app">
      <Show when={libraryError()}>
        {(err) => (
          <div class="app-banner" role="alert">
            <span>Library folder unavailable: {err()}</span>
            <button class="deck-btn ghost" onClick={() => setTab('settings')}>Open Settings</button>
          </div>
        )}
      </Show>
      <Tabs
        active={tab()}
        onSelect={setTab}
        tabs={[
          { id: 'booth', label: 'Booth', view: () => <Booth library={library} onDecks={(get) => (boothDecks = get)} /> },
          { id: 'rip', label: 'Rip', view: () => <RipPlaceholder /> },
          { id: 'settings', label: 'Settings', view: () => <SettingsTab /> },
        ]}
      />
    </div>
  );
}
