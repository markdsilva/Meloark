import type { SearchLibrary, SearchResult, SearchResults, SearchScope, SearchTrack } from './types'

export const normalizeSearch = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
interface Document { result: SearchResult; primary: string; secondary: string; text: string }
interface Block { library: SearchLibrary; tracks: Map<string, { row: SearchTrack; document: Document }>; documents: Document[] }
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const document = (result: SearchResult, secondary: string, context = ''): Document => {
  const primary = normalizeSearch(result.title), normalized = normalizeSearch(secondary)
  return { result, primary, secondary: normalized, text: `${primary} ${normalized} ${normalizeSearch(context)}` }
}
function rank(item: Document, query: string, tokens: string[]) {
  if (!tokens.every(token => item.text.includes(token))) return -1
  if (item.primary === query) return 100
  if (item.primary.startsWith(query)) return 80
  if (item.primary.includes(query)) return 65
  if (item.secondary === query || item.secondary.startsWith(query)) return 50
  if (tokens.every(token => item.primary.includes(token))) return 45
  return 20
}
function insert(top: { document: Document; score: number }[], entry: { document: Document; score: number }, limit: number) {
  const last = top.at(-1)
  if (top.length === limit && last && (entry.score < last.score || entry.score === last.score && collator.compare(entry.document.result.title, last.document.result.title) >= 0)) return
  let position = top.findIndex(item => entry.score > item.score || entry.score === item.score && collator.compare(entry.document.result.title, item.document.result.title) < 0)
  if (position < 0) position = top.length
  if (position < limit) { top.splice(position, 0, entry); if (top.length > limit) top.pop() }
}

/** Lightweight metadata only. This runs in the search worker, never in the audio path. */
export class SearchIndex {
  private blocks = new Map<string, Block>()
  upsert(library: SearchLibrary) {
    const previous = this.blocks.get(library.id), tracks: Block['tracks'] = new Map()
    const albums = new Map<string, { title: string; artist: string; trackId: string; count: number }>()
    const artists = new Map<string, { title: string; trackId: string; count: number }>()
    for (const row of library.tracks) {
      const old = previous?.tracks.get(row.id)
      const same = old && old.row.title === row.title && old.row.artist === row.artist && old.row.album === row.album && old.row.path === row.path && previous?.library.name === library.name
      const result: SearchResult = { key: JSON.stringify(['track', library.id, row.id]), kind: 'track', libraryId: library.id, title: row.title, detail: [row.artist, row.album].filter(Boolean).join(' · ') || row.path, value: row.id, artworkTrackId: row.id }
      tracks.set(row.id, { row, document: same ? old.document : document(result, `${row.artist} ${row.album}`, `${row.path} ${library.name}`) })
      if (row.album) {
        const key = JSON.stringify([row.album, row.artist]), known = albums.get(key)
        if (known) ++known.count
        else albums.set(key, { title: row.album, artist: row.artist, trackId: row.id, count: 1 })
      }
      if (row.artist) {
        const known = artists.get(row.artist)
        if (known) ++known.count
        else artists.set(row.artist, { title: row.artist, trackId: row.id, count: 1 })
      }
    }
    const documents = [...tracks.values()].map(item => item.document)
    for (const [value, album] of albums) documents.push(document({ key: JSON.stringify(['album', library.id, value]), kind: 'album', libraryId: library.id, title: album.title, detail: album.artist || library.name, value, artworkTrackId: album.trackId, count: album.count }, album.artist, library.name))
    for (const [value, artist] of artists) documents.push(document({ key: JSON.stringify(['artist', library.id, value]), kind: 'artist', libraryId: library.id, title: artist.title, detail: library.name, value, artworkTrackId: artist.trackId, count: artist.count }, '', library.name))
    for (const playlist of library.playlists) documents.push(document({ key: JSON.stringify(['playlist', library.id, playlist.id]), kind: 'playlist', libraryId: library.id, title: playlist.name.replace(/\.m3u8?$/i, ''), detail: library.name, value: playlist.path }, playlist.path, library.name))
    documents.push(document({ key: JSON.stringify(['library', library.id]), kind: 'library', libraryId: library.id, title: library.name, detail: `${tracks.size.toLocaleString()} songs`, value: library.id, count: tracks.size, artworkTrackId: library.tracks[0]?.id }, 'library'))
    this.blocks.set(library.id, { library, tracks, documents })
  }
  retain(ids: string[]) { const keep = new Set(ids); for (const id of this.blocks.keys()) if (!keep.has(id)) this.blocks.delete(id) }
  search(raw: string, scope?: SearchScope): SearchResults {
    const query = normalizeSearch(raw.slice(0, 256)), tokens = query.split(/\s+/).filter(Boolean).slice(0, 12)
    const songs: { document: Document; score: number }[] = [], collections: typeof songs = []
    const membership = scope?.kind === 'playlist' ? new Set(scope.trackIds) : undefined
    const playlistOrder = new Map<string, number>()
    if (scope?.kind === 'playlist') for (const [position, trackId] of (scope.trackIds ?? []).entries()) if (!playlistOrder.has(trackId)) playlistOrder.set(trackId, position)
    let total = 0
    for (const [id, block] of this.blocks) {
      if (scope && id !== scope.libraryId) continue
      for (const item of block.documents) {
        const result = item.result
        if (scope) {
          if (result.kind !== 'track') continue
          const row = block.tracks.get(result.value)!.row
          if (scope.kind === 'playlist' && !membership!.has(row.id) || scope.kind === 'artist' && row.artist !== scope.value || scope.kind === 'album' && JSON.stringify([row.album, row.artist]) !== scope.value) continue
        } else if (!query && !['library', 'playlist'].includes(result.kind)) continue
        const score = query ? rank(item, query, tokens) : scope?.kind === 'playlist' ? (scope.trackIds?.length ?? 0) - playlistOrder.get(result.value)! : 0
        if (score < 0) continue
        ++total
        insert(result.kind === 'track' ? songs : collections, { document: item, score }, scope ? 24 : result.kind === 'track' ? 12 : 6)
      }
    }
    return { items: [...collections, ...songs].map(item => item.document.result), total }
  }
}
