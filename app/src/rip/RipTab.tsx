import { createEffect, createSignal, For, on, onCleanup, onMount, Show } from 'solid-js';
import { getAudioContext } from '@strudel/webaudio';
import type { DeckApi } from '../booth/Deck';
import type { DeckId } from '../booth/deckState';
import { SaveDialog, type SaveTarget } from '../booth/SaveDialog';
import { getMixer } from '../engine/mixer';
import { hasTauriRuntime } from '../library/api';
import type { LibraryStore } from '../library/store';
import { settings } from '../settings/settings';
import { abGains, Audition, loopBounds, type AbSide } from './audition';
import { loadToDeck } from './deckLoad';
// The extension is explicit: on a case-insensitive disk './ModelSetup' would resolve to modelSetup.ts.
import { ModelSetup } from './ModelSetup.tsx';
import { ResultEditor, type ResultApi } from './ResultEditor';
import { RipClient, serviceApi, STEM_NAMES, type ServiceStatus, type Stage } from './ripApi';
import { defaultName, ripPattern } from './ripPattern';
import { createRipStore } from './ripStore';
import './rip.css';

const MESSAGE_MS = 3000;
const DECK_IDS: DeckId[] = ['A', 'B'];

const STAGE_LABEL: Record<Stage, string> = {
  download: 'Download',
  separate: 'Separate stems',
  analyse: 'Analyse',
  generate: 'Generate Strudel',
  tidy: 'Tidy with Claude',
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function RipTab(props: {
  library: LibraryStore;
  decks: () => Record<DeckId, DeckApi | null>;
  active: () => boolean;
  onLoadedToDeck: (id: DeckId) => void;
}) {
  const [client, setClient] = createSignal<RipClient | null>(null);
  const store = createRipStore({ client, settings });
  const state = store.state;
  onCleanup(store.dispose);
  const audition = new Audition(() => getAudioContext());
  let result: ResultApi | undefined;

  /** Which stems of the current rip are decoded and playable. */
  const [loaded, setLoaded] = createSignal<ReadonlySet<string>>(new Set());
  const [side, setSide] = createSignal<AbSide>('result');
  /** Play A/B is running: the mix and the result both play, the toggle picks which one is heard. */
  const [abActive, setAbActive] = createSignal(false);
  const [resultPlaying, setResultPlaying] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [notice, setNotice] = createSignal<string | null>(null);
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const flash = (text: string) => {
    clearTimeout(noticeTimer);
    setNotice(text);
    noticeTimer = setTimeout(() => setNotice(null), MESSAGE_MS);
  };
  onCleanup(() => clearTimeout(noticeTimer));

  // --- the analysis service -------------------------------------------------------------------

  /** Bumped on every status, so a slow `service_info` from before a restart cannot install a stale client. */
  let infoGeneration = 0;
  const connect = async () => {
    const mine = ++infoGeneration;
    try {
      const info = await serviceApi.info();
      if (mine !== infoGeneration) return;
      setClient(new RipClient(info));
      void store.refreshModels();
    } catch (e) {
      if (mine !== infoGeneration) return;
      setClient(null);
      // `service_info` waits through a start, so a refusal means the service is down.
      if (state.service?.state !== 'stopped') store.onServiceStatus({ state: 'failed', error: message(e) });
    }
  };
  const onStatus = (s: ServiceStatus) => {
    store.onServiceStatus(s);
    if (s.state === 'running') void connect();
    else {
      infoGeneration++;
      setClient(null);
    }
  };
  const retry = async () => {
    store.onServiceStatus({ state: 'starting' });
    try {
      await serviceApi.restart();
    } catch (e) {
      store.onServiceStatus({ state: 'failed', error: message(e) });
      return;
    }
    void connect(); // the `running` event does the same; whichever is first wins
  };

  onMount(() => {
    if (!hasTauriRuntime()) {
      store.onServiceStatus({ state: 'failed', error: 'the Rip tab needs the desktop app' });
      return;
    }
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void serviceApi
      .onStatus(onStatus)
      .then((off) => (disposed ? off() : (unlisten = off)))
      .catch(() => {});
    // The supervisor may have reported `running` before this listener existed.
    void connect();
    onCleanup(() => {
      disposed = true;
      unlisten?.();
    });
  });

  // --- stems and A/B ---------------------------------------------------------------------------

  const loop = () => (state.result ? loopBounds(state.result.analysis) : undefined);

  // Each new result decodes its stems; a newer rip makes an older fetch drop its stems.
  let stemGeneration = 0;
  createEffect(
    on(
      () => state.result,
      (res) => {
        const mine = ++stemGeneration;
        stopAll();
        audition.clear();
        setLoaded(new Set<string>());
        const c = client();
        const id = state.job?.id;
        if (!res || !c || !id) return;
        for (const name of res.stems) {
          void c
            .stem(id, name)
            .then((bytes) => (mine === stemGeneration ? audition.load(name, bytes) : undefined))
            .then(() => {
              if (mine === stemGeneration) setLoaded((prev) => new Set([...prev, name]));
            })
            .catch((e) => mine === stemGeneration && flash(`Could not load the ${name} stem: ${message(e)}`));
        }
      },
    ),
  );

  const applyAb = () => {
    const g = abGains(side());
    audition.setGain(g.original);
    getMixer()?.setRipGain(g.result);
  };
  const leaveAb = () => {
    if (!abActive()) return;
    setAbActive(false);
    audition.setGain(1);
    getMixer()?.setRipGain(1);
  };

  const toggleStem = (name: string) => {
    if (audition.playing() === name && !abActive()) return audition.stop();
    // Leaving A/B for a stem: the result stops with it (its onToggle ends A/B and restores the gains).
    if (abActive()) result?.stop();
    leaveAb();
    void getAudioContext().resume().catch(() => {});
    audition.play(name, loop());
  };

  /** The result and the original mix together on the same bars; the toggle decides which one is heard. */
  const playAb = async () => {
    if (!result) return;
    audition.stop();
    if (result.scheduler.started) result.stop();
    setAbActive(true);
    applyAb();
    const startMix = (started: boolean) => {
      if (!started) return;
      result?.onToggle.delete(startMix);
      if (abActive()) audition.play('mix', loop());
    };
    result.onToggle.add(startMix);
    await result.play();
    if (!result.scheduler.started) {
      result.onToggle.delete(startMix); // the code failed to evaluate (the editor shows why)
      leaveAb();
    }
  };

  const pickSide = (next: AbSide) => {
    setSide(next);
    if (abActive()) applyAb();
  };

  const playResult = () => {
    if (abActive()) {
      audition.stop();
      leaveAb();
    }
    getMixer()?.setRipGain(1);
    void result?.play();
  };

  function stopAll() {
    result?.stop();
    audition.stop();
    leaveAb();
  }

  const onResultReady = (api: ResultApi) => {
    result = api;
    api.onToggle.add((started) => {
      setResultPlaying(started);
      // The result stopped some other way (Ctrl+. in its editor): A/B ends with it.
      if (!started && abActive()) {
        audition.stop();
        leaveAb();
      }
    });
  };

  // Leaving the tab silences it; the booth is what should be heard there.
  createEffect(
    on(props.active, (active) => {
      if (!active) stopAll();
    }),
  );
  onCleanup(stopAll);

  // --- save and load ---------------------------------------------------------------------------

  const suggestedName = () => {
    const res = state.result;
    const sent = store.sent();
    return res && sent ? defaultName(res.title, sent.start) : 'ripped';
  };
  const currentPattern = (name: string) => {
    const res = state.result;
    const sent = store.sent();
    return res && sent ? ripPattern(res, sent, name, state.code) : null;
  };

  const save = async (target: SaveTarget | null) => {
    setSaving(false);
    const pattern = target && currentPattern(target.name);
    if (!target || !pattern) return;
    try {
      const path = await props.library.writePattern(target.heading, pattern);
      flash(`Saved to ${path}`);
    } catch (e) {
      flash(`Save failed: ${message(e)}`);
    }
  };

  const loadTo = async (id: DeckId) => {
    const pattern = currentPattern(suggestedName());
    if (!pattern) return;
    const deck = props.decks()[id];
    if (!deck) return flash(`Deck ${id} is not ready yet`);
    try {
      if (await loadToDeck(deck, pattern, (q) => window.confirm(q))) props.onLoadedToDeck(id);
    } catch (e) {
      flash(`Load failed: ${message(e)}`);
    }
  };

  // --- the progress rows -----------------------------------------------------------------------

  type RowState = 'done' | 'current' | 'failed' | 'waiting';
  const rowState = (stage: Stage): RowState => {
    const job = state.job;
    if (!job) return 'waiting';
    if (job.status === 'done') return 'done';
    const rows = store.stageRows();
    const at = job.stage === null ? -1 : rows.indexOf(job.stage);
    const mine = rows.indexOf(stage);
    if (mine < at) return 'done';
    if (mine === at) return job.status === 'failed' || job.status === 'cancelled' ? 'failed' : 'current';
    return 'waiting';
  };

  const hasKey = () => settings().claude_api_key !== '';
  const showSetup = () => state.models !== null && !state.models.ready;

  return (
    <div class="rip">
      <Show when={state.service?.state === 'stopped'}>
        <div class="app-banner rip-banner" role="alert">
          <span>Analysis service stopped, restarting…</span>
        </div>
      </Show>
      <Show when={state.service?.state === 'failed'}>
        <div class="app-banner rip-banner" role="alert">
          <span>Analysis service failed: {state.service?.error ?? 'unknown error'}</span>
          <button class="deck-btn ghost" disabled={!hasTauriRuntime()} onClick={() => void retry()}>Retry</button>
        </div>
      </Show>

      <form
        class="rip-form"
        onSubmit={(e) => {
          e.preventDefault();
          void store.start();
        }}
      >
        <input
          class="rip-input rip-url"
          placeholder="https://www.youtube.com/watch?v=…"
          aria-label="YouTube link"
          value={state.url}
          onInput={(e) => store.setField('url', e.currentTarget.value)}
        />
        <input
          class="rip-input rip-time"
          placeholder="start 1:12"
          aria-label="start"
          value={state.startText}
          onInput={(e) => store.setField('startText', e.currentTarget.value)}
        />
        <input
          class="rip-input rip-time"
          placeholder="end 1:28"
          aria-label="end"
          value={state.endText}
          onInput={(e) => store.setField('endText', e.currentTarget.value)}
        />
        <label
          class="rip-tidy"
          classList={{ disabled: !hasKey() }}
          title={hasKey() ? 'Ask Claude to tidy the generated code' : 'Set a Claude API key in Settings to tidy with Claude'}
        >
          <input
            type="checkbox"
            disabled={!hasKey()}
            checked={state.tidy && hasKey()}
            onChange={(e) => store.setField('tidy', e.currentTarget.checked)}
          />
          Tidy with Claude
        </label>
        <Show
          when={state.busy || state.pendingStart}
          fallback={<button type="submit" class="deck-btn">Analyse</button>}
        >
          <button
            type="button"
            class="deck-btn ghost"
            disabled={state.busy && !state.job}
            onClick={() => void store.cancel()}
          >
            Cancel
          </button>
        </Show>
      </form>
      <div class="rip-error" role="alert">{state.error}</div>

      <Show when={state.job}>
        <ol class="rip-stages">
          <For each={store.stageRows()}>
            {(stage) => (
              <li class="rip-stage" data-state={rowState(stage)}>
                <span class="rip-stage-mark">
                  {{ done: '✓', current: '•', failed: '✕', waiting: '' }[rowState(stage)]}
                </span>
                <span class="rip-stage-name">{STAGE_LABEL[stage]}</span>
                <div class="rip-bar">
                  <div
                    class="rip-bar-fill"
                    style={{
                      width: `${rowState(stage) === 'done' ? 100 : rowState(stage) === 'current' ? Math.round((state.job?.progress ?? 0) * 100) : 0}%`,
                    }}
                  />
                </div>
              </li>
            )}
          </For>
        </ol>
      </Show>

      <Show
        when={!showSetup()}
        fallback={
          <ModelSetup status={state.models!} pending={state.pendingStart} onInstall={() => void store.installModels()} />
        }
      >
        <div class="rip-columns">
          <section class="rip-col">
            <h2 class="rip-col-title">Stems &amp; analysis</h2>
            <Show when={state.result} fallback={<p class="rip-hint">Paste a link, pick up to 60 seconds, Analyse.</p>}>
              {(res) => (
                <p class="rip-analysis">
                  tempo {Math.round(res().analysis.bpm)} · key {res().analysis.key} · {res().analysis.meter} ·{' '}
                  {res().analysis.bars} bars
                </p>
              )}
            </Show>
            <div class="rip-stems">
              <For each={STEM_NAMES}>
                {(name) => (
                  <button
                    class="deck-btn ghost"
                    classList={{ on: audition.playing() === name }}
                    disabled={!loaded().has(name)}
                    onClick={() => toggleStem(name)}
                  >
                    {name}
                  </button>
                )}
              </For>
            </div>
            <div class="rip-ab">
              <button
                class="deck-btn ghost"
                classList={{ on: abActive() }}
                disabled={!loaded().has('mix') || !state.code}
                onClick={() => void playAb()}
              >
                Play A/B
              </button>
              <div class="rip-switch" role="group" aria-label="A/B">
                <button classList={{ on: side() === 'original' }} onClick={() => pickSide('original')}>Original</button>
                <button classList={{ on: side() === 'result' }} onClick={() => pickSide('result')}>Result</button>
              </div>
            </div>
          </section>

          <section class="rip-col">
            <h2 class="rip-col-title">Strudel result</h2>
            <div class="rip-switch" role="group" aria-label="version">
              <button classList={{ on: state.version === 'generated' }} onClick={() => store.pickVersion('generated')}>
                Generated
              </button>
              <button
                classList={{ on: state.version === 'tidied' }}
                disabled={!state.result?.tidied_code}
                title={state.result?.tidy_error ?? (state.result?.tidied_code ? '' : 'Not tidied')}
                onClick={() => store.pickVersion('tidied')}
              >
                Tidied
              </button>
            </div>
            <ResultEditor code={state.code} onChange={store.setCode} onReady={onResultReady} />
            <div class="deck-transport">
              <button class="deck-btn" classList={{ on: resultPlaying() && !abActive() }} disabled={!state.code} onClick={playResult}>
                Play
              </button>
              <button class="deck-btn ghost" onClick={stopAll}>Stop</button>
              <span class="deck-transport-gap" />
              <button class="deck-btn ghost" disabled={!state.result} onClick={() => setSaving(true)}>
                Save to library
              </button>
              <For each={DECK_IDS}>
                {(id) => (
                  <button class="deck-btn ghost" disabled={!state.result} onClick={() => void loadTo(id)}>
                    Load to {id}
                  </button>
                )}
              </For>
            </div>
            <div class="rip-notice">{notice()}</div>
          </section>
        </div>
      </Show>

      <Show when={saving()}>
        <SaveDialog
          deckId="rip"
          tree={props.library.state.root}
          name={suggestedName()}
          heading="ripped"
          onSave={(t) => void save(t)}
          onCancel={() => void save(null)}
        />
      </Show>
    </div>
  );
}
