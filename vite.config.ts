import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  root: 'app',
  publicDir: 'public',
  plugins: [solid()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 1420, strictPort: true },
});
