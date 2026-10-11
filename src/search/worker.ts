import { SearchIndex } from './index'
import { parsePlaylist } from '../playlists/codec'
import type { SearchReply, SearchRequest } from './types'
const index = new SearchIndex()
self.onmessage = (event: MessageEvent<SearchRequest>) => {
  const message = event.data
  if (message.type === 'upsert') index.upsert(message.library)
  else if (message.type === 'remove') index.retain(message.ids)
  else if (message.type === 'query') self.postMessage({ type: 'results', id: message.id, results: index.search(message.query, message.scope) } satisfies SearchReply)
  else {
    try {
      const document = parsePlaylist(message.bytes, message.path, new Map(message.tracks))
      if (document.issues.length) throw new Error(document.issues[0])
      self.postMessage({ type: 'preview', id: message.id, preview: { trackIds: document.entries.flatMap(entry => entry.trackId && !entry.issue ? [entry.trackId] : []), missing: document.entries.filter(entry => !entry.trackId || !!entry.issue).length } } satisfies SearchReply)
    } catch (reason) { self.postMessage({ type: 'error', id: message.id, error: reason instanceof Error ? reason.message : 'Playlist could not be explored.' } satisfies SearchReply) }
  }
}
