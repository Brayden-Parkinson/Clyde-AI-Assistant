import { useState, useCallback, useMemo } from 'react'
import { theme } from './theme'
import { commitments as initialCommitments, calendar, peopleMap, duplicateGroups as initialDupGroups } from './mockData'
import { rankCommitments } from './utils/ranking'
import { findDuplicates, mergeCommitments } from './utils/dedup'
import { Commitment } from './types'
import { TabBar } from './components/TabBar'
import { CommandBar } from './components/CommandBar'
import { RightNow } from './components/RightNow'
import { AutoResolved } from './components/AutoResolved'
import { UpcomingPrep } from './components/UpcomingPrep'
import { PossibleDuplicates } from './components/PossibleDuplicates'
import { BacklogFooter } from './components/BacklogFooter'

export default function App() {
  const [commitments, setCommitments] = useState<Commitment[]>(initialCommitments)
  const [dupGroups, setDupGroups] = useState(initialDupGroups)
  const [filterQuery, setFilterQuery] = useState('')

  // Filter commitments by search query
  const filtered = useMemo(() => {
    if (!filterQuery) return commitments
    const q = filterQuery.toLowerCase()
    return commitments.filter(c => {
      const person = peopleMap.get(c.personId)
      return (
        c.title.toLowerCase().includes(q) ||
        person?.name.toLowerCase().includes(q) ||
        c.tags.some(t => t.toLowerCase().includes(q)) ||
        c.sourceContext?.toLowerCase().includes(q)
      )
    })
  }, [commitments, filterQuery])

  // Ranked "right now" items
  const ranked = useMemo(
    () => rankCommitments(filtered, peopleMap, calendar, 5),
    [filtered],
  )

  // Auto-resolved items
  const autoResolved = useMemo(
    () => filtered.filter(c => c.status === 'auto_resolved'),
    [filtered],
  )

  // Duplicates
  const duplicates = useMemo(
    () => findDuplicates(filtered, dupGroups),
    [filtered, dupGroups],
  )

  // Open count for footer (exclude resolved/done)
  const openCount = useMemo(
    () => filtered.filter(c => c.status === 'open' || c.status === 'in_progress' || c.status === 'waiting').length,
    [filtered],
  )

  const handleMarkDone = useCallback((id: string) => {
    setCommitments(prev =>
      prev.map(c => c.id === id ? { ...c, status: 'done' as const } : c)
    )
  }, [])

  const handleMerge = useCallback((groupId: string) => {
    const group = dupGroups.find(g => g.id === groupId)
    if (!group) return
    setCommitments(prev => mergeCommitments(prev, group))
    setDupGroups(prev => prev.filter(g => g.id !== groupId))
  }, [dupGroups])

  const handleIgnore = useCallback((groupId: string) => {
    setDupGroups(prev => prev.filter(g => g.id !== groupId))
  }, [])

  return (
    <div style={{
      maxWidth: 680,
      margin: '0 auto',
      padding: '24px 20px 40px',
      minHeight: '100vh',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            background: 'linear-gradient(135deg, #a78bfa 0%, #7c3aed 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
          }}>
            C
          </div>
          <span style={{ fontSize: 16, fontWeight: 600 }}>Clyde</span>
        </div>
        <div style={{
          fontSize: 12,
          color: theme.textDim,
        }}>
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
        </div>
      </div>

      <TabBar />
      <CommandBar onFilter={setFilterQuery} />

      <RightNow items={ranked} onMarkDone={handleMarkDone} />
      <AutoResolved items={autoResolved} people={peopleMap} />
      <UpcomingPrep calendar={calendar} commitments={filtered} people={peopleMap} />
      <PossibleDuplicates
        duplicates={duplicates}
        people={peopleMap}
        onMerge={handleMerge}
        onIgnore={handleIgnore}
      />
      <BacklogFooter remainingCount={openCount} />
    </div>
  )
}
