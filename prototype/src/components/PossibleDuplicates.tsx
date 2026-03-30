import { useState } from 'react'
import { theme } from '../theme'
import { Person } from '../types'
import { DuplicateMatch } from '../utils/dedup'
import { Avatar } from './Avatar'
import { SectionHeader } from './SectionHeader'

interface Props {
  duplicates: DuplicateMatch[]
  people: Map<string, Person>
  onMerge: (groupId: string) => void
  onIgnore: (groupId: string) => void
}

export function PossibleDuplicates({ duplicates, people, onMerge, onIgnore }: Props) {
  const [dismissing, setDismissing] = useState<Set<string>>(new Set())

  if (duplicates.length === 0) return null

  const handleAction = (groupId: string, action: 'merge' | 'ignore') => {
    setDismissing(prev => new Set(prev).add(groupId))
    setTimeout(() => {
      if (action === 'merge') onMerge(groupId)
      else onIgnore(groupId)
    }, 300)
  }

  return (
    <SectionHeader title="Possible duplicates" count={duplicates.length} color={theme.amber} collapsible>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {duplicates.map((dup, i) => (
          <div
            key={dup.group.id}
            style={{
              background: theme.cardBg,
              border: `1px solid ${theme.cardBorder}`,
              borderRadius: theme.radius,
              padding: '14px 16px',
              opacity: dismissing.has(dup.group.id) ? 0 : 1,
              transform: dismissing.has(dup.group.id) ? 'translateX(-20px)' : 'none',
              transition: 'opacity 300ms ease, transform 300ms ease',
              animation: `fadeSlideIn 200ms ease ${i * 60}ms both`,
            }}
          >
            <div style={{
              fontSize: 12,
              color: theme.amber,
              marginBottom: 10,
              fontWeight: 500,
            }}>
              {dup.group.reason}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {dup.commitments.map(c => {
                const person = people.get(c.personId)!
                return (
                  <div key={c.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    color: theme.textSecondary,
                  }}>
                    <Avatar initials={person.initials} tier={person.tier} size={20} />
                    <span style={{ flex: 1 }}>{c.title}</span>
                    <span style={{ fontSize: 11, color: theme.textDim }}>
                      {c.source === 'granola' ? 'Granola' : 'Slack'}
                    </span>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleAction(dup.group.id, 'merge')}
                style={{
                  background: theme.purpleMuted,
                  border: 'none',
                  borderRadius: theme.radiusXs,
                  color: theme.purple,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 500,
                  padding: '5px 14px',
                  fontFamily: 'inherit',
                  transition: theme.transition,
                }}
              >
                Merge
              </button>
              <button
                onClick={() => handleAction(dup.group.id, 'ignore')}
                style={{
                  background: 'none',
                  border: `1px solid ${theme.cardBorder}`,
                  borderRadius: theme.radiusXs,
                  color: theme.textMuted,
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '5px 14px',
                  fontFamily: 'inherit',
                  transition: theme.transition,
                }}
              >
                Ignore
              </button>
            </div>
          </div>
        ))}
      </div>
    </SectionHeader>
  )
}
