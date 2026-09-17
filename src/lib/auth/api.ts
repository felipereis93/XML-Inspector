/**
 * Cliente HTTP da API de autenticação. `fetch` puro contra `/api/*`.
 *
 * Três topologias, uma só variável: em dev o Vite faz proxy para o processo
 * `tsx` de `server/` (mesma origem); num host único em produção o próprio
 * Express serve API e `dist/` juntos (mesma origem também); e o GitHub Pages
 * só serve arquivos estáticos, então a API mora em outro domínio ali — é
 * quando `VITE_API_URL` entra, definida no build (ver
 * `.github/workflows/deploy-pages.yml`). Vazia, cai no caminho relativo de
 * sempre. `credentials: 'include'` é o que faz o cookie de sessão atravessar
 * essa origem cruzada; em mesma origem ele não muda nada.
 */

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? ''

export interface AuthUser {
  id: number
  username: string
  role: 'admin' | 'user'
  status: 'pending' | 'active' | 'blocked'
}

export interface AdminUser extends AuthUser {
  createdAt: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...init,
  })
  const body = (await res.json().catch(() => undefined)) as
    | (T & { error?: string })
    | undefined

  if (!res.ok) {
    throw new Error(body?.error ?? 'Falha na requisição.')
  }
  return body as T
}

export const login = (username: string, password: string) =>
  request<{ user: AuthUser }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const register = (username: string, password: string) =>
  request<{ message: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })

export const logout = () => request<void>('/api/auth/logout', { method: 'POST' })

export const me = () => request<{ user: AuthUser }>('/api/auth/me')

export const listUsers = () => request<{ users: AdminUser[] }>('/api/admin/users')

export const createUser = (username: string, password: string, role: 'admin' | 'user') =>
  request<{ message: string }>('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, password, role }),
  })

export const updateUser = (
  id: number,
  patch: { status?: AuthUser['status']; role?: AuthUser['role'] },
) =>
  request<void>(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })

export const deleteUser = (id: number) =>
  request<void>(`/api/admin/users/${id}`, { method: 'DELETE' })
