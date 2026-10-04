export interface Capabilities {
  secure: boolean
  directoryPicker: boolean
  filePicker: boolean
  directoryInput: boolean
  userFileWriting: boolean
  indexedDB: boolean
  handlePersistence: boolean
  worker: boolean
  mediaSession: boolean
  locks: boolean
}
export function detectCapabilities(): Capabilities {
  const input = document.createElement('input')
  const filePrototype = globalThis.FileSystemFileHandle?.prototype
  const indexedDB = typeof globalThis.indexedDB !== 'undefined'
  const directoryPicker = typeof window.showDirectoryPicker === 'function' && window.isSecureContext
  return { secure: window.isSecureContext, directoryPicker, filePicker: typeof window.showOpenFilePicker === 'function',
    directoryInput: 'webkitdirectory' in input, userFileWriting: directoryPicker && !!filePrototype?.createWritable,
    indexedDB, handlePersistence: directoryPicker && indexedDB, worker: typeof Worker !== 'undefined',
    mediaSession: 'mediaSession' in navigator, locks: 'locks' in navigator }
}
export function playbackSupport(path: string): 'likely' | 'unknown' | 'unsupported' {
  const types: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg; codecs="opus"', m4a: 'audio/mp4', m4b: 'audio/mp4', aac: 'audio/aac', aif: 'audio/aiff', aiff: 'audio/aiff', wma: 'audio/x-ms-wma' }
  const type = types[path.split('.').at(-1)?.toLowerCase() ?? '']
  const result = type ? document.createElement('audio').canPlayType(type) : ''
  return result === 'probably' ? 'likely' : result === 'maybe' ? 'unknown' : 'unsupported'
}
