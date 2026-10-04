export interface FileDescriptor { reference: string; path: string; size: number; lastModified: number }
export interface Access { read: 'granted' | 'prompt' | 'denied'; write: 'granted' | 'prompt' | 'denied'; reconnect: boolean }
export interface WriteReceipt { bytes: Uint8Array; hash: string }
export interface DeleteReceipt { path: string; deleted: true }
export interface LibrarySource {
  kind: 'direct' | 'portable'
  name: string
  canDeletePlaylists?: boolean
  scan(signal: AbortSignal): AsyncIterable<FileDescriptor>
  readFile(reference: string): Promise<File>
  getAccess(): Promise<Access>
  requestAccess(intent: 'read' | 'write'): Promise<boolean>
  writePlaylist(target: string, bytes: Uint8Array, expected: Uint8Array | null): Promise<WriteReceipt>
  deletePlaylist?(target: string, expected: Uint8Array): Promise<DeleteReceipt>
}
export interface DirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>
    showOpenFilePicker?: unknown
  }
}
