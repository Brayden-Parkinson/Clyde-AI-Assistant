import { theme } from '../theme'

interface Props {
  remainingCount: number
}

export function BacklogFooter({ remainingCount }: Props) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '20px 0 8px',
      borderTop: `1px solid ${theme.cardBorder}`,
      marginTop: 8,
    }}>
      <span style={{
        fontSize: 13,
        color: theme.textDim,
      }}>
        {remainingCount} remaining items
        <span style={{ margin: '0 8px', opacity: 0.3 }}>·</span>
        <span style={{
          color: theme.textMuted,
          cursor: 'pointer',
          textDecoration: 'none',
        }}
          onMouseEnter={e => e.currentTarget.style.color = theme.text}
          onMouseLeave={e => e.currentTarget.style.color = theme.textMuted}
        >
          View full board
        </span>
      </span>
    </div>
  )
}
