import { createStore, reconcile } from 'solid-js/store';
import type { Settings } from '../settings/settings';
import type { JobStatus, ModelStatus, RipClient, RipRequest, RipResult, ServiceStatus, Stage } from './ripApi';
import { parseTime, validateUrl, validateWindow } from './timeParse';

/** The progress rows, in pipeline order; `tidy` is shown only for a rip sent with tidy on. */
export const STAGES: Stage[] = ['download', 'separate', 'analyse', 'generate', 'tidy'];

const POLL_MS = 500;
/** How often the model status is asked for while an install runs. */
const MODELS_POLL_MS = 1000;
const SERVICE_STOPPED = 'Analysis service stopped';

export interface RipFields {
  url: string;
  startText: string;
  endText: string;
  /** The "Tidy with Claude" box; only sent as true when a Claude key is set. */
  tidy: boolean;
  service: ServiceStatus | null;
  models: ModelStatus | null;
  job: JobStatus | null;
  result: RipResult | null;
  version: 'generated' | 'tidied';
  /** The editor's code for the shown version. */
  code: string;
  error: string | null;
  /** From Analyse until the job ends (done, failed, cancelled or the service stopping). */
  busy: boolean;
  /** Analyse was pressed while the models were missing: the rip starts by itself once they are ready. */
  pendingStart: boolean;
}

export interface RipDeps {
  /** The client for the running service, or null while it is not running. */
  client: () => RipClient | null;
  settings: () => Settings;
  /** Runs `f` once after `ms`; `setTimeout` by default. */
  poll?: (f: () => void, ms: number) => unknown;
  now?: () => Date;
}

export type RipStore = ReturnType<typeof createRipStore>;

const isTerminal = (s: JobStatus['status']) => s === 'done' || s === 'failed' || s === 'cancelled';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createRipStore(deps: RipDeps) {
  const poll = deps.poll ?? ((f: () => void, ms: number) => setTimeout(f, ms));
  const [state, setState] = createStore<RipFields>({
    url: '',
    startText: '',
    endText: '',
    tidy: false,
    service: null,
    models: null,
    job: null,
    result: null,
    version: 'generated',
    code: '',
    error: null,
    busy: false,
    pendingStart: false,
  });

  /** Bumped whenever a rip ends or a new one starts, so a stale POST or poll does nothing. */
  let run = 0;
  /** Whether the running rip was sent with tidy on (decides whether the tidy row exists). */
  let sentTidy = false;
  /** Where the running or last rip came from, for its library pattern's `source`. */
  let sentReq: { url: string; start: number; end: number } | null = null;
  /** The editor's code per version, so switching back keeps edits. */
  let edits: { generated: string; tidied: string | null } = { generated: '', tidied: null };

  function setField<K extends keyof RipFields>(k: K, v: RipFields[K]): void {
    setState(k, v as never);
  }

  /** The wire request for the form, or null (with `error` set) when the form is not valid. */
  function request(): RipRequest | null {
    const url = state.url.trim();
    const problem =
      validateUrl(url) ?? validateWindow(parseTime(state.startText), parseTime(state.endText));
    if (problem) {
      setState('error', problem);
      return null;
    }
    setState('error', null);
    const key = deps.settings().claude_api_key;
    const tidy = state.tidy && key !== '';
    const req: RipRequest = { url, start: parseTime(state.startText)!, end: parseTime(state.endText)!, tidy };
    if (tidy) req.claude_api_key = key;
    return req;
  }

  /** Ends the current rip with an error; later polls for it are ignored. */
  function fail(error: string, job?: JobStatus | null): void {
    run++;
    setState({ busy: false, error, ...(job !== undefined ? { job } : {}) });
  }

  function finish(job: JobStatus): void {
    run++;
    if (job.status === 'done' && job.result) {
      edits = { generated: job.result.code, tidied: job.result.tidied_code };
      setState({ job, result: job.result, version: 'generated', code: job.result.code, busy: false, error: null });
    } else if (job.status === 'cancelled') {
      setState({ job, busy: false, error: 'Rip cancelled' });
    } else {
      setState({ job, busy: false, error: job.error ?? 'Rip failed' });
    }
  }

  function schedule(mine: number, client: RipClient, id: string): void {
    poll(() => void tick(mine, client, id), POLL_MS);
  }

  async function tick(mine: number, client: RipClient, id: string): Promise<void> {
    if (mine !== run) return;
    let job: JobStatus;
    try {
      job = await client.status(id);
    } catch (e) {
      if (mine === run) fail(message(e));
      return;
    }
    if (mine !== run) return;
    if (isTerminal(job.status)) finish(job);
    else {
      setState('job', reconcile(job));
      schedule(mine, client, id);
    }
  }

  /** Whether a models poll is already scheduled, so a refresh during an install does not start a second loop. */
  let modelsPolling = false;
  /** Set by `dispose`: no poll runs again. */
  let disposed = false;

  function applyModels(m: ModelStatus): void {
    setState('models', reconcile(m));
    if (m.ready && state.pendingStart) {
      setState('pendingStart', false);
      void start();
    }
  }

  /** Asks the service for the model status; keeps asking every second while an install runs. */
  async function refreshModels(): Promise<ModelStatus | null> {
    const client = deps.client();
    if (!client || disposed) return null;
    let m: ModelStatus;
    try {
      m = await client.models();
    } catch (e) {
      setState('error', message(e));
      return null;
    }
    if (disposed) return null;
    applyModels(m);
    if (m.installing && !modelsPolling) {
      modelsPolling = true;
      poll(() => {
        modelsPolling = false;
        void refreshModels();
      }, MODELS_POLL_MS);
    }
    return m;
  }

  /** Starts (or retries) the one-time model download, then follows it until it ends. */
  async function installModels(): Promise<void> {
    const client = deps.client();
    if (!client) {
      setState('error', 'Analysis service is not running');
      return;
    }
    try {
      await client.installModels();
    } catch (e) {
      setState('error', message(e));
    }
    await refreshModels();
  }

  /**
   * Validates, POSTs the rip, then polls its status every 500 ms until it ends. Resolves once polling is
   * under way. While the models are missing it only records `pendingStart` (see `applyModels`).
   */
  async function start(): Promise<void> {
    if (state.busy) return;
    const req = request();
    if (!req) return;
    const client = deps.client();
    if (!client) {
      setState('error', 'Analysis service is not running');
      return;
    }
    // A new rip: the previous rip's code must not linger in the editor.
    edits = { generated: '', tidied: null };
    setState({ job: null, result: null, code: '', version: 'generated' });
    if (!state.models?.ready) {
      const m = await refreshModels();
      if (state.busy) return; // a pending start fired from inside the refresh
      if (!m?.ready) {
        if (m) setState('pendingStart', true);
        return;
      }
    }
    setState('pendingStart', false);
    const mine = ++run;
    sentTidy = req.tidy;
    sentReq = { url: req.url, start: req.start, end: req.end };
    setState({ busy: true, error: null, job: null, result: null });
    let id: string;
    try {
      id = await client.start(req);
    } catch (e) {
      if (mine === run) fail(message(e));
      return;
    }
    if (mine !== run) return; // the service stopped while the POST was in flight
    setState('job', { id, status: 'queued', stage: null, progress: 0, result: null, error: null });
    schedule(mine, client, id);
  }

  /** Asks the service to cancel; the poll then sees `cancelled` and ends the rip. */
  async function cancel(): Promise<void> {
    if (state.pendingStart) setState('pendingStart', false);
    const job = state.job;
    const client = deps.client();
    if (!state.busy || !job || !client) return;
    try {
      await client.cancel(job.id);
    } catch (e) {
      setState('error', message(e));
    }
  }

  function setCode(code: string): void {
    setState('code', code);
    edits[state.version] = code;
  }

  /** Shows the generated or tidied code, keeping each one's edits; tidied is ignored when there is none. */
  function pickVersion(v: 'generated' | 'tidied'): void {
    const next = edits[v];
    if (!state.result || next === null || v === state.version) return;
    setState({ version: v, code: next });
  }

  /** Records the supervisor's status; a stop or failure while a rip runs ends it (review focus 3). */
  function onServiceStatus(s: ServiceStatus): void {
    setState('service', reconcile(s)); // replace, not merge: a stale port or error must not linger
    if ((s.state === 'stopped' || s.state === 'failed') && state.busy) {
      const job = state.job ? { ...state.job, status: 'failed' as const, error: SERVICE_STOPPED } : null;
      fail(SERVICE_STOPPED, job);
    }
  }

  /** The progress rows for the running or last rip: `tidy` only when it was sent with tidy on. */
  function stageRows(): Stage[] {
    return sentTidy ? STAGES : STAGES.filter((st) => st !== 'tidy');
  }

  /** The progress row after the current one; the first row while queued; null when idle or on the last row. */
  function nextStage(): Stage | null {
    const job = state.job;
    if (!state.busy || !job) return null;
    const rows = stageRows();
    if (job.stage === null) return rows[0];
    return rows[rows.indexOf(job.stage) + 1] ?? null;
  }

  return {
    state,
    setField,
    request,
    start,
    cancel,
    pickVersion,
    setCode,
    onServiceStatus,
    nextStage,
    refreshModels,
    installModels,
    stageRows,
    /** The link and window of the running or last rip (not the form, which may have changed since). */
    sent: () => sentReq,
    /** Stops polling for good (the tab unmounted). */
    dispose: () => {
      disposed = true;
      run++;
    },
  };
}
