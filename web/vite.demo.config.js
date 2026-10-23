import { defineConfig } from 'vite';
import { copyFileSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

// The demo site (web/src/demo): the same page with a fake machine in the browser. Built on its
// own, so the page that goes into the firmware (vite.config.js) stays as it is.
//   node node_modules/vite/bin/vite.js build --config vite.demo.config.js
const outDir = process.env.DEMO_OUT || 'dist-demo';

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
    {
      // demo.html becomes the site's index.html; 404.html sends any other address to the page;
      // added to a home screen it is called the demo
      name: 'demo-index',
      closeBundle() {
        renameSync(resolve(outDir, 'demo.html'), resolve(outDir, 'index.html'));
        copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
        const manifest = resolve(outDir, 'app.webmanifest');
        writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(/"De'Longezzi"/g, `"De'Longezzi Demo"`));
      },
    },
  ],
  build: {
    outDir,
    emptyOutDir: true,
    rollupOptions: {
      input: 'demo.html',
      output: {
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash][extname]',
      },
    },
  },
});
