import { render } from 'solid-js/web';
import type { DeckApi } from '../booth/Deck';
import type { LibraryStore } from '../library/store';
import type { JobStatus, ModelStatus, RipResult } from './ripApi';

// --- fakes for the service, the audio context, the mixer and the result editor ------------------

const h = vi.hoisted(() => {
  const ready = { ready: true, torch_installed: true, weights_present: true, installing: false, stage: null, progress: 1, error: null };
  const state = {
    models: { ...ready } as Record<string, unknown>,
    statuses: [] as unknown[],
    statusHandler: null as null | ((s: unknown) => void),
  };
  const client = {
    start: vi.fn(async () => 'j1'),
    status: vi.fn(async () => state.statuses.shift() ?? { id: 'j1', status: 'running', stage: 'download', progress: 0.5, result: null, error: null }),
    cancel: vi.fn(async () => {}),
    stem: vi.fn(async () => new ArrayBuffer(8)),
    models: vi.fn(async () => state.models),
    installModels: vi.fn(async () => {}),
  };
  const service = {
    info: vi.fn(async () => ({ port: 5000, token: 't' })),
    restart: vi.fn(async () => {}),
    onStatus: vi.fn(async (f: (s: unknown) => void) => {
      state.statusHandler = f;
      return () => {};
    }),
  };
  const sources: any[] = [];
  const ctx = {
    currentTime: 0,
    destination: {},
    resume: vi.fn(async () => {}),
    decodeAudioData: vi.fn(async () => ({ duration: 16 })),
    createBufferSource: vi.fn(() => {
      const s: any = { connect: vi.fn(), start: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), loop: false, loopStart: 0, loopEnd: 0 };
      sources.push(s);
      return s;
    }),
    createGain: vi.fn(() => ({ gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn() })),
  };
  const mixer = { setRipGain: vi.fn() };
  const onToggle = new Set<(started: boolean) => void>();
  const scheduler = { started: false, cps: 0.5, now: () => 0, start: async () => {}, stop: () => {} };
  const result = {
    play: vi.fn(async () => {
      scheduler.started = true;
      onToggle.forEach((f) => f(true));
    }),
    stop: vi.fn(() => {
      if (!scheduler.started) return;
      scheduler.started = false;
      onToggle.forEach((f) => f(false));
    }),
    scheduler,
    onToggle,
  };
  return { ready, state, client, service, ctx, sources, mixer, result };
});

vi.mock('./ripApi', async (orig) => ({
  ...(await orig<typeof import('./ripApi')>()),
  RipClient: vi.fn(function () { return h.client; }),
  serviceApi: h.service,
}));
vi.mock('../library/api', async (orig) => ({ ...(await orig<typeof import('../library/api')>()), hasTauriRuntime: () => true }));
vi.mock('@strudel/webaudio', () => ({ getAudioContext: () => h.ctx }));
vi.mock('../engine/mixer', () => ({ getMixer: () => h.mixer, RIP_ORBIT: 3 }));
vi.mock('./ResultEditor', () => ({
  ResultEditor: (props: { code: string; onReady?: (api: unknown) => void }) => {
    props.onReady?.(h.result);
    return <pre class="fake-editor">{props.code}</pre>;
  },
}));

const { RipTab } = await import('./RipTab');

function result(): RipResult {
  return {
    title: 'Song',
    analysis: {
      bpm: 124, key: 'A minor', meter: '4/4', bars: 8, steps_per_bar: 16, first_downbeat: 0.25,
      drums: {}, four_on_the_floor: true, bass: [], bass_harmonics: 0, chords: [], melody: null,
    },
    sounds: { drum_bank: 'RolandTR909', snare_name: 'sd', bass_sound: 'sine', bass_lpf: null, chord_sound: 'sawtooth', chord_lpf: 1200, room: 0.4 },
    code: 'setcpm(124/4)\n$: s("bd*4")', tidied_code: null, tidy_error: 'no key', stems: ['drums', 'bass', 'other', 'vocals', 'mix'],
  };
}
const done = (): JobStatus => ({ id: 'j1', status: 'done', stage: 'generate', progress: 1, result: result(), error: null });

function fakeDeck(dirty: boolean) {
  return {
    isDirty: vi.fn(() => dirty),
    save: vi.fn(async () => true),
    setCode: vi.fn(),
    setName: vi.fn(),
    setFile: vi.fn(),
  };
}

let dispose: () => void = () => {};
let root: HTMLDivElement;
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const button = (label: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
const type = (name: string, value: string) => {
  const el = root.querySelector(`input[aria-label="${name}"]`) as HTMLInputElement;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

function mount(decks: Record<'A' | 'B', unknown> = { A: null, B: null }) {
  const onLoadedToDeck = vi.fn();
  const library = { state: { root: null }, writePattern: vi.fn(async () => 'ripped/song-1-12.json') } as unknown as LibraryStore;
  root = document.createElement('div');
  document.body.append(root);
  dispose = render(
    () => (
      <RipTab
        library={library}
        decks={() => decks as Record<'A' | 'B', DeckApi | null>}
        active={() => true}
        onLoadedToDeck={onLoadedToDeck}
      />
    ),
    root,
  );
  return { onLoadedToDeck, library };
}

async function ripToDone() {
  type('YouTube link', 'https://www.youtube.com/watch?v=x');
  type('start', '1:12');
  type('end', '1:28');
  h.state.statuses = [done()];
  button('Analyse')!.click();
  await flush();
  await new Promise((r) => setTimeout(r, 550)); // one status poll
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.models = { ...h.ready };
  h.state.statuses = [];
  h.sources.length = 0;
  h.result.scheduler.started = false;
});
afterEach(() => {
  dispose();
  root.remove();
});

test('a failed service shows the banner, and Retry restarts it (review focus 3)', async () => {
  h.service.info.mockRejectedValueOnce(new Error('service not running: keeps crashing'));
  mount();
  await flush();
  expect(root.textContent).toContain('Analysis service failed: service not running: keeps crashing');
  button('Retry')!.click();
  await flush();
  expect(h.service.restart).toHaveBeenCalledTimes(1);
  expect(root.textContent).not.toContain('Analysis service failed');
  h.state.statusHandler!({ state: 'stopped', error: 'exit 1' });
  await flush();
  expect(root.textContent).toContain('Analysis service stopped, restarting…');
  h.state.statusHandler!({ state: 'running', port: 5001 });
  await flush();
  expect(root.textContent).not.toContain('Analysis service stopped');
  expect(h.service.info).toHaveBeenCalledTimes(3); // mount, Retry, and the running event rebuild the client
});

test('missing models show the one-time download in place of the columns', async () => {
  h.state.models = { ...h.ready, ready: false, torch_installed: false, weights_present: false, progress: 0 } satisfies ModelStatus;
  mount();
  await flush();
  expect(root.textContent).toContain('One-time download');
  expect(root.textContent).toContain('about 2 GB');
  expect(root.querySelector('.rip-columns')).toBeNull();
  h.state.models = { ...h.ready, ready: false, installing: true, stage: 'weights', progress: 0.6 };
  button('Download now')!.click();
  await flush();
  expect(h.client.installModels).toHaveBeenCalledTimes(1);
  expect(root.textContent).toContain('Downloading the separation model');
  expect(root.querySelector('.rip-setup [role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
});

test('Cancel is disabled until the job exists, then cancels it', async () => {
  mount();
  await flush();
  type('YouTube link', 'https://www.youtube.com/watch?v=x');
  type('start', '1:12');
  type('end', '1:28');
  let release: (id: string) => void = () => {};
  h.client.start.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
  button('Analyse')!.click();
  await flush();
  expect(button('Analyse')).toBeUndefined();
  expect(button('Cancel')!.disabled).toBe(true);
  release('j1');
  await flush();
  expect(button('Cancel')!.disabled).toBe(false);
  expect(root.querySelectorAll('.rip-stage')).toHaveLength(4);
  button('Cancel')!.click();
  await flush();
  expect(h.client.cancel).toHaveBeenCalledWith('j1');
});

test('a bad window shows the error and sends nothing', async () => {
  mount();
  await flush();
  type('YouTube link', 'https://www.youtube.com/watch?v=x');
  type('start', '1:28');
  type('end', '1:12');
  button('Analyse')!.click();
  await flush();
  expect(root.textContent).toContain('End must be after start');
  expect(h.client.start).not.toHaveBeenCalled();
});

test('a done rip shows the analysis, loads the stems, and Load to A asks over edits (review focus 5)', async () => {
  const A = fakeDeck(true);
  const B = fakeDeck(false);
  const { onLoadedToDeck } = mount({ A, B });
  await flush();
  await ripToDone();
  expect(root.textContent).toContain('tempo 124 · key A minor · 4/4 · 8 bars');
  expect(root.querySelector('.fake-editor')?.textContent).toBe(result().code);
  expect(h.client.stem).toHaveBeenCalledTimes(5);
  expect(button('drums')!.disabled).toBe(false);
  const tidied = button('Tidied')!;
  expect(tidied.disabled).toBe(true);
  expect(tidied.title).toBe('no key');

  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  button('Load to A')!.click();
  await flush();
  expect(confirm).toHaveBeenCalledWith('Save changes before loading another pattern? OK saves first, Cancel keeps editing.');
  expect(A.setCode).not.toHaveBeenCalled();
  expect(onLoadedToDeck).not.toHaveBeenCalled();

  button('Load to B')!.click();
  await flush();
  expect(B.setCode).toHaveBeenCalledWith(result().code);
  expect(B.setFile).toHaveBeenCalledWith(null, null, expect.objectContaining({
    name: 'Song 1:12',
    source: expect.objectContaining({ kind: 'rip', url: 'https://www.youtube.com/watch?v=x', start: 72, end: 88 }),
  }));
  expect(onLoadedToDeck).toHaveBeenCalledWith('B');
  confirm.mockRestore();
});

test('stems audition over the bars, and A/B plays both with the toggle picking one', async () => {
  mount();
  await flush();
  await ripToDone();
  button('drums')!.click();
  expect(h.sources).toHaveLength(1);
  expect(h.sources[0]).toMatchObject({ loop: true, loopStart: 0.25 });
  expect(h.sources[0].loopEnd).toBeCloseTo(0.25 + (8 * 240) / 124);
  expect(button('drums')!.classList.contains('on')).toBe(true);
  button('drums')!.click();
  expect(h.sources[0].stop).toHaveBeenCalled();
  expect(button('drums')!.classList.contains('on')).toBe(false);

  button('Play A/B')!.click();
  await flush();
  expect(h.result.play).toHaveBeenCalledTimes(1);
  expect(h.sources).toHaveLength(2); // the mix, started once the result started
  expect(button('mix')!.classList.contains('on')).toBe(true);
  expect(h.mixer.setRipGain).toHaveBeenLastCalledWith(1);
  button('Original')!.click();
  expect(h.mixer.setRipGain).toHaveBeenLastCalledWith(0);
  expect(h.sources[1].stop).not.toHaveBeenCalled(); // both keep running
  button('Stop')!.click();
  expect(h.result.stop).toHaveBeenCalled();
  expect(h.sources[1].stop).toHaveBeenCalled();
});

test('Save to library writes the rip pattern under the chosen heading', async () => {
  const { library } = mount();
  await flush();
  await ripToDone();
  button('Save to library')!.click();
  await flush();
  const form = root.querySelector('form.save-dialog') as HTMLFormElement;
  expect((form.querySelector('input') as HTMLInputElement).value).toBe('Song 1:12');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await flush();
  expect(library.writePattern).toHaveBeenCalledWith('ripped', expect.objectContaining({ name: 'Song 1:12', cpm: 124 }));
  expect(root.textContent).toContain('Saved to ripped/song-1-12.json');
});

test('a job that fails before any stage marks the first row failed', async () => {
  mount();
  await flush();
  type('YouTube link', 'https://www.youtube.com/watch?v=x');
  type('start', '1:12');
  type('end', '1:28');
  h.state.statuses = [{ id: 'j1', status: 'failed', stage: null, progress: 0, result: null, error: 'video unavailable' }];
  button('Analyse')!.click();
  await flush();
  await new Promise((r) => setTimeout(r, 550));
  await flush();
  const rows = [...root.querySelectorAll('.rip-stage')].map((r) => r.getAttribute('data-state'));
  expect(rows).toEqual(['failed', 'waiting', 'waiting', 'waiting']);
  expect(root.textContent).toContain('video unavailable');
});
