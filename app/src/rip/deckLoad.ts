import type { DeckApi } from '../booth/Deck';
import { newPatternDecision } from '../booth/deckFile';
import type { Pattern } from '../library/api';
import { LOAD_OVER_EDITS_PROMPT } from '../library/store';
import type { AskSave } from '../booth/saveChoice';

/**
 * Puts a rip's pattern on a deck, by the library's load rule: a dirty deck asks first, Save saves before
 * loading, Don't Save loads over the edits and Cancel keeps editing (review focus 5). The deck ends up
 * unsaved (no file) but keeps the pattern, so its Save as records the rip source. Resolves to whether it loaded.
 */
export async function loadToDeck(
  deck: DeckApi,
  pattern: Pattern,
  ask: AskSave,
): Promise<boolean> {
  const dirty = deck.isDirty();
  const decision = newPatternDecision(dirty, dirty ? await ask(LOAD_OVER_EDITS_PROMPT) : null);
  if (decision === 'abort') return false;
  if (decision === 'save-then-start' && !(await deck.save())) return false;
  deck.setCode(pattern.code);
  deck.setName(pattern.name);
  deck.setFile(null, null, pattern);
  return true;
}
