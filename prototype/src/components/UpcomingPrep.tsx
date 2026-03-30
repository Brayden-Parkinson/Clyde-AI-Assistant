import { theme } from '../theme'
import { Commitment, CalendarEvent, Person } from '../types'
import { Avatar } from './Avatar'
import { SectionHeader } from './SectionHeader'

interface Props {
  calendar: CalendarEvent[]
  commitments: Commitment[]
  people: Map<string, Person>
}

const MS_PER_DAY = 86_400_000

export function UpcomingPrep({ calendar, commitments, people }: Props) {
  const now = Date.now()

  // Only 1:1s and syncs happening today or in the future
  const upcoming = calendar
    .filter(e => (e.type === 'one_on_one' || e.type === 'sync') && e.startTime.getTime() > now - 2 * 60 * 60 * 1000)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())

  if (upcoming.length === 0) return null

  return (
    <SectionHeader title="Upcoming prep" count={upcoming.length} color={theme.purple}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {upcoming.map((event, i) => {
          const attendees = event.attendeeIds.map(id => people.get(id)).filter(Boolean) as Person[]
          const openItems = commitments.filter(
            c => event.attendeeIds.includes(c.personId) &&
              (c.status === 'open' || c.status === 'in_progress')
          )
          const overdueItems = openItems.filter(
            c => (now - c.createdAt.getTime()) / MS_PER_DAY > 5
          )
          const displayItems = openItems.slice(0, 4)
          const moreCount = openItems.length - displayItems.length

          const isPast = event.startTime.getTime() < now
          const timeStr = event.startTime.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          })

          return (
            <div
              key={event.id}
              style={{
                background: theme.cardBg,
                border: `1px solid ${theme.cardBorder}`,
                borderLeft: `3px solid ${theme.purple}`,
                borderRadius: theme.radius,
                padding: '14px 16px',
                animation: `fadeSlideIn 200ms ease ${i * 60}ms both`,
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 10,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {attendees.map(a => (
                    <Avatar key={a.id} initials={a.initials} tier={a.tier} size={24} />
                  ))}
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{event.title}</span>
                </div>
                <span style={{
                  fontSize: 12,
                  color: isPast ? theme.textDim : theme.purple,
                  fontWeight: 500,
                }}>
                  {isPast ? 'Earlier today' : timeStr}
                </span>
              </div>

              {openItems.length === 0 ? (
                <div style={{ fontSize: 12, color: theme.textMuted, paddingLeft: 2 }}>
                  No open items — you're all set for this one.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {displayItems.map(item => {
                    const isOverdue = overdueItems.includes(item)
                    return (
                      <div key={item.id} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 13,
                        color: isOverdue ? theme.amber : theme.textSecondary,
                        paddingLeft: 2,
                      }}>
                        <span style={{
                          width: 4,
                          height: 4,
                          borderRadius: '50%',
                          background: isOverdue ? theme.amber : theme.textDim,
                          flexShrink: 0,
                        }} />
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.title}
                        </span>
                        {isOverdue && (
                          <span style={{
                            fontSize: 10,
                            color: theme.amber,
                            background: theme.amberMuted,
                            padding: '1px 6px',
                            borderRadius: 8,
                            flexShrink: 0,
                            fontWeight: 500,
                          }}>
                            overdue
                          </span>
                        )}
                      </div>
                    )
                  })}
                  {moreCount > 0 && (
                    <div style={{ fontSize: 12, color: theme.textDim, paddingLeft: 14 }}>
                      +{moreCount} more
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </SectionHeader>
  )
}
