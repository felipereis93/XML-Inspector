import { randomBytes } from 'node:crypto'
import { hashPassword } from './auth'
import { db } from './db'

/**
 * Primeira conta do sistema. Sem um admin já existente ninguém consegue
 * aprovar mais ninguém — "só o admin libera" exige que essa conta exista
 * antes de qualquer outra funcionar. Roda só quando a tabela está vazia: uma
 * vez criado, reiniciar o servidor nunca recria nem reseta a senha do admin.
 *
 * Módulo próprio, separado de `db.ts`: `auth.ts` importa `db`, então colocar
 * isto em `db.ts` (que precisaria importar `auth.ts` de volta) criaria um
 * ciclo entre os dois módulos.
 */
export function seedAdmin(): void {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  if (row.n > 0) return

  const username = process.env.ADMIN_USERNAME ?? 'admin'
  const usedEnvPassword = Boolean(process.env.ADMIN_PASSWORD)
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url')
  const { hash, salt } = hashPassword(password)

  db.prepare(
    `INSERT INTO users (username, password_hash, password_salt, role, status, created_at)
     VALUES (?, ?, ?, 'admin', 'active', ?)`,
  ).run(username, hash, salt, new Date().toISOString())

  if (!usedEnvPassword) {
    console.log('\n──────────────────────────────────────────────')
    console.log(' Conta de administrador criada')
    console.log(` usuário: ${username}`)
    console.log(` senha:   ${password}`)
    console.log(' Troque a senha assim que possível.')
    console.log('──────────────────────────────────────────────\n')
  }
}
