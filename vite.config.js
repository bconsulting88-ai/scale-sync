import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],

  // './' so Electron can load dist/index.html via file:// protocol
  base: './',

  server: {
    port: 5173,
    strictPort: true,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Electron ships Chromium — target a recent version
    target: 'chrome120',
    // Inline small assets so file:// works without a server
    assetsInlineLimit: 8192,
  },

  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' }
  }
});
