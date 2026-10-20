import { defaultSettings, type Settings } from '../settings/settings';
import type { JobStatus, ModelStatus, RipClient, RipRequest, RipResult } from './ripApi';
import { createRipStore, STAGES } from './ripStore';

function result(over: Partial<RipResult> = {}): RipResult {
  return {
    title: 'Song',
    analysis: {
      bpm: 120, key: 'A minor', meter: '4/4', bars: 8, steps_per_bar: 16, first_downbeat: 0,
      drums: {}, four_on_the_floor: true, bass: [], bass_harmonics: 0, chords: [], melody: null,
    },
    sounds: { drum_bank: 'RolandTR909', snare_name: 'sd', bass_sound: 'sine', bass_lpf: null, chord_sound: 'sawtooth', chord_lpf: 1200, room: 0.4 },
    code: 'generated code', tidied_code: null, tidy_error: null, stems: [],
    ...over,
  };
}

const models = (over: Partial<ModelStatus> = {}): ModelStatus => ({
  ready: true, torch_installed: true, weights_present: true, installing: false, stage: null, progress: 1, error: null, ...over,
});

const job = (over: Partial<JobStatus>): JobStatus =>
  ({ id: 'j1', status: 'running', stage: null, progress: 0, result: null, error: null, ...over });

/** A RipClient stand-in: start resolves to 'j1', status pops the scripted statuses in order. */
function fakeClient(statuses: JobStatus[] = []) {
  const queue = [...statuses];
  const fake = {
    start: vi.fn(async (_req: RipRequest) => 'j1'),
    status: vi.fn(async (_id: string) => {
      const next = queue.shift();
      if (!next) throw new Error('no more statuses');
      return next;
    }),
    cancel: vi.fn(async (_id: string) => {}),
    models: vi.fn(async (): Promise<ModelStatus> => models()),
    installModels: vi.fn(async () => {}),
  };
  return { fake, client: fake as unknown as RipClient };
}

/** Collects the store's poll callbacks so the test runs them one at a time. */
function pollQueue() {
  const pending: { f: () => void; ms: number }[] = [];
  const delays: number[] = [];
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    poll: (f: () => void, ms: number) => { pending.push({ f, ms }); delays.push(ms); },
    pending,
    delays,
    async drain() {
      await flush();
      while (pending.length) {
        pending.shift()!.f();
        await flush();
      }
    },
  };
}

function setup(statuses: JobStatus[] = [], settings: Partial<Settings> = {}) {
  const { fake, client } = fakeClient(statuses);
  const q = pollQueue();
  let current: RipClient | null = client;
  const s = { ...defaultSettings('/h'), ...settings };
  const store = createRipStore({ client: () => current, settings: () => s, poll: q.poll });
  store.setField('url', 'https://www.youtube.com/watch?v=x');
  store.setField('startText', '1:12');
  store.setField('endText', '1:28');
  return { store, fake, q, dropClient: () => { current = null; } };
}

test('start refuses a bad window without calling the service', async () => {
  const { store, fake } = setup();
  store.setField('startText', '2:00');
  store.setField('endText', '1:00');
  await store.start();
  expect(store.state.error).toBe('End must be after start');
  expect(fake.start).not.toHaveBeenCalled();
  expect(store.state.busy).toBe(false);
});

test('start refuses a long clip, a missing start and a non-http link (review focus 2)', async () => {
  const { store, fake } = setup();
  store.setField('startText', '0');
  store.setField('endText', '1:01');
  await store.start();
  expect(store.state.error).toBe('Clip must be 60 seconds or less');
  store.setField('startText', 'soon');
  await store.start();
  expect(store.state.error).toBe('Enter a start time like 1:12 or 72');
  store.setField('startText', '0');
  store.setField('endText', '30');
  store.setField('url', 'www.youtube.com/watch?v=x');
  await store.start();
  expect(store.state.error).toBe('The link must start with http:// or https://');
  expect(fake.start).not.toHaveBeenCalled();
});

test('request builds the wire request from the fields', () => {
  const { store } = setup();
  expect(store.request()).toEqual({ url: 'https://www.youtube.com/watch?v=x', start: 72, end: 88, tidy: false });
  expect(store.state.error).toBeNull();
});

test('start polls to done and loads the generated code', async () => {
  const done = result();
  const { store, fake, q } = setup([
    job({ stage: 'download', progress: 0.3 }),
    job({ stage: 'separate', progress: 1 }),
    job({ status: 'done', stage: 'generate', progress: 1, result: done }),
  ]);
  await store.start();
  expect(fake.start).toHaveBeenCalledWith({ url: 'https://www.youtube.com/watch?v=x', start: 72, end: 88, tidy: false });
  expect(store.state.busy).toBe(true);
  await q.drain();
  expect(fake.status).toHaveBeenCalledTimes(3);
  expect(fake.status).toHaveBeenCalledWith('j1');
  expect(q.delays.every((ms) => ms === 500)).toBe(true);
  expect(store.state.job?.status).toBe('done');
  expect(store.state.result).toEqual(done);
  expect(store.state.code).toBe(done.code);
  expect(store.state.version).toBe('generated');
  expect(store.state.busy).toBe(false);
  expect(store.state.error).toBeNull();
});

test('a failed job shows the server error', async () => {
  const { store, q } = setup([job({ stage: 'download' }), job({ status: 'failed', stage: 'download', error: 'boom' })]);
  await store.start();
  await q.drain();
  expect(store.state.error).toBe('boom');
  expect(store.state.busy).toBe(false);
  expect(q.pending).toHaveLength(0);
});

test('a cancelled job says so', async () => {
  const { store, fake, q } = setup([job({ stage: 'download' }), job({ status: 'cancelled', stage: 'download' })]);
  await store.start();
  await store.cancel();
  expect(fake.cancel).toHaveBeenCalledWith('j1');
  await q.drain();
  expect(store.state.error).toBe('Rip cancelled');
  expect(store.state.busy).toBe(false);
});

test('a missing client or a refused POST is an error', async () => {
  const a = setup();
  a.dropClient();
  await a.store.start();
  expect(a.store.state.error).toBe('Analysis service is not running');
  expect(a.store.state.busy).toBe(false);

  const b = setup();
  b.fake.start.mockRejectedValueOnce(new Error('a rip is already running'));
  await b.store.start();
  expect(b.store.state.error).toBe('a rip is already running');
  expect(b.store.state.busy).toBe(false);
  expect(b.q.pending).toHaveLength(0);
});

test('service stopping mid-job fails the job (review focus 3)', async () => {
  const { store, fake, q } = setup([job({ stage: 'separate' }), job({ stage: 'separate' })]);
  await store.start();
  q.pending.shift()!.f(); // first poll: still separating
  await new Promise((r) => setTimeout(r, 0));
  expect(fake.status).toHaveBeenCalledTimes(1);
  expect(store.state.busy).toBe(true);
  store.onServiceStatus({ state: 'running', port: 5000 });
  expect(store.state.busy).toBe(true);
  store.onServiceStatus({ state: 'stopped' });
  expect(store.state.error).toBe('Analysis service stopped');
  expect(store.state.job?.status).toBe('failed');
  expect(store.state.job?.error).toBe('Analysis service stopped');
  expect(store.state.busy).toBe(false);
  expect(store.state.service).toEqual({ state: 'stopped' });
  await q.drain(); // the poll scheduled before the stop must not ask again or resume the job
  expect(fake.status).toHaveBeenCalledTimes(1);
  expect(q.pending).toHaveLength(0);
  expect(store.state.job?.status).toBe('failed');
  expect(store.state.error).toBe('Analysis service stopped');
});

test('a failed service while the POST is in flight fails the rip too', async () => {
  const { store, fake, q } = setup([job({ stage: 'download' })]);
  let release: (id: string) => void = () => {};
  fake.start.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
  await store.refreshModels(); // models known ready, so start goes straight to the POST
  const started = store.start();
  store.onServiceStatus({ state: 'failed', error: 'exited' });
  release('j1');
  await started;
  await q.drain();
  expect(store.state.error).toBe('Analysis service stopped');
  expect(store.state.busy).toBe(false);
  expect(fake.status).not.toHaveBeenCalled();
});

test('a stop with no job running only records the status', () => {
  const { store } = setup();
  store.onServiceStatus({ state: 'stopped' });
  expect(store.state.error).toBeNull();
  expect(store.state.service?.state).toBe('stopped');
});

test('pickVersion swaps code and keeps edits per version', async () => {
  const { store, q } = setup([job({ status: 'done', stage: 'tidy', progress: 1, result: result({ tidied_code: 'tidied code' }) })]);
  await store.start();
  await q.drain();
  expect(store.state.code).toBe('generated code');
  store.setCode('edited');
  store.pickVersion('tidied');
  expect(store.state.version).toBe('tidied');
  expect(store.state.code).toBe('tidied code');
  store.pickVersion('generated');
  expect(store.state.code).toBe('edited');
});

test('pickVersion ignores tidied when there is no tidied code', async () => {
  const { store, q } = setup([job({ status: 'done', stage: 'generate', progress: 1, result: result() })]);
  await store.start();
  await q.drain();
  store.pickVersion('tidied');
  expect(store.state.version).toBe('generated');
  expect(store.state.code).toBe('generated code');
});

test('tidy is sent only when ticked and a key is set', () => {
  const none = setup([], { claude_api_key: '' });
  none.store.setField('tidy', true);
  const r1 = none.store.request();
  expect(r1?.tidy).toBe(false);
  expect(r1).not.toHaveProperty('claude_api_key');

  const keyed = setup([], { claude_api_key: 'sk-test' });
  expect(keyed.store.request()).not.toHaveProperty('claude_api_key');
  keyed.store.setField('tidy', true);
  expect(keyed.store.request()).toMatchObject({ tidy: true, claude_api_key: 'sk-test' });
});

test('stages and the next stage', async () => {
  expect(STAGES).toEqual(['download', 'separate', 'analyse', 'generate', 'tidy']);
  const { store, q } = setup([job({ stage: 'download' }), job({ stage: 'generate' })]);
  expect(store.nextStage()).toBeNull();
  await store.start();
  expect(store.nextStage()).toBe('download'); // queued: nothing begun yet
  q.pending.shift()!.f();
  await new Promise((r) => setTimeout(r, 0));
  expect(store.nextStage()).toBe('separate');
  q.pending.shift()!.f();
  await new Promise((r) => setTimeout(r, 0));
  expect(store.nextStage()).toBeNull(); // generate is the last row without tidy
});

test('the default poll waits 500 ms between status calls', async () => {
  vi.useFakeTimers();
  try {
    const { fake, client } = fakeClient([job({ stage: 'download' }), job({ status: 'done', stage: 'generate', progress: 1, result: result() })]);
    const store = createRipStore({ client: () => client, settings: () => defaultSettings('/h') });
    store.setField('url', 'https://x.y/z');
    store.setField('startText', '0');
    store.setField('endText', '10');
    await store.start();
    expect(fake.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(fake.status).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.status).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fake.status).toHaveBeenCalledTimes(2);
    expect(store.state.job?.status).toBe('done');
  } finally {
    vi.useRealTimers();
  }
});

test('a rip started before models are ready waits and then runs', async () => {
  const { store, fake, q } = setup([job({ stage: 'download' })]);
  fake.models.mockResolvedValueOnce(models({ ready: false, torch_installed: false, weights_present: false, progress: 0 }));
  await store.start();
  expect(fake.start).not.toHaveBeenCalled();
  expect(fake.installModels).not.toHaveBeenCalled();
  expect(store.state.pendingStart).toBe(true);
  expect(store.state.busy).toBe(false);
  expect(store.state.models?.ready).toBe(false);

  fake.models
    .mockResolvedValueOnce(models({ ready: false, installing: true, stage: 'packages', progress: 0.1 }))
    .mockResolvedValueOnce(models({ ready: false, installing: true, stage: 'weights', progress: 0.8 }));
  await store.installModels();
  expect(fake.installModels).toHaveBeenCalledTimes(1);
  expect(store.state.models?.stage).toBe('packages');
  expect(fake.start).not.toHaveBeenCalled();
  expect(q.delays.at(-1)).toBe(1000);
  q.pending.shift()!.f(); // models poll: still installing
  await new Promise((r) => setTimeout(r, 0));
  expect(store.state.models?.progress).toBe(0.8);
  expect(fake.start).not.toHaveBeenCalled();
  q.pending.shift()!.f(); // models poll: ready (the default)
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  expect(store.state.models?.ready).toBe(true);
  expect(fake.start).toHaveBeenCalledTimes(1);
  expect(store.state.pendingStart).toBe(false);
  expect(store.state.busy).toBe(true);
  expect(q.pending.every((p) => p.ms === 500)).toBe(true); // only the job poll is left; model polling stopped
});

test('a known-ready model status skips the models call', async () => {
  const { store, fake } = setup();
  await store.refreshModels();
  expect(fake.models).toHaveBeenCalledTimes(1);
  await store.start();
  expect(fake.models).toHaveBeenCalledTimes(1);
  expect(fake.start).toHaveBeenCalledTimes(1);
});

test('a failed install shows its error and stops polling; cancel drops a pending start', async () => {
  const { store, fake, q } = setup();
  fake.models.mockResolvedValue(models({ ready: false, torch_installed: false, weights_present: false }));
  await store.start();
  expect(store.state.pendingStart).toBe(true);
  fake.models.mockResolvedValueOnce(models({ ready: false, installing: true, stage: 'weights' }));
  fake.models.mockResolvedValueOnce(models({ ready: false, installing: false, stage: 'weights', error: 'no wheel' }));
  await store.installModels();
  q.pending.shift()!.f();
  await new Promise((r) => setTimeout(r, 0));
  expect(store.state.models?.error).toBe('no wheel');
  expect(q.pending).toHaveLength(0);
  await store.cancel();
  expect(store.state.pendingStart).toBe(false);
  fake.models.mockResolvedValue(models());
  await store.refreshModels();
  expect(fake.start).not.toHaveBeenCalled();
});

test('a new rip clears the previous rip\'s code and version', async () => {
  const { store, fake, q } = setup([
    job({ status: 'done', stage: 'tidy', progress: 1, result: result({ tidied_code: 'tidied code' }) }),
    job({ stage: 'download' }),
  ]);
  await store.start();
  await q.drain();
  store.pickVersion('tidied');
  expect(store.state.code).toBe('tidied code');
  let release: (id: string) => void = () => {};
  fake.start.mockImplementationOnce(() => new Promise<string>((r) => { release = r; }));
  const started = store.start();
  expect(store.state.code).toBe('');
  expect(store.state.version).toBe('generated');
  expect(store.state.result).toBeNull();
  release('j2');
  await started;
});

test('the sent request is kept for saving, and the stage rows follow tidy', async () => {
  const { store, q } = setup([job({ status: 'done', stage: 'generate', progress: 1, result: result() })], { claude_api_key: 'k' });
  expect(store.sent()).toBeNull();
  expect(store.stageRows()).toEqual(['download', 'separate', 'analyse', 'generate']);
  store.setField('tidy', true);
  await store.start();
  store.setField('url', 'https://other.example/'); // editing the form afterwards does not change the source
  await q.drain();
  expect(store.sent()).toEqual({ url: 'https://www.youtube.com/watch?v=x', start: 72, end: 88 });
  expect(store.stageRows()).toEqual(STAGES);
});

test('dispose stops the job and model polls', async () => {
  const { store, fake, q } = setup([job({ stage: 'download' })]);
  await store.start();
  fake.models.mockResolvedValueOnce(models({ ready: false, installing: true, stage: 'packages' }));
  await store.refreshModels();
  expect(q.pending).toHaveLength(2);
  store.dispose();
  await q.drain();
  expect(fake.status).not.toHaveBeenCalled();
  expect(fake.models).toHaveBeenCalledTimes(2); // start's check and the refresh, nothing after dispose
});

test('a second Analyse while the first is still checking models or posting sends nothing', async () => {
  const { store, fake, q } = setup([job({ stage: 'download' })]);
  const first = store.start(); // still awaiting the models check
  const second = store.start();
  await Promise.all([first, second]);
  await store.start(); // busy now
  expect(fake.start).toHaveBeenCalledTimes(1);
  expect(fake.models).toHaveBeenCalledTimes(1);
  q.pending.length = 0;
});
