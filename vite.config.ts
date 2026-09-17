import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A API de autenticação roda num processo `tsx` à parte (`server/`); em dev,
// o Vite faz proxy de `/api` para lá. A porta é configurável porque
// `scripts/e2e.mjs` sobe uma instância isolada da API numa porta própria.
const backendPort = process.env.BACKEND_PORT ?? '5174'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  server: {
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
})
