import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Get server URL from environment variable or use default
  // Note: In vite.config.js, we use process.env, not import.meta.env
  const serverUrl = process.env.VITE_API_SERVER_URL || 'https://consentbit-dashboard-test.web-8fb.workers.dev';
  
  
  return {
    plugins: [react()],
    build: {
      outDir: 'dist',
      sourcemap: false,
      // Optimize build for faster loading
      minify: 'esbuild',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom'],
            'query-vendor': ['@tanstack/react-query']
          }
        }
      }
    },
    server: {
      port: 3001,
      open: true,
      // Faster HMR
      hmr: {
        overlay: false
      },
      // Proxy API requests to avoid CORS issues
      proxy: {
        '/api-proxy': {
          target: serverUrl,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/api-proxy/, ''),
          configure: (proxy, _options) => {
            proxy.on('error', (err, _req, _res) => {
            });
            proxy.on('proxyReq', (proxyReq, req, _res) => {
            });
            proxy.on('proxyRes', (proxyRes, req, _res) => {
            });
          },
        }
      }
    },
    // Optimize dependencies
    optimizeDeps: {
      include: ['react', 'react-dom', '@tanstack/react-query']
    }
  }
})

