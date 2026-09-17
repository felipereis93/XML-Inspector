import {
  useEffect,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Check, Eye, EyeOff, LogIn, LoaderCircle, UserPlus } from 'lucide-react'
import logo from '../../assets/prisma-visualizer-logo.png'
import * as api from '../../lib/auth/api'
import { useAuth } from '../../store/useAuth'
import { cn } from '../../lib/cn'
import { Button } from '../ui/controls'

type Mode = 'login' | 'register'
type Phase = 'idle' | 'busy' | 'success'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tela de entrada. "Criar conta" existe, mas não dá acesso — a conta nasce
 * pendente e só funciona depois que um admin aprova em `AdminUsersPanel`.
 * É a metade auto-atendida de "só o admin libera": qualquer um pede, só o
 * admin decide.
 *
 * Login e cadastro falam com `lib/auth/api` diretamente, não com uma ação de
 * store: o sucesso do login precisa de um instante para o botão mostrar o
 * check antes da troca de tela, e só o componente sabe quando essa animação
 * termina. `setSession` (o único jeito de tornar a sessão global) só é
 * chamado depois desse respiro — ver `useAuth.ts`.
 */
export function LoginScreen() {
  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()
  const [shake, setShake] = useState(false)

  const setSession = useAuth((s) => s.setSession)

  // Sacode o cartão a cada erro novo — não só na primeira vez. O estado volta
  // a `false` sozinho para que o próximo erro, mesmo repetindo a mesma
  // mensagem, comece a animação do zero.
  useEffect(() => {
    if (!error) return
    setShake(true)
    const timer = setTimeout(() => setShake(false), 420)
    return () => clearTimeout(timer)
  }, [error])

  const switchMode = (next: Mode) => {
    if (next === mode || phase !== 'idle') return
    setMode(next)
    setNotice(undefined)
    setError(undefined)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setPhase('busy')
    try {
      if (mode === 'login') {
        const { user } = await api.login(username, password)
        // O check fica visível um instante antes da troca para o app — sem
        // ele, uma sessão que já vem quente do servidor trocaria de tela
        // rápido demais para o usuário perceber que funcionou.
        setPhase('success')
        await sleep(450)
        setSession(user)
      } else {
        const { message } = await api.register(username, password)
        setNotice(message)
        setMode('login')
        setPassword('')
        setPhase('idle')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao processar.')
      setPhase('idle')
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-[var(--surface)] p-6">
      <div className="w-full max-w-sm">
        <img
          src={logo}
          alt="Prisma Visualizer"
          className="mx-auto mb-6 h-auto w-40 sm:w-[220px]"
        />

        <div className={cn('panel animate-rise p-6 sm:p-7', shake && 'animate-shake')}>
          <TabSwitch mode={mode} onChange={switchMode} />

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            {notice && <Banner tone="notice">{notice}</Banner>}
            {error && <Banner tone="error">{error}</Banner>}

            <FloatingField
              id="login-username"
              label="Usuário"
              value={username}
              autoComplete="username"
              autoFocus
              onChange={(value) => {
                setUsername(value)
                setError(undefined)
              }}
            />

            <FloatingField
              id="login-password"
              label="Senha"
              type={showPassword ? 'text' : 'password'}
              value={password}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              onChange={(value) => {
                setPassword(value)
                setError(undefined)
              }}
              rightSlot={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="flex size-7 items-center justify-center rounded text-[var(--fg-subtle)] transition-colors hover:text-brand-600"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            />

            <Button
              type="submit"
              variant="solid"
              disabled={phase !== 'idle' || !username || !password}
              className={cn(
                // `mt-2` some ao `gap-4` do form (16px): 16 + 8 = 24px até o
                // último campo, o respiro maior que separa "preencher" de "agir".
                'mt-2 h-14 justify-center text-[13.5px] transition-[transform,box-shadow,background-color]',
                'hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 active:scale-[0.98]',
                phase === 'success' && 'bg-brand-600 disabled:opacity-100',
              )}
            >
              {phase === 'success' ? (
                <span className="flex items-center gap-1.5 animate-pop">
                  <Check size={15} />
                  Pronto
                </span>
              ) : phase === 'busy' ? (
                <span className="flex items-center gap-1.5">
                  <LoaderCircle size={15} className="animate-spin" />
                  Entrando…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  {mode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />}
                  {mode === 'login' ? 'Entrar' : 'Criar conta'}
                </span>
              )}
            </Button>
          </form>

          {mode === 'register' && (
            <p className="mt-3 text-center text-[11.5px] text-[var(--fg-muted)]">
              Sua conta fica pendente até um administrador liberar o acesso.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function TabSwitch({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="relative grid grid-cols-2 rounded-lg bg-[var(--surface-sunken)] p-1">
      <span
        aria-hidden
        className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-md bg-[var(--surface)] shadow-sm transition-transform duration-300 ease-out"
        style={{ transform: mode === 'register' ? 'translateX(calc(100% + 4px))' : 'translateX(0)' }}
      />
      {(
        [
          ['login', 'Entrar'],
          ['register', 'Criar conta'],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => onChange(value)}
          className={cn(
            'relative z-10 rounded-md py-1.5 text-[13px] font-medium transition-colors',
            mode === value
              ? 'text-brand-600'
              : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Banner({ tone, children }: { tone: 'notice' | 'error'; children: ReactNode }) {
  return (
    <p
      className={cn(
        'animate-rise rounded-md px-3 py-2 text-[12.5px]',
        tone === 'error' ? 'bg-removed/10 text-removed' : 'bg-brand-50 text-brand-700',
      )}
    >
      {children}
    </p>
  )
}

/**
 * Campo com rótulo flutuante. O foco e o valor decidem a posição em JS, não
 * via `:placeholder-shown`/`:focus` do CSS puro — com dois seletores de peer
 * de mesma especificidade, qual vence quando os dois casam ao mesmo tempo
 * (campo vazio e focado) depende da ordem de geração do Tailwind, não é
 * garantido. Rastrear em estado remove a ambiguidade.
 *
 * `value.length > 0` sozinho não basta: em alguns navegadores o autofill de
 * senha salva escreve direto no elemento nativo sem confiabilidade total no
 * evento `input` que o React escuta — o `value` controlado ficaria
 * defasado do que a tela mostra, e o label preso no centro por cima do
 * texto mascarado. `onAutofillStart`, em `index.css`, aplica uma animação
 * sem efeito visual só a `:-webkit-autofill`; o `animationstart` dela é o
 * sinal de que o navegador encheu o campo, e o handler abaixo lê o valor
 * atual do elemento e o empurra pro estado controlado — sincroniza em vez
 * de só marcar uma bandeira, então um re-render não sobrescreve o
 * autofill de volta para vazio.
 */
function FloatingField({
  id,
  label,
  value,
  onChange,
  rightSlot,
  ...props
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  rightSlot?: ReactNode
} & Pick<InputHTMLAttributes<HTMLInputElement>, 'type' | 'autoComplete' | 'autoFocus'>) {
  const [focused, setFocused] = useState(false)
  const floated = focused || value.length > 0

  return (
    <div className="relative">
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onAnimationStart={(event) => {
          if (event.animationName === 'onAutofillStart') onChange(event.currentTarget.value)
        }}
        {...props}
        className={cn(
          // h-14 (56px) e rounded-md casam com a altura e o raio do botão
          // "Entrar" — campo e botão leem como a mesma família de controle.
          // text-base (16px) evita o zoom automático de foco no Safari iOS.
          'peer h-14 w-full rounded-md border bg-[var(--surface)] px-4 text-base text-[var(--fg)]',
          'transition-[border-color,box-shadow,padding] duration-200',
          // Flutuado, o topo abre pt-6 (24px) para o label caber sem tocar o
          // texto digitado; parado, o campo usa os 12px/12px do pedido —
          // o padding-bottom nunca muda, só o de cima, que é quem precisa do
          // espaço extra.
          floated ? 'pt-6 pb-2' : 'py-3',
          focused
            ? 'border-brand-500 shadow-[0_0_0_3px_var(--color-brand-100)]'
            : 'border-[var(--hairline)]',
          rightSlot && 'pr-10',
        )}
      />
      <label
        htmlFor={id}
        className={cn(
          'pointer-events-none absolute left-4 transition-all duration-200 ease-out',
          floated
            ? cn('top-2 text-xs font-medium', focused ? 'text-brand-600' : 'text-[var(--fg-muted)]')
            : 'top-1/2 -translate-y-1/2 text-base text-[var(--fg-subtle)]',
        )}
      >
        {label}
      </label>
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">{rightSlot}</div>
      )}
    </div>
  )
}
