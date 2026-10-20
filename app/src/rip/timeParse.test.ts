import { formatTime, MAX_CLIP_SECONDS, parseTime, validateUrl, validateWindow } from './timeParse';

test('parses minutes:seconds and plain seconds', () => {
  expect(parseTime('1:12')).toBe(72);
  expect(parseTime('72')).toBe(72);
  expect(parseTime(' 1:12.5 ')).toBe(72.5);
  expect(parseTime('1:02:03')).toBe(3723);
  expect(parseTime('1:72')).toBeNull();
  expect(parseTime('abc')).toBeNull();
  expect(parseTime('')).toBeNull();
});

test('refuses malformed times', () => {
  for (const t of ['1:', ':12', '1:2:3:4', '-5', '1:60', '1:61:00', '1 :12', '1.5:00', '.5', '5.']) {
    expect(parseTime(t)).toBeNull();
  }
  expect(parseTime('0')).toBe(0);
  expect(parseTime('7.25')).toBe(7.25);
  expect(parseTime('90:00')).toBe(5400); // minutes are free without an hours part
});

test('formats back', () => {
  expect(formatTime(72)).toBe('1:12');
  expect(formatTime(5)).toBe('0:05');
  expect(formatTime(3723.9)).toBe('1:02:03');
  expect(formatTime(59.99)).toBe('0:59');
});

test('window rules (review focus 2)', () => {
  expect(MAX_CLIP_SECONDS).toBe(60);
  expect(validateWindow(72, 88)).toBeNull();
  expect(validateWindow(88, 72)).toBe('End must be after start');
  expect(validateWindow(72, 72)).toBe('End must be after start');
  expect(validateWindow(0, 61)).toBe('Clip must be 60 seconds or less');
  expect(validateWindow(0, 60)).toBeNull();
  expect(validateWindow(null, 5)).toBe('Enter a start time like 1:12 or 72');
  expect(validateWindow(5, null)).toBe('Enter an end time');
});

test('url rules (review focus 2)', () => {
  expect(validateUrl('ftp://x')).toBe('The link must start with http:// or https://');
  expect(validateUrl('youtube.com/watch?v=x')).toBe('The link must start with http:// or https://');
  expect(validateUrl('')).toBe('Enter a YouTube link');
  expect(validateUrl('   ')).toBe('Enter a YouTube link');
  expect(validateUrl('https://www.youtube.com/watch?v=x')).toBeNull();
  expect(validateUrl('http://example.com/a')).toBeNull();
});
