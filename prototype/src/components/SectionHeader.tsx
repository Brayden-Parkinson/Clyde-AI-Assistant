import { useState } from 'react'
import { theme } from '../theme'

interface Props {
  title: string
  count?: number
  color?: string
  collapsible?: boolean
  defaultCollapsed?: boolean
  children: React.ReactNode
}

export function SectionHeader({ title, count, color, collapsible = false, defaultCollapsed = false, children }: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <section style={{ marginBottom: 32 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: collapsed ? 0 : 16,
          cursor: collapsible ? 'pointer' : 'default',
          userSelect: 'none',
        }}
        onClick={() => collapsible && setCollapsed(!collapsed)}
      >
        {collapsible && (
          <span style={{
            color: theme.textDim,
            fontSize: 10,
            transition: theme.transition,
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
          }}>
            &#9660;
          </span>
        )}
        <h2 style={{
          fontSize: 13,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: color || theme.textDim,
          margin: 0,
        }}>
          {title}
        </h2>
        {count !== undefined && (
          <span style={{
            fontSize: 11,
            color: theme.textDim,
            background: theme.surface,
            padding: '1px 7px',
            borderRadius: 10,
          }}>
            {count}
          </span>
        )}
      </div>
      {!collapsed && children}
    </section>
  )
}
