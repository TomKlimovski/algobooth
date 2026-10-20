import type { Pattern } from '../library/api';
import type { RipResult } from './ripApi';
import { formatTime } from './timeParse';

const MAX_NAME = 80;

/** The suggested library name: the video title and where the clip starts, at most 80 characters. */
export function defaultName(title: string, start: number): string {
  return `${title} ${formatTime(start)}`.slice(0, MAX_NAME).trim();
}

/** A library pattern for a rip, recording where it came from. */
export function ripPattern(
  result: RipResult,
  req: { url: string; start: number; end: number },
  name: string,
  code: string,
  now: () => Date = () => new Date(),
): Pattern {
  return {
    name,
    code,
    cpm: Math.round(result.analysis.bpm),
    key: result.analysis.key,
    tags: [],
    notes: '',
    source: { kind: 'rip', url: req.url, start: req.start, end: req.end, rippedAt: now().toISOString() },
  };
}
