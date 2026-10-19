import { Deck } from './booth/Deck';
import { createDeckState } from './booth/deckState';

export function App() {
  const deckA = createDeckState('A');
  return (
    <main style={{ padding: '16px', 'max-width': '720px' }}>
      <Deck state={deckA} />
    </main>
  );
}
