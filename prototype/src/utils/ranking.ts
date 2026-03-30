import { Commitment, Person, CalendarEvent, RankedItem, HeatLevel } from '../types'

const TIER_WEIGHT: Record<string, number> = {
  boss: 50,
  direct: 30,
  peer: 15,
  other: 5,
}

const MS_PER_DAY = 86_400_000

export function rankCommitments(
  commitments: Commitment[],
  people: Map<string, Person>,
  calendar: CalendarEvent[],
  maxItems = 5,
): RankedItem[] {
  const now = Date.now()
  const openItems = commitments.filter(c => c.status === 'open' || c.status === 'in_progress')

  const scored = openItems.map(commitment => {
    const person = people.get(commitment.personId)!
    let score = 0
    const reasons: string[] = []

    // 1. Tier weight
    score += TIER_WEIGHT[person.tier] ?? 0

    // 2. Upcoming meeting boost
    const upcomingMeeting = calendar.find(
      e =>
        e.attendeeIds.includes(commitment.personId) &&
        e.startTime.getTime() > now &&
        e.startTime.getTime() - now < 6 * 60 * 60 * 1000, // within 6 hours
    )
    if (upcomingMeeting) {
      const hoursUntil = (upcomingMeeting.startTime.getTime() - now) / (60 * 60 * 1000)
      const meetingBoost = Math.max(10, 40 - hoursUntil * 8)
      score += meetingBoost
      const timeStr = upcomingMeeting.startTime.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
      reasons.push(`You have a ${upcomingMeeting.type === 'one_on_one' ? '1:1' : 'sync'} with ${person.name.split(' ')[0]} at ${timeStr}`)
    }

    // 3. Age factor
    const ageDays = (now - commitment.createdAt.getTime()) / MS_PER_DAY
    if (ageDays > 7) {
      score += 20
      reasons.push(`Open for ${Math.round(ageDays)} days`)
    } else if (ageDays > 3) {
      score += 10
    }

    // 4. Staleness (no recent activity)
    if (commitment.lastActivity) {
      const staleDays = (now - commitment.lastActivity.getTime()) / MS_PER_DAY
      if (staleDays > 5) {
        score += 15
        if (!reasons.some(r => r.includes('days'))) {
          reasons.push(`No activity for ${Math.round(staleDays)} days`)
        }
      }
    }

    // 5. Follow-up signals
    if (commitment.hasFollowUp) {
      score += 25
      reasons.push(`${person.name.split(' ')[0]} followed up`)
    }

    // 6. Urgency signals
    if (commitment.urgencySignals.length > 0) {
      score += 15 * commitment.urgencySignals.length
      if (reasons.length === 0) {
        reasons.push(commitment.urgencySignals[0])
      }
    }

    // Pick the best "why now" reason
    const whyNow = reasons[0] || (person.tier === 'boss'
      ? `Your manager is waiting on this`
      : `Owed to ${person.name.split(' ')[0]}`)

    // Heat level
    let heat: HeatLevel = 'neutral'
    if (score >= 70) heat = 'hot'
    else if (score >= 40) heat = 'warm'

    return { commitment, person, score, whyNow, heat, upcomingMeeting } as RankedItem
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, maxItems)
}
