export type SearchKind = 'track' | 'album' | 'artist' | 'playlist' | 'library'
export interface SearchTrack { id: string; title: string; artist: string; album: string; path: string }
export interface SearchPlaylist { id: string; name: string; path: string }
export interface SearchLibrary { id: string; name: string; tracks: SearchTrack[]; playlists: SearchPlaylist[] }
export interface SearchScope {
  kind: Exclude<SearchKind, 'track'>; libraryId: string; title: string; value?: string; trackIds?: string[]
}
export interface SearchResult {
  key: string; kind: SearchKind; libraryId: string; title: string; detail: string
  value: string; artworkTrackId?: string; count?: number
}
export interface SearchResults { items: SearchResult[]; total: number }
export interface SearchPlaylistPreview { trackIds: string[]; missing: number }
export type SearchRequest = { type: 'upsert'; library: SearchLibrary } | { type: 'remove'; ids: string[] }
  | { type: 'query'; id: number; query: string; scope?: SearchScope }
  | { type: 'preview'; id: number; bytes: Uint8Array<ArrayBuffer>; path: string; tracks: [string, string][] }
export type SearchReply = { type: 'results'; id: number; results: SearchResults } | { type: 'preview'; id: number; preview: SearchPlaylistPreview } | { type: 'error'; id: number; error: string }
