import { defaultSettings } from './settings';
test('defaults', () => {
  expect(defaultSettings('/Users/x')).toEqual({ library_dir: '/Users/x/Algobooth/library', visualiser: 'pianoroll', engine: 'webaudio' });
});
