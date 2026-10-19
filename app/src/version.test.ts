import { APP_NAME } from './version';
test('app name never contains strudel', () => {
  expect(APP_NAME).toBe('Algobooth');
  expect(APP_NAME.toLowerCase()).not.toContain('strudel');
});
