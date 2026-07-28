import { memo } from 'react'
import { cn } from '../../lib/cn'

/**
 * Elemento assinatura: a régua de profundidade.
 *
 * Cada nível de aninhamento vira uma guia de 1px colorida por uma rampa
 * violeta -> ciano que cicla a cada 6 níveis. O efeito é que a forma do
 * documento fica legível de canto de olho — dá para ver onde um bloco começa e
 * termina sem ler um único nome de tag. É por isso que a régua é desenhada
 * inteira em vez de usar cotovelos: o que interessa é o ritmo vertical, não a
 * ligação pai-filho, que o recuo já comunica.
 */
export const DepthGuides = memo(function DepthGuides({
  depth,
  className,
}: {
  depth: number
  className?: string
}) {
  if (depth === 0) return null

  return (
    <span className={cn('flex self-stretch', className)} aria-hidden="true">
      {Array.from({ length: depth }, (_, level) => (
        <span
          key={level}
          className="depth-guide"
          style={{ color: `var(--depth-${level % 6})` }}
        />
      ))}
    </span>
  )
})
