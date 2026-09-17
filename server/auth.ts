import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db'

/**
 * Senha e sessão, só com `node:crypto` — nenhuma dependência de hashing
 * externa (bcrypt exige binário nativo para compilar).
 *
 * Senha: scrypt com sal por usuário. Sessão: token opaco de 32 bytes que vira
 * cookie; só o hash SHA-256 dele vive no banco, então um dump do banco não
 * entrega sessões válidas — teria que quebrar o token de volta, que nunca foi
 * gravado em lugar nenhum.
 */

const KEY_LENGTH = 64
const SESSION_DAYS = 7

export interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'blocked'
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return { hash, salt }
}

export function verifyPassword(
  password: string,
  hash: string,
  salt: string,
): boolean {
  const candidate = scryptSync(password, salt, KEY_LENGTH)
  const stored = Buffer.from(hash, 'hex')
  // Comprimentos diferentes (banco corrompido, hash de outro esquema) já
  // reprovam antes de chegar em timingSafeEqual, que exige buffers do mesmo
  // tamanho e lançaria em vez de devolver `false`.
  return candidate.length === stored.length && timingSafeEqual(candidate, stored)
}

export function createSession(userId: number): { token: string } {
  const token = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString()

  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
  ).run(tokenHash, userId, expiresAt)

  return { token }
}

export function destroySession(token: string): void {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
}

export function userForToken(token: string): AuthUser | undefined {
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.role, u.status, s.expires_at AS expiresAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as
    | {
        id: number
        username: string
        role: string
        status: string
        expiresAt: string
      }
    | undefined

  if (!row) return undefined

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return undefined
  }

  return {
    id: row.id,
    username: row.username,
    role: row.role as AuthUser['role'],
    status: row.status as AuthUser['status'],
  }
}
