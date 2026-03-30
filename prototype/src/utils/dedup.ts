import { Commitment, DuplicateGroup } from '../types'

export interface DuplicateMatch {
  group: DuplicateGroup
  commitments: Commitment[]
}

export function findDuplicates(
  commitments: Commitment[],
  groups: DuplicateGroup[],
): DuplicateMatch[] {
  return groups.map(group => ({
    group,
    commitments: group.commitmentIds
      .map(id => commitments.find(c => c.id === id))
      .filter((c): c is Commitment => c != null && c.status !== 'auto_resolved' && c.status !== 'done'),
  })).filter(m => m.commitments.length >= 2)
}

export function mergeCommitments(
  commitments: Commitment[],
  group: DuplicateGroup,
): Commitment[] {
  const keepId = group.commitmentIds[0]
  const removeIds = new Set(group.commitmentIds.slice(1))
  return commitments.filter(c => !removeIds.has(c.id)).map(c => {
    if (c.id === keepId) {
      return { ...c, duplicateGroupId: undefined }
    }
    return c
  })
}
