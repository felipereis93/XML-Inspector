import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * Banco de usuários e sessões, em SQLite via `node:sqlite` — nativo do Node
 * 22+, sem dependência externa nem binário para compilar. É o "banco real"
 * que não pede infraestrutura para rodar numa ferramenta interna.
 *
 * O arquivo mora em `server/data/`, fora do controle de versão: contém hash
 * de senha, não é dado de exemplo como os XMLs de `samples/`.
 *
 * Sem `seedAdmin` aqui de propósito — ela mora em `seed.ts` e importa
 * `hashPassword` de `auth.ts`, que por sua vez importa `db` daqui. Se a
 * semeadura estivesse neste arquivo, esse ciclo faria `auth.ts` ser
 * executado parcialmente (suas próprias constantes ainda não inicializadas)
 * no meio da carga deste módulo.
 */

const DB_PATH = process.env.DB_PATH ?? 'server/data/app.db'

if (DB_PATH !== ':memory:') mkdirSync(dirname(DB_PATH), { recursive: true })

export const db = new DatabaseSync(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'blocked')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
`)
