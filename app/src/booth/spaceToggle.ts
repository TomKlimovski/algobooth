/**
 * Space toggles start/stop for both decks while the Booth tab is showing, unless the keystroke belongs to
 * an editor or a form control.
 */
export function isTransportKey(
  e: { code: string; target: EventTarget | null; repeat?: boolean },
  boothShowing = true,
): boolean {
  if (!boothShowing || e.code !== 'Space' || e.repeat) return false;
  const el = e.target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return true;
  return !el.closest('.cm-editor, input, textarea, select, button, [contenteditable]');
}

/** Any deck playing means Space stops everything; otherwise it starts everything. */
export const transportAction = (anyStarted: boolean): 'stop' | 'start' => (anyStarted ? 'stop' : 'start');
