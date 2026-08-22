import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // pin the dev server to one port so the URL (and its granted serial
  // permission) is stable; fail loudly instead of drifting to 5174+
  server: { port: 2612, strictPort: true },
  preview: { port: 2612, strictPort: true },
  plugins: [VitePWA({ registerType: 'autoUpdate' })],
})
