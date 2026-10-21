import { insertAtLineEnd } from './methodDrop';

const drag = { name: 'lpf', snippet: '.lpf(800)', argRange: [5, 8] as [number, number] };
test('lands at the end of a plain line, selecting the argument', () => {
  expect(insertAtLineEnd('a: s("bd")\nb: s("hh")', 0, drag)).toEqual({ code: 'a: s("bd").lpf(800)\nb: s("hh")', selection: [15, 18] });
});
test('goes before a trailing comment and keeps a trailing semicolon', () => {
  expect(insertAtLineEnd('a: s("bd")  // kick', 0, drag)?.code).toBe('a: s("bd").lpf(800)  // kick');
  expect(insertAtLineEnd('a: s("bd");', 0, drag)?.code).toBe('a: s("bd").lpf(800);');
  expect(insertAtLineEnd('a: s("bd")   ', 0, drag)?.code).toBe('a: s("bd").lpf(800)   ');
});
test('a blank or comment line takes the nearest pattern line above', () => {
  expect(insertAtLineEnd('a: s("bd")\n\n// note\n', 2, drag)?.code).toBe('a: s("bd").lpf(800)\n\n// note\n');
});
test('a document with no pattern line refuses', () => {
  expect(insertAtLineEnd('// only\n\n', 1, drag)).toBeNull();
  expect(insertAtLineEnd('', 0, drag)).toBeNull();
});
test('a multi-line chain lands on the dropped-on line, not the last', () => {
  expect(insertAtLineEnd('a: s("bd")\n  .bank("tr909")\n  .gain(1)', 1, drag)?.code).toBe('a: s("bd")\n  .bank("tr909").lpf(800)\n  .gain(1)');
});
test('no argument means no selection', () => {
  expect(insertAtLineEnd('a: s("bd")', 0, { name: 'rev', snippet: '.rev()', argRange: null })).toEqual({ code: 'a: s("bd").rev()', selection: null });
});
test('a line index past the end uses the last line', () => {
  expect(insertAtLineEnd('a: s("bd")', 5, drag)?.code).toBe('a: s("bd").lpf(800)');
});
test('a // inside a string is not a comment', () => {
  expect(insertAtLineEnd('a: s("http://x")', 0, drag)?.code).toBe('a: s("http://x").lpf(800)');
});
test('a trailing comma behaves like a trailing semicolon', () => {
  const stack = 'stack(\n  s("bd*4"),\n  s("hh*8")\n).bank("tr909")';
  expect(insertAtLineEnd(stack, 1, drag)?.code).toBe('stack(\n  s("bd*4").lpf(800),\n  s("hh*8")\n).bank("tr909")');
});
test('a line ending in an opening bracket refuses rather than walking up', () => {
  expect(insertAtLineEnd('a: s("bd")\nstack(\n  s("hh")\n)', 1, drag)).toBeNull();
  expect(insertAtLineEnd('a: s("bd")\nx: cat([  // pats\n', 1, drag)).toBeNull();
});
test('a CRLF document lands before the carriage return', () => {
  expect(insertAtLineEnd('a: s("bd")\r\nb: s("hh")', 0, drag)?.code).toBe('a: s("bd").lpf(800)\r\nb: s("hh")');
});
