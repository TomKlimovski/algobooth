import { createEffect, on } from 'solid-js';
import { createStore } from 'solid-js/store';
import { render } from 'solid-js/web';

vi.mock('@strudel/webaudio', () => ({
  getAudioContext: () => ({ currentTime: 0, resume: async () => {} }),
  webaudioOutput: async () => {},
}));
vi.mock('../engine/mixer', () => ({ installMixer: () => {}, RIP_ORBIT: 3 }));
vi.mock('../engine/strudel', () => ({ initEngine: async () => {} }));
// jsdom has no canvas; Strudel clears its drawing canvas on every stop.
(HTMLCanvasElement.prototype as any).getContext = () => ({ clearRect() {}, canvas: { width: 1, height: 1 } });

const { ResultEditor } = await import('./ResultEditor');
type ResultApi = import('./ResultEditor').ResultApi;

const flush = () => new Promise((r) => setTimeout(r, 0));
const docText = (root: HTMLElement) => root.querySelector('.cm-content')!.textContent;

/** The rip tab in miniature: a store with the code, an effect that stops the result on every new rip, the editor. */
function mount() {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const [state, setState] = createStore({ code: 'old rip', result: null as null | { code: string } });
  const onChange = vi.fn((code: string) => setState('code', code));
  let api!: ResultApi;
  const dispose = render(() => {
    // Like RipTab's stems effect, which is created before the editor and stops the result when a rip ends.
    createEffect(on(() => state.result, () => api?.stop()));
    return <ResultEditor code={state.code} onChange={onChange} onReady={(a) => (api = a)} />;
  }, root);
  return { root, state, setState, onChange, api: () => api, dispose };
}

test('a rip ending puts its code in the editor even though the stop echoes the old code', async () => {
  const m = mount();
  await flush();
  expect(docText(m.root)).toBe('old rip');
  // Analyse: the store clears the code; the editor follows.
  m.setState({ code: '', result: null });
  await flush();
  expect(docText(m.root)).toBe('');
  // The rip ends: the result and the code land in one update, the result first (as the store writes them),
  // so the stop effect runs before the editor has been given the new code.
  m.setState({ result: { code: 'setcpm(129/4)' }, code: 'setcpm(129/4)' });
  await flush();
  expect(m.state.code).toBe('setcpm(129/4)');
  expect(docText(m.root)).toBe('setcpm(129/4)');
  m.dispose();
});

test('typing in the editor reaches the store, and the store echoing it back changes nothing', async () => {
  const m = mount();
  await flush();
  // The repl's setCode is what the editor calls on every document change.
  const typed = 'typed';
  const content = m.root.querySelector('.cm-content') as HTMLElement;
  content.textContent = typed;
  await flush(); // the editor's DOM observer reads the change and dispatches it
  expect(m.onChange).toHaveBeenCalledWith(typed);
  expect(m.state.code).toBe(typed);
  expect(docText(m.root)).toBe(typed);
  m.dispose();
});
