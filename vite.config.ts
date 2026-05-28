import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = process.cwd();

// MV3 build: side panel HTML entry + background service worker.
// Stable, non-hashed output names so manifest.json can reference them.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'sidepanel.html'),
        // Overlay runs at the EXTENSION origin via an iframe injected by
        // the content script — see src/content/overlay.tsx and
        // web_accessible_resources in public/manifest.json. Sharing the
        // extension origin means it shares IndexedDB with the side panel.
        overlay: resolve(root, 'overlay.html'),
        sandbox: resolve(root, 'sandbox.html'),
        background: resolve(root, 'src/background/background.ts'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
});
