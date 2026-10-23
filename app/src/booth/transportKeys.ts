/**
 * The reserved transport keys, the same in edit and perform mode while the Booth tab is showing:
 * Space starts or stops both decks, Cmd+Enter (Ctrl+Enter off the Mac) plays or stops the deck the keys
 * play, and Backquote stops everything. Space and Backquote leave the editor and form fields alone (Space a
 * focused button too); Cmd/Ctrl+Enter works in the editor as well and only leaves form fields alone.
 */
export type TransportKey = 'both' | 'deck' | 'stopAll';

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
/** The deck toggle as the hint line and tooltips show it. */
export const MOD_ENTER = IS_MAC ? '⌘↵' : 'ctrl+↵';

interface KeyLike {
  code: string;
  target: EventTarget | null;
  repeat?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

const inside = (target: EventTarget | null, selector: string): boolean => {
  const el = target as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest(selector);
};

export function transportKey(e: KeyLike, boothShowing = true, mac = IS_MAC): TransportKey | null {
  if (!boothShowing || e.repeat) return null;
  if (e.code === 'Enter' || e.code === 'NumpadEnter') {
    const mod = mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
    if (!mod || e.altKey || e.shiftKey || inside(e.target, 'input, textarea, select')) return null;
    return 'deck';
  }
  const typing = inside(e.target, '.cm-editor, input, textarea, select, [contenteditable]');
  // Space on a focused button presses it, so the button keeps it.
  if (e.code === 'Space') return typing || inside(e.target, 'button') ? null : 'both';
  if (e.code !== 'Backquote' || typing || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return 'stopAll';
}

/** Any deck playing means Space stops everything; otherwise it starts everything. */
export const transportAction = (anyStarted: boolean): 'stop' | 'start' => (anyStarted ? 'stop' : 'start');
