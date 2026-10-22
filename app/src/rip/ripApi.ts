import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/** Mirrors the wire types in service/algorip/schema.py and service/algorip/notes.py (same field names). */

export interface Note {
  bar: number;
  step: number;
  /** Steps, at least 1. */
  length: number;
  midi: number;
}

export interface BassLoop {
  period: number;
  templates: Note[][];
  layer: Note[][] | null;
  layer_bars: [number, number] | null;
  match: number;
  match_with_layer: number | null;
}

export interface DrumSummary {
  period: number;
  match: number;
  fill_bars: [number, number] | null;
}

export interface Analysis {
  bpm: number;
  key: string;
  meter: string;
  bars: number;
  steps_per_bar: number;
  first_downbeat: number;
  /** Voice to sorted `[bar, step]` hits. */
  drums: Record<string, [number, number][]>;
  four_on_the_floor: boolean;
  bass: Note[];
  bass_harmonics: number;
  chords: string[];
  melody: Note[] | null;
  bass_loop: BassLoop | null;
  /** How the stem's notes shape over time (medians): attack, hold, fall, level at the end, hold as a share of the note. */
  bass_envelope: { attack_ms: number; hold_ms: number; fall_ms: number; end_db: number; hold_share: number } | null;
  drum_summary: DrumSummary | null;
}

export interface SoundChoice {
  drum_bank: string;
  snare_name: 'sd' | 'cp';
  bass_sound: 'sawtooth' | 'triangle' | 'sine';
  bass_lpf: number | null;
  /** The gate written on the bass lines, in Strudel's units; null for a held bass. */
  bass_envelope: { attack: number; clip: number | null; release: number } | null;
  chord_sound: string;
  chord_lpf: number;
  room: number;
}

export interface RipRequest {
  url: string;
  start: number;
  end: number;
  tidy: boolean;
  claude_api_key?: string | null;
  /** Keep the downloaded source audio after trimming; from Settings, sent with every rip. */
  keep_downloads?: boolean;
  /** Return the result stored by this clip's last rip without running anything (the Recent menu). */
  replay?: boolean;
}

export interface RipResult {
  title: string;
  analysis: Analysis;
  sounds: SoundChoice;
  code: string;
  tidied_code: string | null;
  tidy_error: string | null;
  /** Stem names only; the audio comes from `RipClient.stem`. */
  stems: string[];
}

/** A clip in the service's cache: enough to rip it again without the download. */
export interface ClipInfo {
  url: string;
  start: number;
  end: number;
  title: string;
  /** Seconds since the epoch, from the service. */
  fetched_at: number;
}

export type Stage = 'download' | 'separate' | 'analyse' | 'generate' | 'tidy';

export interface JobStatus {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  stage: Stage | null;
  /** 0..1 within the stage. */
  progress: number;
  result: RipResult | null;
  error: string | null;
}

export interface ModelStatus {
  ready: boolean;
  torch_installed: boolean;
  weights_present: boolean;
  installing: boolean;
  stage: string | null;
  progress: number;
  error: string | null;
}

/** From the Rust `service_info` command. */
export interface ServiceInfo {
  port: number;
  token: string;
}

/** The Rust supervisor's `service-status` event. */
export interface ServiceStatus {
  state: 'starting' | 'running' | 'stopped' | 'failed';
  port?: number;
  error?: string;
}

export const STEM_NAMES = ['drums', 'bass', 'other', 'vocals', 'mix'] as const;

/** The analysis service's HTTP API on 127.0.0.1; every call carries the bearer token. */
export class RipClient {
  private readonly base: string;

  constructor(
    private readonly info: ServiceInfo,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = `http://127.0.0.1:${info.port}`;
  }

  /** Resolves to the new job's id. */
  async start(req: RipRequest): Promise<string> {
    const res = await this.call('POST', '/rip', req);
    return ((await res.json()) as { id: string }).id;
  }

  async status(id: string): Promise<JobStatus> {
    return (await this.call('GET', `/rip/${encodeURIComponent(id)}`)).json() as Promise<JobStatus>;
  }

  async cancel(id: string): Promise<void> {
    await this.call('DELETE', `/rip/${encodeURIComponent(id)}`);
  }

  /** The stem's wav bytes. */
  async stem(id: string, name: string): Promise<ArrayBuffer> {
    return (await this.call('GET', `/rip/${encodeURIComponent(id)}/stem/${encodeURIComponent(name)}`)).arrayBuffer();
  }

  /** The cached clips, newest first. */
  async clips(): Promise<ClipInfo[]> {
    return (await this.call('GET', '/clips')).json() as Promise<ClipInfo[]>;
  }

  async models(): Promise<ModelStatus> {
    return (await this.call('GET', '/models')).json() as Promise<ModelStatus>;
  }

  async installModels(): Promise<void> {
    await this.call('POST', '/models/install');
  }

  /** The response when it is 2xx; otherwise rejects with the JSON `detail` string, or `HTTP <status>`. */
  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.info.token}` };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    // Called with no `this`: WebKit's fetch refuses to run as a method of anything but the window.
    const doFetch = this.fetchImpl;
    const res = await doFetch(`${this.base}${path}`, init);
    if (!res.ok) throw new Error(await errorDetail(res));
    return res;
  }
}

async function errorDetail(res: Response): Promise<string> {
  try {
    const detail = ((await res.json()) as { detail?: unknown }).detail;
    if (typeof detail === 'string' && detail !== '') return detail;
  } catch {
    // not JSON: fall through to the status
  }
  return `HTTP ${res.status}`;
}

/** The Rust supervisor: where the service listens, a manual restart, and its status events. */
export const serviceApi = {
  info: () => invoke<ServiceInfo>('service_info'),
  restart: () => invoke<void>('restart_service'),
  onStatus: (h: (s: ServiceStatus) => void) => listen<ServiceStatus>('service-status', (e) => h(e.payload)),
};
