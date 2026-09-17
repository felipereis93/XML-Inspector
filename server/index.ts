import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import {
  type AuthUser,
  createSession,
  destroySession,
  hashPassword,
  userForToken,
  verifyPassword,
} from './auth'
import { db } from './db'
import { seedAdmin } from './seed'

/**
 * API de autenticação e administração de usuários.
 *
 * Processo próprio, rodando via `tsx` como os demais scripts do projeto — não
 * um middleware dentro do Vite, para o backend não ficar amarrado ao
 * bundler do frontend. Em dev, o Vite faz proxy de `/api` para cá (ver
 * `vite.config.ts`); em produção, este processo também serve o `dist/`.
 */

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser
  }
}

// `PORT` é o que Render/Fly/Railway injetam; `BACKEND_PORT` é o nome usado
// no dev local e no scripts/e2e.mjs deste projeto. `PORT` vence quando os
// dois existem, porque é a plataforma de hospedagem quem decide a porta ali.
const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 5174)
const COOKIE_NAME = 'session'
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 // segundos

/**
 * Origens autorizadas a chamar a API de outro domínio — o caso do frontend
 * publicado no GitHub Pages falando com a API hospedada em outro lugar.
 * Vazio (padrão local) significa mesma origem o tempo todo: Vite faz proxy
 * em dev, e o próprio Express serve o `dist/` em produção same-host, então
 * nenhum CORS é necessário nesses dois casos.
 */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)

// Cross-origin com cookie exige SameSite=None, e navegador só aceita
// SameSite=None em HTTPS — daí o Secure andar junto. Same-origin usa Lax
// sem Secure, porque o dev local é http.
const CROSS_SITE = ALLOWED_ORIGINS.length > 0
const COOKIE_ATTRS = CROSS_SITE ? 'SameSite=None; Secure' : 'SameSite=Lax'

seedAdmin()

const app = express()
app.use(cors)
app.use(express.json())
app.use(readSession)

/* ------------------------------------------------------------------ */
/* CORS e sessão                                                       */
/* ------------------------------------------------------------------ */

function cors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Vary', 'Origin')
  }
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.status(204).end()
    return
  }
  next()
}

function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {}
  if (!header) return jar
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    jar[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return jar
}

function readSession(req: Request, _res: Response, next: NextFunction): void {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (token) req.user = userForToken(token)
  next()
}

function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; ${COOKIE_ATTRS}; Max-Age=${SESSION_MAX_AGE}`,
  )
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Path=/; ${COOKIE_ATTRS}; Max-Age=0`,
  )
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: 'Não autenticado.' })
    return
  }
  next()
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Somente administradores podem fazer isso.' })
    return
  }
  next()
}

function publicUser(user: AuthUser) {
  return { id: user.id, username: user.username, role: user.role, status: user.status }
}

interface UserRow {
  id: number
  username: string
  password_hash: string
  password_salt: string
  role: string
  status: string
}

/* ------------------------------------------------------------------ */
/* Autenticação                                                        */
/* ------------------------------------------------------------------ */

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' })
    return
  }
  const name = username.trim()
  if (name.length < 3) {
    res.status(400).json({ error: 'Usuário deve ter ao menos 3 caracteres.' })
    return
  }
  if (password.length < 6) {
    res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' })
    return
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
    res.status(409).json({ error: 'Esse usuário já existe.' })
    return
  }

  // Autoatendimento nasce pendente: só o admin decide quem pode entrar.
  const { hash, salt } = hashPassword(password)
  db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, role, status, created_at)
     VALUES (?, ?, ?, 'user', 'pending', ?)`,
  ).run(name, hash, salt, new Date().toISOString())

  res.status(201).json({ message: 'Conta criada. Aguarde a aprovação do administrador.' })
})

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' })
    return
  }

  const row = db
    .prepare(
      'SELECT id, username, password_hash, password_salt, role, status FROM users WHERE username = ?',
    )
    .get(username.trim()) as UserRow | undefined

  if (!row || !verifyPassword(password, row.password_hash, row.password_salt)) {
    res.status(401).json({ error: 'Usuário ou senha inválidos.' })
    return
  }
  if (row.status === 'pending') {
    res.status(403).json({ error: 'Sua conta ainda não foi aprovada pelo administrador.' })
    return
  }
  if (row.status === 'blocked') {
    res.status(403).json({ error: 'Sua conta foi bloqueada. Fale com o administrador.' })
    return
  }

  const { token } = createSession(row.id)
  setSessionCookie(res, token)
  res.json({
    user: publicUser({
      id: row.id,
      username: row.username,
      role: row.role as AuthUser['role'],
      status: row.status as AuthUser['status'],
    }),
  })
})

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (token) destroySession(token)
  clearSessionCookie(res)
  res.status(204).end()
})

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user!) })
})

/* ------------------------------------------------------------------ */
/* Administração de usuários — tudo atrás de requireAdmin              */
/* ------------------------------------------------------------------ */

app.get('/api/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      'SELECT id, username, role, status, created_at AS createdAt FROM users ORDER BY id',
    )
    .all()
  res.json({ users })
})

app.post('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const { username, password, role } = req.body ?? {}
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'Usuário e senha são obrigatórios.' })
    return
  }
  const name = username.trim()
  if (name.length < 3 || password.length < 6) {
    res.status(400).json({ error: 'Usuário (3+ caracteres) e senha (6+) inválidos.' })
    return
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) {
    res.status(409).json({ error: 'Esse usuário já existe.' })
    return
  }

  const finalRole = role === 'admin' ? 'admin' : 'user'
  const { hash, salt } = hashPassword(password)
  // Criado pelo admin: já entra ativo — é o próprio admin liberando o acesso.
  db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, role, status, created_at)
     VALUES (?, ?, ?, ?, 'active', ?)`,
  ).run(name, hash, salt, finalRole, new Date().toISOString())

  res.status(201).json({ message: 'Usuário criado.' })
})

app.patch('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Não é possível alterar a própria conta por aqui.' })
    return
  }
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) {
    res.status(404).json({ error: 'Usuário não encontrado.' })
    return
  }

  const { status, role } = req.body ?? {}

  if (status !== undefined) {
    if (status !== 'active' && status !== 'blocked' && status !== 'pending') {
      res.status(400).json({ error: 'Status inválido.' })
      return
    }
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id)
    // Bloquear ou voltar a pendente não deve deixar a sessão atual viva.
    if (status !== 'active') {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id)
    }
  }

  if (role !== undefined) {
    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ error: 'Papel inválido.' })
      return
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
  }

  res.status(204).end()
})

app.delete('/api/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id)
  if (id === req.user!.id) {
    res.status(400).json({ error: 'Não é possível excluir a própria conta.' })
    return
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
  res.status(204).end()
})

/* ------------------------------------------------------------------ */
/* Frontend buildado (produção)                                        */
/* ------------------------------------------------------------------ */

const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  // Sem padrão de rota: `'*'` não é mais aceito pelo path-to-regexp do
  // Express 5. Por vir depois de `express.static`, só é alcançado quando
  // nada mais casou — exatamente o fallback de SPA que se quer aqui.
  app.use((_req, res) => res.sendFile(join(distDir, 'index.html')))
}

app.listen(PORT, () => {
  console.log(`API em http://localhost:${PORT}`)
})
