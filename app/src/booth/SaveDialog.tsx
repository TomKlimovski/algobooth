import { createSignal, For, onMount } from 'solid-js';
import type { TreeNode } from '../library/api';

const ROOT_LABEL = 'library (top)';

export interface SaveTarget {
  name: string;
  /** Heading path to save into; `""` is the library root. */
  heading: string;
}

/** Every heading path in the tree, depth first, root (`""`) first. */
export function headingPaths(node: TreeNode | null): string[] {
  if (!node || node.kind !== 'heading') return [''];
  const out: string[] = [];
  const walk = (n: TreeNode) => {
    if (n.kind !== 'heading') return;
    out.push(n.path);
    n.children.forEach(walk);
  };
  walk(node);
  return out;
}

/**
 * The heading choices: every heading in the tree, plus `requested` marked as new when the tree lacks it
 * (`write_pattern` creates a missing heading folder, so a rip can save under `ripped` on a fresh library).
 */
export function headingOptions(tree: TreeNode | null, requested: string): { path: string; label: string }[] {
  const paths = headingPaths(tree);
  const options = paths.map((path) => ({ path, label: path || ROOT_LABEL }));
  if (!paths.includes(requested)) options.push({ path: requested, label: `${requested} (new)` });
  return options;
}

/** Modal for Save as: a pattern name and the heading to put it under. */
export function SaveDialog(props: {
  deckId: string;
  tree: TreeNode | null;
  name: string;
  heading: string;
  onSave: (target: SaveTarget) => void;
  onCancel: () => void;
}) {
  const options = () => headingOptions(props.tree, props.heading);
  const [name, setName] = createSignal(props.name);
  const [heading, setHeading] = createSignal(props.heading);
  let input!: HTMLInputElement;
  onMount(() => input.select());

  const submit = (e: Event) => {
    e.preventDefault();
    const trimmed = name().trim();
    if (trimmed) props.onSave({ name: trimmed, heading: heading() });
  };

  return (
    <div class="save-backdrop" onClick={(e) => e.target === e.currentTarget && props.onCancel()}>
      <form
        class="save-dialog"
        role="dialog"
        aria-label={`Save deck ${props.deckId} as`}
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && props.onCancel()}
      >
        <label>
          Name
          <input ref={input} value={name()} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <label>
          Heading
          <select value={heading()} onChange={(e) => setHeading(e.currentTarget.value)}>
            <For each={options()}>{(o) => <option value={o.path}>{o.label}</option>}</For>
          </select>
        </label>
        <div class="save-actions">
          <button type="button" class="deck-btn ghost" onClick={props.onCancel}>Cancel</button>
          <button type="submit" class="deck-btn" disabled={!name().trim()}>Save</button>
        </div>
      </form>
    </div>
  );
}
