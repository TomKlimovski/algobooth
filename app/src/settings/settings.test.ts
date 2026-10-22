import { defaultSettings } from './settings';
test('defaults', () => {
  expect(defaultSettings('/Users/x')).toEqual({ library_dir: '/Users/x/Algobooth/library', visualiser: 'pianoroll', engine: 'webaudio', rip_cache_dir: '/Users/x/Algobooth/cache', keep_downloads: false, claude_api_key: '', keys: { bindings: {} }, key_quantise: 'bar' });
});
