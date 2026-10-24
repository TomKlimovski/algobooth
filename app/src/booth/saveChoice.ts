import { message } from '@tauri-apps/plugin-dialog';
import { hasTauriRuntime } from '../library/api';

/** The answer to "save before replacing this deck's code?": save first, replace without saving, or keep editing. */
export type SaveChoice = 'save' | 'discard' | 'cancel';

/** Asks which `SaveChoice` to make; injected so tests answer without a dialog. */
export type AskSave = (question: string) => Promise<SaveChoice>;

const SAVE = 'Save';
const DISCARD = "Don't Save";

/**
 * The native Save / Don't Save / Cancel dialog. Outside Tauri (a plain browser) there is no three-button
 * dialog, so OK saves and Cancel keeps editing, as before.
 */
export const askSave: AskSave = async (question) => {
  if (!hasTauriRuntime()) return window.confirm(question) ? 'save' : 'cancel';
  const answer = await message(question, {
    title: 'Unsaved changes',
    kind: 'warning',
    buttons: { yes: SAVE, no: DISCARD, cancel: 'Cancel' },
  });
  // Custom buttons answer with their label on some platforms and with Yes / No on others.
  if (answer === SAVE || answer === 'Yes') return 'save';
  if (answer === DISCARD || answer === 'No') return 'discard';
  return 'cancel';
};
