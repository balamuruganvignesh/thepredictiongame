import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// The client is a plain Vite/React SPA; the game server is a separate Node
// process. In dev, /socket.io AND /api are proxied so the browser only ever
// talks to one origin. In prod the server serves dist/client itself.
//
// /api matters as much as the socket: the leaderboard and the public table
// browser are plain REST, and without the proxy they hit Vite's SPA fallback,
// get index.html back, and fail to parse as JSON -- which surfaces as
// "couldn't reach the list" in dev only.
export default defineConfig({
  root: 'src/client',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
    },
  },
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
})
