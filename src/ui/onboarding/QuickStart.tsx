import { BookOpen, ChevronDown, Globe2, Keyboard } from 'lucide-react'
import { Dialog } from '../shared/Dialog'

const steps = [
  ['Open your music', 'Choose a music folder, or select files. Browse All tracks and use a track’s Play button to listen. You can play music before creating a playlist.'],
  ['Choose how to save the order', 'Set up the folder, or choose New playlist. M3U8 only stores the order in a playlist. Numbered filenames updates the complete audio folder. Choose both to keep filenames and an M3U8 in the same order.'],
  ['Add and arrange tracks', 'For M3U8-only playlists, use + or the track menu in All tracks to add songs. Open Playlist to drag rows up or down. Clear filters and choose Playlist order before reordering. On touch screens, turn on Reorder tracks first.'],
  ['Save your changes', 'Use Save playlist for a connected folder, or Export to download an M3U8. Filename sync runs automatically after playback stops. Review the filename preview before enabling it; other playlists keep their sequence while their file references follow renames.'],
  ['Come back to your collection', 'Your drafts are remembered when browser storage is available. If asked, grant folder access or reselect the same files to restore playback and artwork. Keep saved or exported copies of playlists you want to keep.'],
]

export function QuickStart({ close, browserSupport }: { close: () => void; browserSupport: () => void }) {
  return <Dialog title="Quick start" close={close} wide className="quick-start">
    <p className="quick-start-intro">From your music folder to a playlist in your own order.</p>
    <ol className="quick-start-steps">{steps.map(([title, text], index) => <li key={title}><span className="step-number" aria-hidden="true">{index + 1}</span><div><h3>{title}</h3><p>{text}</p></div></li>)}</ol>
    <section className="quick-start-browser"><Globe2 size={21} aria-hidden="true" /><div><h3>Choose the right browser</h3><p>Desktop Chrome or Edge offers direct folder access and saving. Firefox, Safari and mobile browsers can still play selected music, edit playlists and export M3U8 files. Format support varies by device; filename sync also needs a successful rename check.</p><button className="text-button" onClick={browserSupport}>Check this browser’s support</button></div></section>
    <details className="quick-start-tips"><summary><Keyboard size={18} aria-hidden="true" />Useful tips<ChevronDown size={16} aria-hidden="true" /></summary><ul>
      <li><strong>Select a group.</strong> Ctrl/Cmd-click selects individual tracks; Shift-click selects a range. On mobile, use Select tracks.</li>
      <li><strong>Use the keyboard.</strong> Space selects a focused row; Enter plays it. Alt+Arrow up/down moves selected playlist tracks. Ctrl/Cmd+Z undoes an edit.</li>
      <li><strong>Find music anywhere.</strong> Ctrl/Cmd+K opens global search. Results keep your current playlist in place.</li>
      <li><strong>Change filename sync.</strong> Sync settings can pause sync or remove filename numbers after a reviewed preview.</li>
      <li><strong>Keep music local.</strong> Audio and artwork stay on your device. Online lyrics is optional and sends song details to LRCLIB only after you allow lookup.</li>
    </ul></details>
    <div className="dialog-actions"><button className="button primary" onClick={close}>Got it</button></div>
  </Dialog>
}

export function QuickStartInvitation({ open }: { open: () => void }) {
  return <section className="quick-start-invitation" aria-label="Getting started"><BookOpen size={21} aria-hidden="true" /><div><strong>New to Meloark?</strong><p>Five steps to open music, arrange tracks and save.</p></div><button className="button secondary" onClick={open}>Read quick start</button></section>
}
