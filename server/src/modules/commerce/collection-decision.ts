import type { collectionDecisions } from '../../db/schema.js'

type Decision = typeof collectionDecisions.$inferSelect

// Follow explicit replacements after chronological selection. This also handles
// timestamps that compare equal at JavaScript's millisecond precision.
export function latestCollectionDecision<
  T extends Pick<
    Decision,
    'id' | 'party' | 'createdAt' | 'supersedesDecisionId'
  >,
>(decisions: T[], party: 'customer' | 'carrier'): T | undefined {
  const records = decisions.filter((row) => row.party === party)
  let current = [...records]
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    )
    .at(-1)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    const replacement = records.find(
      (row) => row.supersedesDecisionId === current?.id,
    )
    if (!replacement) return current
    current = replacement
  }
  return current
}
