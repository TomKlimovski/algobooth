import { channelOf, lane, laneOrbit, routeToChannel, routeValue } from './lanes';

const core = await import('@strudel/core/dist/index.mjs');
const mini = await import('@strudel/mini/dist/index.mjs');

test('lane 1 is the channel itself, lane n its own orbit n0 + n, bad numbers lane 1, big ones the last lane', () => {
  expect(laneOrbit(1, undefined)).toBe(1);
  expect(laneOrbit(1, 1)).toBe(1);
  expect(laneOrbit(1, 2)).toBe(12);
  expect(laneOrbit(2, 2)).toBe(22);
  expect(laneOrbit(3, '4')).toBe(34);
  expect(laneOrbit(2, 99)).toBe(28);
  expect(lane('x')).toBe(1);
  expect(lane(0)).toBe(1);
});

test('channelOf finds the owner of a lane orbit and refuses anything else', () => {
  expect(channelOf(1)).toBe(1);
  expect(channelOf(12)).toBe(1);
  expect(channelOf(28)).toBe(2);
  expect(channelOf(33)).toBe(3);
  expect(channelOf(11)).toBeNull(); // lane 1 is the channel's own orbit, never 11
  expect(channelOf(19)).toBeNull();
  expect(channelOf(4)).toBeNull();
  expect(channelOf(42)).toBeNull();
});

test('routeValue maps orbit and every duckorbit target onto the channel', () => {
  expect(routeValue({ s: 'bd', duckorbit: 2 }, 2)).toEqual({ s: 'bd', orbit: 2, duckorbit: 22 });
  expect(routeValue({ s: 'pad', orbit: 2 }, 1)).toEqual({ s: 'pad', orbit: 12 });
  expect(routeValue({ s: 'bd', duckorbit: [2, 3] }, 1)).toEqual({ s: 'bd', orbit: 1, duckorbit: [12, 13] });
});

test('a real pattern keeps its sidechain inside the deck', () => {
  const code = mini.mini('bd*4');
  const kick = routeToChannel(core.s(code).duckorbit(2), 2);
  const pads = routeToChannel(core.note('c3').s('sawtooth').orbit(2), 2);
  expect(kick.firstCycle()[0].value).toMatchObject({ s: 'bd', orbit: 2, duckorbit: 22 });
  expect(pads.firstCycle()[0].value).toMatchObject({ orbit: 22 });
  expect(routeToChannel(core.sequence(1, 2), 1).firstCycle().map((h: any) => h.value)).toEqual([1, 2]);
});
