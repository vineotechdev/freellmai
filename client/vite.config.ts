import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

export default defineConfig(({ mode }) => {
  const rootEnvDir = fs.existsSync(path.resolve(__dirname, '../.env'))
    ? path.resolve(__dirname, '..')
    : path.resolve(__dirname)
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, '..'), ''),
    ...loadEnv(mode, path.resolve(__dirname), ''),
  }
  const serverPort = env.PORT ?? process.env.PORT ?? 3001

  return {
    plugins: [react(), tailwindcss()],
    base: process.env.VITE_BASE ?? '/',
    envDir: rootEnvDir,
    define: {
      __SERVER_PORT__: JSON.stringify(String(serverPort)),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@freellmapi/shared/types.js': path.resolve(__dirname, '../shared/types.ts'),
        '@freellmapi/shared/types': path.resolve(__dirname, '../shared/types.ts'),
        '@freellmapi/shared': path.resolve(__dirname, '../shared/types.ts'),
      },
    },
    server: {
      proxy: {
        // Force IPv4 — on Windows + Node 17+, `localhost` resolves to ::1 first,
        // which can collide with wslrelay / Docker Desktop listeners on the same port.
        '/api': `http://127.0.0.1:${serverPort}`,
        '/v1': `http://127.0.0.1:${serverPort}`,
      },
    },
  }
})
