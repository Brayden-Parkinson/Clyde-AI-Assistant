import { useState, useEffect, useCallback } from 'react'
import { theme } from '../theme'
const PLACEHOLDERS = [
  'What did I promise Sarah?',
  'Anything overdue?',
  'What\'s blocking the platform team?',
  'Show me items for Marcus',
  'What vendor things are open?',
]

interface Props {
  onFilter: (query: string) => void
}

export function CommandBar({ onFilter }: Props) {
  const [query, setQuery] = useState('')
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => {
      setPlaceholderIdx(i => (i + 1) % PLACEHOLDERS.length)
    }, 4000)
    return () => clearInterval(interval)
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    onFilter(e.target.value)
  }, [onFilter])

  const handleClear = useCallback(() => {
    setQuery('')
    onFilter('')
  }, [onFilter])

  return (
    <div style={{
      position: 'relative',
      marginBottom: 28,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: theme.surface,
        border: `1px solid ${focused ? theme.cardBorderHover : theme.cardBorder}`,
        borderRadius: theme.radius,
        padding: '10px 16px',
        transition: theme.transition,
      }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0, opacity: 0.4 }}>
          <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={`Ask Clyde... "${PLACEHOLDERS[placeholderIdx]}"`}
          style={{
            flex: 1,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: theme.text,
            fontSize: 14,
            fontFamily: 'inherit',
          }}
        />
        {query && (
          <button
            onClick={handleClear}
            style={{
              background: 'none',
              border: 'none',
              color: theme.textMuted,
              cursor: 'pointer',
              fontSize: 12,
              padding: '2px 6px',
              borderRadius: theme.radiusXs,
            }}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
