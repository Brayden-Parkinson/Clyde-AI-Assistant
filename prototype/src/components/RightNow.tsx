import { useState } from 'react'
import { theme } from '../theme'
import { RankedItem } from '../types'
import { Avatar } from './Avatar'
import { SectionHeader } from './SectionHeader'

interface Props {
  items: RankedItem[]
  onMarkDone: (id: string) => void
}

const heatAccent: Record<string, string> = {
  hot: theme.red,
  warm: theme.amber,
  neutral: 'transparent',
}

export function RightNow({ items, onMarkDone }: Props) {
  const [dismissing, setDismissing] = useState<Set<string>>(new Set())

  if (items.length === 0) {
    return (
      <SectionHeader title="Right now" color={theme.textSecondary}>
        <div style={{
          background: theme.cardBg,
          border: `1px solid ${theme.cardBorder}`,
          borderRadius: theme.radius,
          padding: '32px 24px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, marginBottom: 8 }}>All clear</div>
          <div style={{ color: theme.textMuted, fontSize: 13 }}>
            Nothing pressing right now. You're caught up.
          </div>
        </div>
      </SectionHeader>
    )
  }

  const handleDone = (id: string) => {
    setDismissing(prev => new Set(prev).add(id))
    setTimeout(() => onMarkDone(id), 300)
  }

  return (
    <SectionHeader title="Right now" count={items.length} color={theme.textSecondary}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((item, i) => (
          <div
            key={item.commitment.id}
            style={{
              background: theme.cardBg,
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: theme.radius,
              borderLeft: `3px solid ${heatAccent[item.heat]}`,
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 12,
              opacity: dismissing.has(item.commitment.id) ? 0 : 1,
              transform: dismissing.has(item.commitment.id) ? 'translateX(20px)' : 'none',
              transition: `opacity 300ms ease, transform 300ms ease`,
              animation: `fadeSlideIn 200ms ease ${i * 60}ms both`,
            }}
          >
            <Avatar initials={item.person.initials} tier={item.person.tier} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 14,
                fontWeight: 500,
                color: theme.text,
                marginBottom: 4,
                lineHeight: 1.4,
              }}>
                {item.commitment.title}
              </div>
              <div style={{
                fontSize: 12,
                color: item.heat === 'hot' ? theme.red : item.heat === 'warm' ? theme.amber : theme.textMuted,
                marginBottom: 6,
                fontWeight: item.heat !== 'neutral' ? 500 : 400,
              }}>
                {item.whyNow}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{
                  fontSize: 11,
                  color: theme.textMuted,
                  background: theme.surface,
                  padding: '2px 8px',
                  borderRadius: 10,
                }}>
                  {item.person.name}
                </span>
                {item.commitment.tags.map(tag => (
                  <span key={tag} style={{
                    fontSize: 11,
                    color: theme.textDim,
                    background: theme.surface,
                    padding: '2px 8px',
                    borderRadius: 10,
                  }}>
                    {tag}
                  </span>
                ))}
                <span style={{
                  fontSize: 11,
                  color: theme.textDim,
                }}>
                  via {item.commitment.source === 'granola' ? 'Granola' : 'Slack'} · {item.commitment.sourceContext}
                </span>
              </div>
            </div>
            <button
              onClick={() => handleDone(item.commitment.id)}
              title="Mark done"
              style={{
                background: 'none',
                border: `1px solid ${theme.cardBorder}`,
                borderRadius: theme.radiusXs,
                color: theme.textMuted,
                cursor: 'pointer',
                fontSize: 11,
                padding: '4px 10px',
                flexShrink: 0,
                transition: theme.transition,
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = theme.green
                e.currentTarget.style.color = theme.green
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = theme.cardBorder
                e.currentTarget.style.color = theme.textMuted
              }}
            >
              Done
            </button>
          </div>
        ))}
      </div>
    </SectionHeader>
  )
}
