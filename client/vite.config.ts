import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, import.meta.dirname, 'DEV_')
  const host = environment.DEV_CLIENT_HOST || 'localhost'
  const port = Number(environment.DEV_CLIENT_PORT || '5173')

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host,
      port,
      strictPort: true,
      proxy: {
        '/api': {
          target: environment.DEV_API_TARGET || 'http://localhost:5000',
          changeOrigin: true,
          configure(proxy) {
            proxy.on('start', (request) => {
              // Trust the connection, never forwarded headers supplied by a client.
              request.headers['x-forwarded-for'] =
                request.socket.remoteAddress ?? '127.0.0.1'
              request.headers['x-forwarded-host'] =
                request.headers.host ?? `${host}:${port}`
              request.headers['x-forwarded-proto'] =
                'encrypted' in request.socket && request.socket.encrypted
                  ? 'https'
                  : 'http'
              delete request.headers.forwarded
              delete request.headers['x-real-ip']
            })
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
  }
})
