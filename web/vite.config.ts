import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const target = process.env.HEARTHBOARD_API ?? 'http://localhost:8080';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': target,
      '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 1500 },
});
