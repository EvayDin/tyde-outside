import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'API_PROXY_TARGET');
  const apiProxyTarget =
    process.env.API_PROXY_TARGET ?? env.API_PROXY_TARGET ?? 'http://127.0.0.1:3000';
  const useHttps = new URL(apiProxyTarget).protocol === 'https:';
  return {
    base: './',
    plugins: [react(), ...(useHttps ? [basicSsl()] : [])],
    server: {
      host: useHttps ? 'localhost' : '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
      headers: { 'X-Tyde-Dev-Server': 'web' },
    },
    preview: {
      host: useHttps ? 'localhost' : '127.0.0.1',
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
