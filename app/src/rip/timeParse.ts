/** Clip times as typed in the rip form: plain seconds, m:ss or h:mm:ss, each with optional decimals. */

/** The service refuses longer clips (`MAX_CLIP_SECONDS` in service/algorip/schema.py). */
export const MAX_CLIP_SECONDS = 60;

const NUMBER = /^\d+(\.\d+)?$/;
const PART = /^\d+$/;

/** Seconds for `"72"`, `"1:12"`, `"1:12.5"` or `"1:02:03"` (spaces around allowed); null for anything else. */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length > 3) return null;
  const seconds = parts[parts.length - 1];
  if (!NUMBER.test(seconds)) return null;
  const s = Number(seconds);
  if (parts.length === 1) return s;
  if (s >= 60) return null;
  const units = parts.slice(0, -1);
  if (!units.every((p) => PART.test(p))) return null;
  if (units.length === 1) return Number(units[0]) * 60 + s;
  const [h, m] = units.map(Number);
  if (m >= 60) return null;
  return h * 3600 + m * 60 + s;
}

/** `m:ss`, or `h:mm:ss` from an hour up; fractions are floored. */
export function formatTime(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Why a clip window cannot be ripped, or null when it can. */
export function validateWindow(start: number | null, end: number | null): string | null {
  if (start === null) return 'Enter a start time like 1:12 or 72';
  if (end === null) return 'Enter an end time';
  if (end <= start) return 'End must be after start';
  if (end - start > MAX_CLIP_SECONDS) return 'Clip must be 60 seconds or less';
  return null;
}

/** Why a link cannot be ripped, or null when it can (the service only takes http and https). */
export function validateUrl(url: string): string | null {
  const u = url.trim();
  if (u === '') return 'Enter a YouTube link';
  if (!u.startsWith('http://') && !u.startsWith('https://')) return 'The link must start with http:// or https://';
  return null;
}
