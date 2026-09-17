/**
 * `npm run dev` sobe front (Vite) e API (`server/`) juntos, num só comando.
 *
 * Dois processos, não um servidor Express montando o middleware do Vite: a
 * API roda por `tsx`, igual aos outros scripts do projeto, sem amarrar o
 * backend ao bundler do frontend. `scripts/e2e.mjs` sobe os dois do mesmo
 * jeito, cada um por conta própria, numa porta isolada para teste.
 */
import { spawn } from 'node:child_process'

const procs = [
  spawn('npx', ['tsx', 'watch', 'server/index.ts'], { stdio: 'inherit', shell: true }),
  spawn('npx', ['vite'], { stdio: 'inherit', shell: true }),
]

let closing = false
function stop(code) {
  if (closing) return
  closing = true
  for (const proc of procs) proc.kill()
  process.exit(code ?? 0)
}

for (const proc of procs) proc.on('exit', (code) => stop(code ?? 0))
process.on('SIGINT', () => stop(0))
process.on('SIGTERM', () => stop(0))
