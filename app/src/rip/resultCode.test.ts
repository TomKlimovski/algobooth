import { acceptReplCode, REPL_PLACEHOLDER } from './resultCode';

test('the placeholder never reaches the store, even when the editor still shows it', () => {
  expect(acceptReplCode(REPL_PLACEHOLDER, REPL_PLACEHOLDER, '')).toBe(false);
  expect(acceptReplCode(REPL_PLACEHOLDER, 'setcpm(120/4)', 'setcpm(120/4)')).toBe(false);
});

test('a report that matches the editor text and differs from the store is a user edit', () => {
  expect(acceptReplCode('s("bd")', 's("bd")', 'setcpm(120/4)')).toBe(true);
  expect(acceptReplCode('s("bd")', 's("bd")', 's("bd")')).toBe(false); // an echo of what the store set
});

test('a stale report from before setCode is ignored', () => {
  expect(acceptReplCode('', 'setcpm(120/4)\n$: s("bd*4")', 'setcpm(120/4)\n$: s("bd*4")')).toBe(false);
  expect(acceptReplCode(undefined, 'x', 'y')).toBe(false);
});
