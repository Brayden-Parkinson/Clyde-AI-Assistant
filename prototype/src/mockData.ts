import { Person, Commitment, CalendarEvent, DuplicateGroup } from './types'

const now = new Date()
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000)
const daysAgo = (d: number) => new Date(today.getTime() - d * 24 * 60 * 60 * 1000)

// ── People ──────────────────────────────────────────────────────────

export const people: Person[] = [
  { id: 'marcus', name: 'Marcus Chen', initials: 'MC', tier: 'boss', role: 'VP Engineering' },
  { id: 'sarah', name: 'Sarah Kim', initials: 'SK', tier: 'direct', role: 'EM, Growth' },
  { id: 'james', name: 'James Wright', initials: 'JW', tier: 'direct', role: 'EM, Platform' },
  { id: 'priya', name: 'Priya Patel', initials: 'PP', tier: 'direct', role: 'Staff Eng' },
  { id: 'alex', name: 'Alex Torres', initials: 'AT', tier: 'direct', role: 'EM, Mobile' },
  { id: 'david', name: 'David Park', initials: 'DP', tier: 'direct', role: 'Senior Eng' },
  { id: 'lisa', name: 'Lisa Nguyen', initials: 'LN', tier: 'peer', role: 'EM, Platform' },
  { id: 'rachel', name: 'Rachel Foster', initials: 'RF', tier: 'peer', role: 'Product Lead' },
  { id: 'mike', name: 'Mike Sullivan', initials: 'MS', tier: 'other', role: 'Skip-level' },
  { id: 'nina', name: 'Nina Gupta', initials: 'NG', tier: 'other', role: 'Vendor (Datadog)' },
]

export const peopleMap = new Map(people.map(p => [p.id, p]))

// ── Calendar ────────────────────────────────────────────────────────

export const calendar: CalendarEvent[] = [
  {
    id: 'cal-1',
    title: 'Team Standup',
    startTime: hoursFromNow(-2),
    endTime: hoursFromNow(-1.75),
    attendeeIds: ['sarah', 'james', 'priya', 'alex', 'david'],
    type: 'standup',
  },
  {
    id: 'cal-2',
    title: '1:1 Marcus Chen',
    startTime: hoursFromNow(1),
    endTime: hoursFromNow(1.5),
    attendeeIds: ['marcus'],
    type: 'one_on_one',
  },
  {
    id: 'cal-3',
    title: '1:1 Sarah Kim',
    startTime: hoursFromNow(3),
    endTime: hoursFromNow(3.5),
    attendeeIds: ['sarah'],
    type: 'one_on_one',
  },
]

// ── Commitments ─────────────────────────────────────────────────────

export const commitments: Commitment[] = [
  // ── Marcus (boss) ──
  {
    id: 'c-1', title: 'Send updated headcount plan with Q3 projections', personId: 'marcus',
    status: 'open', createdAt: daysAgo(3), lastActivity: daysAgo(1), tags: ['People'],
    source: 'slack', sourceContext: '#leadership-sync', hasFollowUp: true,
    urgencySignals: ['Marcus asked for an update yesterday'],
  },
  {
    id: 'c-2', title: 'Draft eng hiring priorities doc for board deck', personId: 'marcus',
    status: 'open', createdAt: daysAgo(7), lastActivity: daysAgo(5), tags: ['People', 'Process'],
    source: 'granola', sourceContext: '1:1 with Marcus', hasFollowUp: false,
    urgencySignals: ['Board meeting next Tuesday'],
  },
  {
    id: 'c-3', title: 'Review platform reliability OKRs', personId: 'marcus',
    status: 'open', createdAt: daysAgo(2), lastActivity: null, tags: ['Process'],
    source: 'slack', sourceContext: '#okrs', hasFollowUp: false, urgencySignals: [],
  },

  // ── Sarah (direct) ──
  {
    id: 'c-4', title: 'Approve PTO request for Sarah\'s team offsite', personId: 'sarah',
    status: 'open', createdAt: daysAgo(1), lastActivity: null, tags: ['People'],
    source: 'slack', sourceContext: 'DM with Sarah', hasFollowUp: false,
    urgencySignals: ['Needs approval by Friday for booking'],
  },
  {
    id: 'c-5', title: 'Review and sign off on Growth team roadmap', personId: 'sarah',
    status: 'open', createdAt: daysAgo(5), lastActivity: daysAgo(3), tags: ['Process'],
    source: 'granola', sourceContext: '1:1 with Sarah', hasFollowUp: true,
    urgencySignals: ['Sarah pinged again in Slack'],
  },
  {
    id: 'c-6', title: 'Connect Sarah with recruiting for senior FE role', personId: 'sarah',
    status: 'auto_resolved', createdAt: daysAgo(6), lastActivity: daysAgo(1), tags: ['People'],
    source: 'slack', sourceContext: 'DM with Sarah', hasFollowUp: false, urgencySignals: [],
    resolutionSignal: 'slack_confirmation', resolutionDetail: 'Sarah said "all set, recruiter reached out" in DM',
    resolvedAt: daysAgo(1),
  },
  {
    id: 'c-7', title: 'Share feedback template for mid-cycle reviews', personId: 'sarah',
    status: 'open', createdAt: daysAgo(10), lastActivity: daysAgo(8), tags: ['People', 'Process'],
    source: 'granola', sourceContext: '1:1 with Sarah', hasFollowUp: false,
    urgencySignals: ['10 days old, no activity'],
  },

  // ── James (direct) ──
  {
    id: 'c-8', title: 'Escalate infra cost overrun to finance', personId: 'james',
    status: 'open', createdAt: daysAgo(2), lastActivity: daysAgo(1), tags: ['Tooling', 'Process'],
    source: 'slack', sourceContext: '#platform-alerts', hasFollowUp: true,
    urgencySignals: ['Costs up 40% this month'],
  },
  {
    id: 'c-9', title: 'Approve RFC for new caching layer', personId: 'james',
    status: 'open', createdAt: daysAgo(4), lastActivity: null, tags: ['Tooling'],
    source: 'slack', sourceContext: '#platform-rfcs', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-10', title: 'Set up 1:1 with James\'s new tech lead', personId: 'james',
    status: 'auto_resolved', createdAt: daysAgo(5), lastActivity: daysAgo(2), tags: ['People'],
    source: 'granola', sourceContext: '1:1 with James', hasFollowUp: false, urgencySignals: [],
    resolutionSignal: 'slack_confirmation', resolutionDetail: 'James confirmed "meeting is on the calendar for Thursday"',
    resolvedAt: daysAgo(2),
  },

  // ── Priya (direct) ──
  {
    id: 'c-11', title: 'Review Priya\'s architecture proposal for event system', personId: 'priya',
    status: 'open', createdAt: daysAgo(3), lastActivity: null, tags: ['Tooling'],
    source: 'slack', sourceContext: '#arch-reviews', hasFollowUp: false,
    urgencySignals: ['Blocking sprint planning next week'],
  },
  {
    id: 'c-12', title: 'Nominate Priya for staff eng panel at All Hands', personId: 'priya',
    status: 'open', createdAt: daysAgo(6), lastActivity: null, tags: ['People'],
    source: 'granola', sourceContext: '1:1 with Priya', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-13', title: 'Get Priya access to production metrics dashboard', personId: 'priya',
    status: 'auto_resolved', createdAt: daysAgo(4), lastActivity: daysAgo(1), tags: ['Access & Onboarding'],
    source: 'slack', sourceContext: 'DM with Priya', hasFollowUp: false, urgencySignals: [],
    resolutionSignal: 'jira_done', resolutionDetail: 'INFRA-2341 moved to Done — access provisioned',
    resolvedAt: daysAgo(1),
  },

  // ── Alex (direct) ──
  {
    id: 'c-14', title: 'Decide on mobile CI migration timeline', personId: 'alex',
    status: 'open', createdAt: daysAgo(5), lastActivity: daysAgo(3), tags: ['Tooling', 'Process'],
    source: 'granola', sourceContext: '1:1 with Alex', hasFollowUp: false,
    urgencySignals: ['Current CI contract renews in 3 weeks'],
  },
  {
    id: 'c-15', title: 'Review Alex\'s skip-level feedback summary', personId: 'alex',
    status: 'open', createdAt: daysAgo(2), lastActivity: null, tags: ['People'],
    source: 'slack', sourceContext: 'DM with Alex', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-16', title: 'Approve contractor extension for mobile QA', personId: 'alex',
    status: 'open', createdAt: daysAgo(1), lastActivity: null, tags: ['People', 'Vendor'],
    source: 'slack', sourceContext: '#mobile-team', hasFollowUp: false,
    urgencySignals: ['Contract expires end of week'],
  },

  // ── David (direct) ──
  {
    id: 'c-17', title: 'Pair with David on perf investigation for search API', personId: 'david',
    status: 'in_progress', createdAt: daysAgo(2), lastActivity: daysAgo(0), tags: ['Tooling'],
    source: 'slack', sourceContext: '#eng-perf', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-18', title: 'Write David\'s promo packet intro paragraph', personId: 'david',
    status: 'open', createdAt: daysAgo(14), lastActivity: daysAgo(10), tags: ['People'],
    source: 'granola', sourceContext: '1:1 with David', hasFollowUp: false,
    urgencySignals: ['Promo committee meets in 2 weeks', '14 days old'],
  },

  // ── Lisa (peer) ──
  {
    id: 'c-19', title: 'Share eng stats dashboard access with Lisa\'s team', personId: 'lisa',
    status: 'open', createdAt: daysAgo(3), lastActivity: null, tags: ['Tooling', 'Access & Onboarding'],
    source: 'slack', sourceContext: '#platform-leads', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-20', title: 'Align on shared on-call rotation proposal', personId: 'lisa',
    status: 'open', createdAt: daysAgo(7), lastActivity: daysAgo(4), tags: ['Process'],
    source: 'granola', sourceContext: 'Platform leads sync', hasFollowUp: false,
    urgencySignals: ['On-call schedule publishes next Monday'],
  },

  // ── Rachel (peer) ──
  {
    id: 'c-21', title: 'Send Rachel eng capacity breakdown for Q3 planning', personId: 'rachel',
    status: 'open', createdAt: daysAgo(4), lastActivity: daysAgo(2), tags: ['Process'],
    source: 'slack', sourceContext: '#product-eng-sync', hasFollowUp: true,
    urgencySignals: ['Rachel followed up in thread'],
  },
  {
    id: 'c-22', title: 'Review feature flag cleanup plan with Rachel', personId: 'rachel',
    status: 'open', createdAt: daysAgo(6), lastActivity: null, tags: ['Tooling'],
    source: 'granola', sourceContext: 'Product-Eng sync', hasFollowUp: false, urgencySignals: [],
  },

  // ── Mike (skip-level) ──
  {
    id: 'c-23', title: 'Get Mike set up with design system Figma access', personId: 'mike',
    status: 'open', createdAt: daysAgo(1), lastActivity: null, tags: ['Access & Onboarding'],
    source: 'slack', sourceContext: '#onboarding', hasFollowUp: false, urgencySignals: [],
  },

  // ── Nina (vendor) ──
  {
    id: 'c-24', title: 'Send Datadog contract renewal decision to Nina', personId: 'nina',
    status: 'open', createdAt: daysAgo(8), lastActivity: daysAgo(5), tags: ['Vendor', 'Tooling'],
    source: 'slack', sourceContext: 'DM with Nina', hasFollowUp: true,
    urgencySignals: ['Nina sent a reminder email', 'Contract expires in 10 days'],
  },
  {
    id: 'c-25', title: 'Schedule Datadog optimization workshop', personId: 'nina',
    status: 'open', createdAt: daysAgo(3), lastActivity: null, tags: ['Vendor', 'Tooling'],
    source: 'slack', sourceContext: 'DM with Nina', hasFollowUp: false, urgencySignals: [],
  },

  // ── Duplicate group 1: headcount/hiring (Marcus + Sarah threads) ──
  {
    id: 'c-26', title: 'Finalize headcount numbers for Q3', personId: 'marcus',
    status: 'open', createdAt: daysAgo(4), lastActivity: null, tags: ['People'],
    source: 'slack', sourceContext: '#leadership-sync', hasFollowUp: false, urgencySignals: [],
    duplicateGroupId: 'dup-1',
  },
  {
    id: 'c-27', title: 'Share headcount plan with Growth hiring needs', personId: 'sarah',
    status: 'open', createdAt: daysAgo(3), lastActivity: null, tags: ['People'],
    source: 'granola', sourceContext: '1:1 with Sarah', hasFollowUp: false, urgencySignals: [],
    duplicateGroupId: 'dup-1',
  },

  // ── Duplicate group 2: on-call (Lisa + James) ──
  {
    id: 'c-28', title: 'Draft shared on-call proposal for platform teams', personId: 'james',
    status: 'open', createdAt: daysAgo(6), lastActivity: null, tags: ['Process'],
    source: 'slack', sourceContext: '#platform-leads', hasFollowUp: false, urgencySignals: [],
    duplicateGroupId: 'dup-2',
  },

  // ── Duplicate group 3: Datadog contract (duplicate extraction) ──
  {
    id: 'c-29', title: 'Respond to Datadog renewal proposal', personId: 'nina',
    status: 'open', createdAt: daysAgo(7), lastActivity: null, tags: ['Vendor'],
    source: 'granola', sourceContext: 'Vendor review meeting', hasFollowUp: false, urgencySignals: [],
    duplicateGroupId: 'dup-3',
  },

  // ── More filler commitments for realistic volume ──
  {
    id: 'c-30', title: 'Follow up on eng survey results action items', personId: 'marcus',
    status: 'open', createdAt: daysAgo(12), lastActivity: daysAgo(8), tags: ['People', 'Process'],
    source: 'granola', sourceContext: '1:1 with Marcus', hasFollowUp: false,
    urgencySignals: ['12 days old'],
  },
  {
    id: 'c-31', title: 'Order new monitors for Sarah\'s team', personId: 'sarah',
    status: 'open', createdAt: daysAgo(4), lastActivity: null, tags: ['People'],
    source: 'slack', sourceContext: 'DM with Sarah', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-32', title: 'Provide input on Platform team charter revision', personId: 'james',
    status: 'open', createdAt: daysAgo(9), lastActivity: daysAgo(6), tags: ['Process'],
    source: 'slack', sourceContext: '#platform-leads', hasFollowUp: false,
    urgencySignals: ['Charter review meeting next week'],
  },
  {
    id: 'c-33', title: 'Share mobile launch checklist template', personId: 'alex',
    status: 'open', createdAt: daysAgo(2), lastActivity: null, tags: ['Process'],
    source: 'granola', sourceContext: '1:1 with Alex', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-34', title: 'Introduce David to ML team for embeddings collab', personId: 'david',
    status: 'open', createdAt: daysAgo(3), lastActivity: null, tags: ['People'],
    source: 'slack', sourceContext: '#eng-general', hasFollowUp: false, urgencySignals: [],
  },
  {
    id: 'c-35', title: 'Review Lisa\'s proposal for shared component library', personId: 'lisa',
    status: 'open', createdAt: daysAgo(5), lastActivity: null, tags: ['Tooling'],
    source: 'slack', sourceContext: '#frontend-guild', hasFollowUp: false, urgencySignals: [],
  },
]

// Link duplicates to existing items
commitments.find(c => c.id === 'c-1')!.duplicateGroupId = 'dup-1'
commitments.find(c => c.id === 'c-20')!.duplicateGroupId = 'dup-2'
commitments.find(c => c.id === 'c-24')!.duplicateGroupId = 'dup-3'

export const duplicateGroups: DuplicateGroup[] = [
  {
    id: 'dup-1',
    commitmentIds: ['c-1', 'c-26', 'c-27'],
    reason: 'All relate to Q3 headcount planning — extracted from leadership sync, 1:1 with Sarah, and Slack thread',
  },
  {
    id: 'dup-2',
    commitmentIds: ['c-20', 'c-28'],
    reason: 'Both about the shared on-call rotation proposal — extracted from Platform leads sync and Slack',
  },
  {
    id: 'dup-3',
    commitmentIds: ['c-24', 'c-29'],
    reason: 'Both about Datadog contract renewal — extracted from DM with Nina and vendor review meeting',
  },
]
