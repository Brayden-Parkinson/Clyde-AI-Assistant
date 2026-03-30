import { Tier } from '../types'
import { tierColors } from '../theme'

interface Props {
  initials: string
  tier: Tier
  size?: number
}

export function Avatar({ initials, tier, size = 28 }: Props) {
  const color = tierColors[tier]
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: `${color}22`,
      border: `1.5px solid ${color}`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size * 0.38,
      fontWeight: 600,
      color,
      flexShrink: 0,
      letterSpacing: 0.5,
    }}>
      {initials}
    </div>
  )
}
