import type { ButtonHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'ghost' | 'solid' | 'outline'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-[13px]',
        variant === 'ghost' &&
          'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-brand-600',
        variant === 'outline' &&
          'border border-[var(--hairline)] bg-[var(--surface)] text-[var(--fg-muted)] hover:border-brand-500 hover:bg-[var(--hover)] hover:text-brand-600',
        variant === 'solid' && 'bg-brand-500 text-white hover:bg-brand-600',
        className,
      )}
      {...props}
    />
  )
}

export function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-[var(--fg-muted)]',
        'transition-colors hover:bg-[var(--hover)] hover:text-brand-600',
        'disabled:pointer-events-none disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2',
        'text-[13px] text-[var(--fg)] transition-colors hover:border-brand-500 focus:border-brand-500',
        className,
      )}
      {...props}
    />
  )
}

interface SegmentedOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  badge?: ReactNode
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex gap-0.5 rounded-lg border border-[var(--hairline)] bg-[var(--surface-sunken)] p-0.5',
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[13px] font-medium transition-colors',
              active
                ? 'bg-brand-500 text-white'
                : 'text-[var(--fg-muted)] hover:bg-[var(--hover)] hover:text-brand-600',
            )}
          >
            {option.icon}
            {option.label}
            {option.badge}
          </button>
        )
      })}
    </div>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode
  title: string
  hint: string
  action?: ReactNode
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-[var(--fg-subtle)]">{icon}</div>
      <p className="font-display text-[15px] font-semibold text-[var(--fg)]">
        {title}
      </p>
      <p className="max-w-xs text-[13px] leading-relaxed text-[var(--fg-muted)]">
        {hint}
      </p>
      {action}
    </div>
  )
}
