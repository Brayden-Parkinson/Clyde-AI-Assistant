import { theme } from '../theme'

const tabs = [
  { id: 'focus', label: 'Focus', enabled: true },
  { id: 'board', label: 'Board', enabled: false },
  { id: 'people', label: 'People', enabled: false },
  { id: 'eng-stats', label: 'Eng Stats', enabled: false },
  { id: 'dev-log', label: 'Dev Log', enabled: false },
]

export function TabBar() {
  return (
    <div style={{
      display: 'flex',
      gap: 2,
      marginBottom: 24,
      borderBottom: `1px solid ${theme.cardBorder}`,
      paddingBottom: 0,
    }}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          disabled={!tab.enabled}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: tab.id === 'focus' ? `2px solid ${theme.text}` : '2px solid transparent',
            color: tab.enabled ? theme.text : theme.textDim,
            fontSize: 13,
            fontWeight: tab.id === 'focus' ? 600 : 400,
            padding: '8px 14px',
            cursor: tab.enabled ? 'pointer' : 'default',
            fontFamily: 'inherit',
            opacity: tab.enabled ? 1 : 0.4,
            transition: theme.transition,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
