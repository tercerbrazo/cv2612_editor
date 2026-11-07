import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // pin the dev server to one port so the URL (and its granted serial
  // permission) is stable; fail loudly instead of drifting to 5174+
  server: { port: 2612, strictPort: true },
  preview: { port: 2612, strictPort: true },
  plugins: [
    VitePWA({
      // autoUpdate + skipWaiting/clientsClaim: a new build takes over on the
      // next ONLINE load; offline, the service worker serves the cached one.
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-192x192.png', 'icons/icon-512x512.png'],
      // installable as a standalone Chrome app
      manifest: {
        name: 'CV2612 Editor',
        short_name: 'CV2612',
        description: 'CV2612 web editor, flasher and monitor',
        start_url: '/',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#42b883',
        icons: [
          { src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // precache the firmware .hex too (the default globs skip it) so one
        // online load is enough to then flash the module fully offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest,hex}'],
      },
    }),
  ],
})
