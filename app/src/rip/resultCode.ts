/** Strudel's repl reports this as its code until the editor document first changes. */
export const REPL_PLACEHOLDER = '// LOADING';

/**
 * Whether a repl state report should become the store's code. The repl reports its whole state on
 * every change (start, stop, pending...), so only a report that matches the editor's own text is a
 * real edit; the placeholder, or code from before a `setCode`, must never overwrite the rip result.
 */
export function acceptReplCode(reported: string | undefined, editorCode: string, storeCode: string): boolean {
  if (reported === undefined || reported === REPL_PLACEHOLDER) return false;
  return reported === editorCode && reported !== storeCode;
}
