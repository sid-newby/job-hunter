import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 58888,
    proxy: {
      '/api': {
        target: 'http://localhost:58880',
        changeOrigin: true,
      },
    },
  },
});
