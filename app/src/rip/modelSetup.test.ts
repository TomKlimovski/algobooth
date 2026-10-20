import type { ModelStatus } from './ripApi';
import { setupMessage } from './modelSetup';

const status = (over: Partial<ModelStatus> = {}): ModelStatus => ({
  ready: false,
  torch_installed: false,
  weights_present: false,
  installing: false,
  stage: null,
  progress: 0,
  error: null,
  ...over,
});

test('messages per state', () => {
  expect(setupMessage(status({ ready: false, installing: false })).action).toBe('download');
  expect(setupMessage(status({ installing: true, stage: 'weights', progress: 0.8 })).title).toBe('Downloading the separation model');
  expect(setupMessage(status({ installing: false, error: 'no wheel' }))).toMatchObject({ title: 'Download failed', body: 'no wheel', action: 'retry' });
  expect(setupMessage(status({ ready: true })).action).toBeNull();
});

test('the first-run wording and the install stages', () => {
  expect(setupMessage(status())).toEqual({
    title: 'One-time download',
    body: 'Algobooth needs PyTorch and the Demucs separation model, about 2 GB. This happens once; after that ripping works offline.',
    action: 'download',
  });
  for (const stage of [null, 'packages']) {
    expect(setupMessage(status({ installing: true, stage }))).toEqual({
      title: 'Installing PyTorch and Demucs',
      body: 'You can keep using the booth meanwhile.',
      action: 'wait',
    });
  }
  // An install that is running again clears the old error on the service, but the client may race it.
  expect(setupMessage(status({ installing: true, stage: 'weights', error: 'old' })).action).toBe('wait');
});
