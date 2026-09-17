import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// A API de autenticação roda num processo `tsx` à parte (`server/`); em dev,
// o Vite faz proxy de `/api` para lá. A porta é configurável porque
// `scripts/e2e.mjs` sobe uma instância isolada da API numa porta própria.
const backendPort = process.env.BACKEND_PORT ?? '5174'

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  // Página de projeto no GitHub Pages: o site fica em
  // github.io/XML-Inspector/, não na raiz do domínio, então o build precisa
  // desse prefixo em todo asset. Só no build — em dev o servidor local
  // continua em "/", senão `npm run dev` e o `scripts/e2e.mjs` (que navegam
  // direto para a raiz) parariam de encontrar a página.
  base: command === 'build' ? '/XML-Inspector/' : '/',
  server: {
    proxy: {
      '/api': `http://localhost:${backendPort}`,
    },
  },
}))
