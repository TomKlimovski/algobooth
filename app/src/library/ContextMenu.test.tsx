import { render } from 'solid-js/web';
import { vi } from 'vitest';
import { ContextMenu } from './ContextMenu';

test('Escape closes the menu and is marked handled, so the booth does not also toggle perform mode', () => {
  const onClose = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const dispose = render(() => <ContextMenu x={0} y={0} items={[{ label: 'Clear', action: () => {} }]} onClose={onClose} />, host);
  try {
    const e = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(e);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  } finally {
    dispose();
    host.remove();
  }
});
