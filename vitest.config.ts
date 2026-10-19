import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['app/src/**/*.test.ts', 'app/src/**/*.test.tsx'],
    // Strudel goes through vite, so its browser-only kabelsalat dependency can be stubbed for real-repl tests.
    server: { deps: { inline: [/@strudel\//] } },
    alias: { '@kabelsalat/web': decodeURIComponent(new URL('./app/src/test/kabelsalat-stub.ts', import.meta.url).pathname) },
  },
});
