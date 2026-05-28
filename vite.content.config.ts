import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

const root = process.cwd();

// Content script must be a single self-contained IIFE file (no runtime imports),
// with React bundled in and CSS inlined (injected into the shadow root by the script).
// Built separately so it doesn't clobber the main side-panel/background build.
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    lib: {
      entry: resolve(root, 'src/content/overlay.tsx'),
      name: 'ChromeBuddyContent',
      formats: ['iife'],
      // Renamed from 'overlay.js' to 'content.js' — the iframe-overlay
      // refactor introduced a new 'overlay' entry in the main build that
      // emits assets/overlay.js for the iframe's React bundle.
      fileName: () => 'assets/content.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
