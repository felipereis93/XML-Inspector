import { useEffect, useState } from 'react'

/**
 * Atrasa um valor. Usado na busca: cada tecla varre o documento inteiro, e sem
 * o atraso a digitação fica presa atrás da varredura.
 */
export function useDebounced<T>(value: T, delay = 180): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
