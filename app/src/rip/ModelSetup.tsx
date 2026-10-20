import { Show } from 'solid-js';
import type { ModelStatus } from './ripApi';
import { setupMessage } from './setupMessage';

/** The first-run screen: what the rip needs, a progress bar while it installs, and Download now or Retry. */
export function ModelSetup(props: { status: ModelStatus; onInstall: () => void; pending?: boolean }) {
  const msg = () => setupMessage(props.status);
  const percent = () => Math.round(Math.min(1, Math.max(0, props.status.progress)) * 100);
  return (
    <section class="rip-setup" aria-live="polite">
      <h2 class="rip-setup-title">{msg().title}</h2>
      <p class="rip-setup-body" classList={{ error: msg().action === 'retry' }}>{msg().body}</p>
      <Show when={msg().action === 'wait'}>
        <div class="rip-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent()}>
          <div class="rip-bar-fill" style={{ width: `${percent()}%` }} />
        </div>
      </Show>
      <Show when={msg().action === 'download' || msg().action === 'retry'}>
        <button class="deck-btn" onClick={() => props.onInstall()}>
          {msg().action === 'retry' ? 'Retry' : 'Download now'}
        </button>
      </Show>
      <Show when={props.pending}>
        <p class="rip-setup-note">Your rip starts by itself once this is done.</p>
      </Show>
    </section>
  );
}
