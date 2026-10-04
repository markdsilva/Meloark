import { Check, Download, FolderOpen, HardDrive, ShieldCheck, Database } from 'lucide-react'
import type { Capabilities } from '../../platform/capabilities/detect'
import { Dialog } from '../shared/Dialog'
export function CapabilityDialog({ capabilities, close }: { capabilities: Capabilities; close: () => void }) {
  return <Dialog title="Your browser, your library" close={close}>
    <p className="dialog-intro">TrackIndex works with files you choose. Your music, tags, and artwork stay on this device.</p>
    <div className="capability-list">
      <div><FolderOpen /><span><strong>Folder browsing</strong><small>{capabilities.directoryPicker ? 'Direct recursive folder access available' : capabilities.directoryInput ? 'Portable folder selection available' : 'Select multiple files to browse'}</small></span><Check className="success" /></div>
      <div><HardDrive /><span><strong>M3U8 write-back</strong><small>{capabilities.userFileWriting ? 'Available after you grant write permission' : 'Export a playlist and place it in your library'}</small></span>{capabilities.userFileWriting ? <Check className="success" /> : <Download />}</div>
      <div><Database /><span><strong>Remembered libraries</strong><small>{capabilities.handlePersistence ? 'Handles can be remembered; access may need renewal' : 'Drafts can be remembered; files need reselection'}</small></span></div>
      <div><ShieldCheck /><span><strong>No music uploads</strong><small>No account, cloud library, or server processing</small></span><Check className="success" /></div>
    </div>
    {!capabilities.directoryPicker && <p className="callout">For the complete folder and write-back experience, use a Chromium-based desktop browser. You can continue with portable selection here.</p>}
    {!capabilities.secure && <p className="callout">Direct folder access requires HTTPS or localhost.</p>}
    <div className="dialog-actions"><button className="button primary" onClick={close}>Got it</button></div>
  </Dialog>
}
