export type Tier = 'boss' | 'direct' | 'peer' | 'other'
export type HeatLevel = 'hot' | 'warm' | 'neutral'
export type CommitmentStatus = 'open' | 'in_progress' | 'waiting' | 'done' | 'auto_resolved'
export type ResolutionSignal = 'slack_confirmation' | 'jira_done' | 'pr_merged'

export interface Person {
  id: string
  name: string
  initials: string
  tier: Tier
  role: string
}

export interface Commitment {
  id: string
  title: string
  personId: string
  status: CommitmentStatus
  createdAt: Date
  lastActivity: Date | null
  tags: string[]
  source: 'slack' | 'granola' | 'manual'
  sourceContext?: string
  hasFollowUp: boolean
  urgencySignals: string[]
  resolutionSignal?: ResolutionSignal
  resolutionDetail?: string
  resolvedAt?: Date
  duplicateGroupId?: string
}

export interface CalendarEvent {
  id: string
  title: string
  startTime: Date
  endTime: Date
  attendeeIds: string[]
  type: 'one_on_one' | 'sync' | 'standup' | 'other'
}

export interface DuplicateGroup {
  id: string
  commitmentIds: string[]
  reason: string
}

export interface RankedItem {
  commitment: Commitment
  person: Person
  score: number
  whyNow: string
  heat: HeatLevel
  upcomingMeeting?: CalendarEvent
}
