import { DRAG_RANGE_PX, dragValue } from './knobDrag';

test('dragging up raises the value, 150 px sweeps the whole range', () => {
  expect(DRAG_RANGE_PX).toBe(150);
  expect(dragValue(0.5, 300, 300)).toBe(0.5);
  expect(dragValue(0.5, 300, 300 - 75)).toBeCloseTo(1);
  expect(dragValue(0.5, 300, 300 + 75)).toBeCloseTo(0);
});

test('value is clamped to [0, 1] however far the pointer travels', () => {
  expect(dragValue(0.9, 300, 0)).toBe(1);
  expect(dragValue(0.1, 300, 2000)).toBe(0);
});
