import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Check, Plus, ShieldCheck, Trash2, UserX, X } from 'lucide-react'
import * as api from '../../lib/auth/api'
import type { AdminUser } from '../../lib/auth/api'
import { useAuth } from '../../store/useAuth'
import { pushToast } from '../../store/useToasts'
import { Button, IconButton, Select } from '../ui/controls'

/**
 * Painel de usuários, só para admin — "só o admin libera" vira interface
 * aqui: aprovar, bloquear, promover e excluir. Alterar a própria conta é
 * bloqueado no servidor (`server/index.ts`); a linha do próprio admin não
 * mostra ação nenhuma, para não sugerir um botão que a API vai recusar.
 */
export function AdminUsersPanel({ onClose }: { onClose: () => void }) {
  const currentUser = useAuth((s) => s.user)
  const [users, setUsers] = useState<AdminUser[]>()
  const [creating, setCreating] = useState(false)

  const load = () => {
    api
      .listUsers()
      .then(({ users }) => setUsers(users))
      .catch((error: unknown) =>
        pushToast(
          'error',
          error instanceof Error ? error.message : 'Falha ao carregar usuários.',
        ),
      )
  }

  useEffect(load, [])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      load()
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : `Falha ao ${label}.`)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="panel flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden bg-[var(--surface)]">
        <div className="flex items-center gap-2 border-b border-[var(--hairline)] px-4 py-3">
          <h2 className="font-display text-[15px] font-semibold">Usuários</h2>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => setCreating((v) => !v)}
          >
            <Plus size={13} />
            Novo usuário
          </Button>
          <IconButton label="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        {creating && (
          <NewUserForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false)
              load()
            }}
          />
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!users ? (
            <p className="p-4 text-[12.5px] text-[var(--fg-muted)]">Carregando…</p>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-[var(--surface-sunken)] text-left text-[var(--fg-muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Usuário</th>
                  <th className="px-4 py-2 font-medium">Papel</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    self={user.id === currentUser?.id}
                    onAct={act}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function UserRow({
  user,
  self,
  onAct,
}: {
  user: AdminUser
  self: boolean
  onAct: (label: string, fn: () => Promise<unknown>) => Promise<void>
}) {
  return (
    <tr className="border-t border-[var(--hairline)]">
      <td className="px-4 py-2 font-medium">
        {user.username}
        {self && <span className="ml-1.5 font-normal text-[var(--fg-subtle)]">(você)</span>}
      </td>
      <td className="px-4 py-2">
        <StatusBadge tone={user.role === 'admin' ? 'brand' : 'muted'}>
          {user.role === 'admin' ? 'Admin' : 'Usuário'}
        </StatusBadge>
      </td>
      <td className="px-4 py-2">
        <StatusBadge
          tone={
            user.status === 'active' ? 'brand' : user.status === 'pending' ? 'changed' : 'removed'
          }
        >
          {user.status === 'active'
            ? 'Ativo'
            : user.status === 'pending'
              ? 'Pendente'
              : 'Bloqueado'}
        </StatusBadge>
      </td>
      <td className="px-4 py-2">
        {self ? (
          <span className="text-[var(--fg-subtle)]">—</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {user.status !== 'active' && (
              <IconButton
                label="Aprovar / ativar"
                onClick={() => onAct('aprovar', () => api.updateUser(user.id, { status: 'active' }))}
              >
                <Check size={14} />
              </IconButton>
            )}
            {user.status !== 'blocked' && (
              <IconButton
                label="Bloquear"
                onClick={() => onAct('bloquear', () => api.updateUser(user.id, { status: 'blocked' }))}
              >
                <UserX size={14} />
              </IconButton>
            )}
            <IconButton
              label={user.role === 'admin' ? 'Remover admin' : 'Tornar admin'}
              onClick={() =>
                onAct('alterar papel', () =>
                  api.updateUser(user.id, { role: user.role === 'admin' ? 'user' : 'admin' }),
                )
              }
            >
              <ShieldCheck size={14} />
            </IconButton>
            <IconButton
              label="Excluir"
              onClick={() => {
                if (confirm(`Excluir "${user.username}"?`)) {
                  void onAct('excluir', () => api.deleteUser(user.id))
                }
              }}
            >
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </td>
    </tr>
  )
}

function StatusBadge({
  tone,
  children,
}: {
  tone: 'brand' | 'muted' | 'changed' | 'removed'
  children: ReactNode
}) {
  const colors: Record<typeof tone, string> = {
    brand: 'bg-brand-50 text-brand-700',
    muted: 'bg-[var(--surface-sunken)] text-[var(--fg-muted)]',
    changed: 'bg-changed/10 text-changed',
    removed: 'bg-removed/10 text-removed',
  }
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${colors[tone]}`}>
      {children}
    </span>
  )
}

function NewUserForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void
  onCreated: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    try {
      await api.createUser(username, password, role)
      pushToast('success', `Usuário "${username}" criado.`)
      onCreated()
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Falha ao criar usuário.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-end gap-2 border-b border-[var(--hairline)] bg-[var(--surface-sunken)] px-4 py-3"
    >
      <label className="flex flex-col gap-1 text-[11.5px] text-[var(--fg-muted)]">
        Usuário
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          autoFocus
          className="h-8 w-36 rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 text-[13px] text-[var(--fg)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-[var(--fg-muted)]">
        Senha
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="h-8 w-36 rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 text-[13px] text-[var(--fg)]"
        />
      </label>
      <label className="flex flex-col gap-1 text-[11.5px] text-[var(--fg-muted)]">
        Papel
        <Select
          value={role}
          onChange={(event) => setRole(event.target.value as 'user' | 'admin')}
          className="h-8 w-28"
        >
          <option value="user">Usuário</option>
          <option value="admin">Admin</option>
        </Select>
      </label>
      <Button type="submit" size="sm" variant="solid" disabled={busy || !username || !password}>
        Criar
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </form>
  )
}
