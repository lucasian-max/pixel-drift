import { defineConfig } from 'vite';

// `SPRITE_API` lets a second dev server point at a local API instance while the
// live one keeps talking to the deployed host.
const apiTarget = process.env.SPRITE_API || 'https://api.lucasian.tech';

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
