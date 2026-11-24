import { defineConfig } from 'vite';

// `SPRITE_API` can point a dev server at another API instance; by default the
// API runs on this machine as the sprite-drift-api user service.
const apiTarget = process.env.SPRITE_API || 'http://127.0.0.1:8790';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5180,
    allowedHosts: ['drift.lucasian.tech', '.lucasian.tech', '.trycloudflare.com', '.cfargotunnel.com'],
    proxy: { '/api': { target: apiTarget, changeOrigin: true, secure: true, ws: true } },
  },
  preview: { host: '0.0.0.0', port: 5181 },
  build: { target: 'es2022' },
});
