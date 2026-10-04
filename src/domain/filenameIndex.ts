import { dirname, filename, naturalCompare, type Track } from './models'

export function filenameIndex(path: string): { index: number | null; title: string; invalid: boolean } {
  const stem = filename(path).replace(/\.[^.]+$/, '')
  const match = /^\s*(\d+)\s*(?:-\s*|[.)]\s*(?:-\s*)?)(\S(?:.*?\S)?)\s*$/.exec(stem)
  if (!match) return { index: null, title: stem, invalid: false }
  const index = Number(match[1])
  return { index: Number.isSafeInteger(index) ? index : null, title: match[2], invalid: !Number.isSafeInteger(index) || index < 1 }
}
export interface IndexGroup { folder: string; tracks: Track[]; issues: string[]; ambiguous: boolean; indexed: number }
export function analyzeIndexes(tracks: Track[]): IndexGroup[] {
  const folders = new Map<string, Track[]>()
  for (const track of tracks) {
    const folder = dirname(track.path)
    folders.set(folder, [...(folders.get(folder) ?? []), track])
  }
  return [...folders].sort(([a], [b]) => naturalCompare(a, b)).map(([folder, members]) => {
    const indexed = members.filter(track => track.index !== null)
    const counts = new Map<number, number>()
    indexed.forEach(track => counts.set(track.index!, (counts.get(track.index!) ?? 0) + 1))
    const duplicates = [...counts].filter(([, n]) => n > 1).map(([n]) => n)
    const issues: string[] = []
    if (duplicates.length) issues.push(`Duplicate indexes: ${duplicates.slice(0, 8).join(', ')}${duplicates.length > 8 ? '…' : ''}. Review tied tracks.`)
    const invalid = members.some(track => filenameIndex(track.path).invalid)
    if (invalid) issues.push('Zero or invalid filename indexes need review.')
    if (indexed.length && indexed.length !== members.length) issues.push(`${members.length - indexed.length} unindexed tracks need placement review.`)
    let previous = 0, total = 0
    const gaps: number[] = []
    for (const n of [...counts.keys()].filter(n => n > 0).sort((a, b) => a - b)) {
      if (n > previous + 1) {
        total += n - previous - 1
        for (let i = previous + 1; i < n && gaps.length < 8; i++) gaps.push(i)
      }
      previous = n
    }
    if (total) issues.push(`Index gaps: ${gaps.join(', ')}${total > gaps.length ? '…' : ''}. Files are not renamed.`)
    return { folder, indexed: indexed.length, issues, ambiguous: !!duplicates.length || invalid || (!!indexed.length && indexed.length !== members.length),
      tracks: [...members].sort((a, b) => (a.index ?? Infinity) - (b.index ?? Infinity) || naturalCompare(a.path, b.path)) }
  })
}
