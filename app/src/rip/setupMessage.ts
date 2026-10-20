import type { ModelStatus } from './ripApi';

export interface SetupMessage {
  title: string;
  body: string;
  /** The button to show: start the download, retry it, or none while it runs (or once ready). */
  action: 'download' | 'retry' | 'wait' | null;
}

/** The service's install stages (`ModelStore._install` in service/algorip/models.py). */
const STAGE_TITLE: Record<string, string> = {
  packages: 'Installing PyTorch and Demucs',
  weights: 'Downloading the separation model',
};

/** What the first-run screen says for a model status; a running install wins over a stale error. */
export function setupMessage(m: ModelStatus): SetupMessage {
  if (m.ready) return { title: 'Ready', body: '', action: null };
  if (m.installing) {
    return {
      title: STAGE_TITLE[m.stage ?? 'packages'] ?? STAGE_TITLE.packages,
      body: 'You can keep using the booth meanwhile.',
      action: 'wait',
    };
  }
  if (m.error) return { title: 'Download failed', body: m.error, action: 'retry' };
  return {
    title: 'One-time download',
    body: 'Algobooth needs PyTorch and the Demucs separation model, about 600 MB. This happens once; after that ripping works offline.',
    action: 'download',
  };
}
