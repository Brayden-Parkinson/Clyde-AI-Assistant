import { theme } from '../theme'
import { Commitment, Person } from '../types'
import { Avatar } from './Avatar'
import { SectionHeader } from './SectionHeader'

const signalLabels: Record<string, string> = {
  slack_confirmation: 'Slack',
  jira_done: 'Jira',
  pr_merged: 'PR merged',
}

interface Props {
  items: Commitment[]
  people: Map<string, Person>
}

export function AutoResolved({ items, people }: Props) {
  if (items.length === 0) return null

  return (
    <SectionHeader title="Auto-resolved" count={items.length} color={theme.green} collapsible>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => {
          const person = people.get(item.personId)!
          return (
            <div
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: theme.cardBg,
                border: `1px solid ${theme.cardBorder}`,
                borderRadius: theme.radiusSm,
                animation: `fadeSlideIn 200ms ease ${i * 40}ms both`,
              }}
            >
              <Avatar initials={person.initials} tier={person.tier} size={22} />
              <span style={{
                flex: 1,
                fontSize: 13,
                color: theme.textMuted,
                textDecoration: 'line-through',
                textDecorationColor: 'rgba(255,255,255,0.15)',
              }}>
                {item.title}
              </span>
              <span style={{
                fontSize: 11,
                color: theme.green,
                background: theme.greenMuted,
                padding: '2px 8px',
                borderRadius: 10,
                flexShrink: 0,
                fontWeight: 500,
              }}>
                {signalLabels[item.resolutionSignal!] || 'Resolved'}
              </span>
            </div>
          )
        })}
      </div>
      <div style={{
        fontSize: 12,
        color: theme.textDim,
        marginTop: 8,
        paddingLeft: 4,
      }}>
        {items.map(item => (
          <div key={item.id} style={{ marginBottom: 2 }}>
            {item.resolutionDetail}
          </div>
        ))}
      </div>
    </SectionHeader>
  )
}
