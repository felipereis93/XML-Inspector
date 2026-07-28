import { memo } from 'react'
import { segment } from '../../lib/xml/search'

interface Props {
  text: string
  query: string
  className?: string
}

/** Aplica o marca-texto da busca sobre um trecho de texto. */
export const Highlight = memo(function Highlight({
  text,
  query,
  className,
}: Props) {
  const parts = segment(text, query)
  if (parts.length === 1 && !parts[0].hit) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.hit ? (
          <mark key={i} className="hl bg-transparent text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  )
})
