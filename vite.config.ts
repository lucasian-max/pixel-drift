import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5180,
    allowedHosts: ['drift.lucasian.tech', '.lucasian.tech', '.trycloudflare.com', '.cfargotunnel.com'],
    proxy: { '/api': { target: 'https://api.lucasian.tech', changeOrigin: true, secure: true } },
  },
  preview: { host: '0.0.0.0', port: 5181 },
  build: { target: 'es2022' },
});
