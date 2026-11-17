import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import type { Plugin } from 'vite';

// The phone app never carries a final's variants: they are cut out of every case file before it
// is bundled (the server reads the full files from disk). Skipped under Vitest, whose tests
// check the full files.
function stripFinalVariants(): Plugin {
  return {
    name: 'strip-final-variants',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replace(/\\/g, '/');
      if (process.env.VITEST || !/\/src\/content\/[^/]+\.json$/.test(file)) return null;
      const c = JSON.parse(code) as { variants?: { finalOnly?: boolean }[] };
      if (!Array.isArray(c.variants)) return null;
      c.variants = c.variants.filter((v) => !v.finalOnly);
      return { code: JSON.stringify(c), map: null };
    },
  };
}

// The score server; MARONA_API_PORT moves it (see playwright.config.ts).
const API_TARGET = `http://127.0.0.1:${process.env.MARONA_API_PORT ?? 8787}`;

export default defineConfig({
  plugins: [
    stripFinalVariants(),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Marona (prototype)',
        short_name: 'Marona',
        start_url: '/',
        display: 'standalone',
        background_color: '#fafaf9',
        theme_color: '#15803d',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
    }),
  ],
  server: { proxy: { '/api': API_TARGET } },
  preview: { proxy: { '/api': API_TARGET } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
