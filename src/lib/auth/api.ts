/**
 * Cliente HTTP da API de autenticação. `fetch` puro contra `/api/*` — em dev
 * o Vite faz proxy para o processo `tsx` de `server/`; em produção o mesmo
 * processo serve API e `dist/` na mesma origem. Cookie de sessão vai junto
 * por padrão: `fetch` já envia cookies em requisições de mesma origem.
 */

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
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
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
