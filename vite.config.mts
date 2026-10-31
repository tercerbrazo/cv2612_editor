import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // pin the dev server to one port so the URL (and its granted serial
  // permission) is stable; fail loudly instead of drifting to 5174+
  server: { port: 2612, strictPort: true },
  preview: { port: 2612, strictPort: true },
  // autoUpdate + skipWaiting/clientsClaim so a new deploy takes over on the
  // next load instead of serving the stale cached build until a hard reload —
  // this is a QC tool that must always be the latest, not an offline app.
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { skipWaiting: true, clientsClaim: true },
    }),
  ],
})
