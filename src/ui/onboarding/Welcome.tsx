import { ArrowRight, Download, FolderOpen, ListMusic } from 'lucide-react'
import { Artwork } from '../shared/Artwork'
import { GuideInvitation } from './Guide'

export function Welcome({ chooseFolder, chooseFiles, help, direct }: { chooseFolder: () => void; chooseFiles: () => void; help: () => void; direct: boolean }) {
  return <div className="welcome">
    <div className="welcome-copy">
      <h1>A home for your<br /><span>local music.</span></h1>
      <p>Play local music, browse your library, and create or edit playlists.</p>
      <div className="welcome-actions"><button className="button primary" data-tour="folder" onClick={chooseFolder}><FolderOpen size={18} />Choose a music folder<ArrowRight size={17} /></button><button className="text-button" onClick={chooseFiles}>Or select files</button></div>
    </div>
    <div className="welcome-preview" aria-label="Example playlist preview">
      <div className="preview-caption">EXAMPLE PLAYLIST</div>
      <div className="preview-hero"><Artwork title="Sunday slow" large /><div><h2>Sunday slow</h2><p>3 tracks · 10 min</p></div></div>
      <div className="preview-tracks">{[['First light', 'Morning sketches', '3:42'], ['Somewhere quiet', 'Open windows', '4:18'], ['Stay a little longer', 'Late afternoon', '2:56']].map(([title, artist, length], index) => <div className="preview-track" key={title}><span>{index + 1}</span><Artwork title={title} /><div><strong>{title}</strong><small>{artist}</small></div><span>{length}</span></div>)}</div>
      <div className="preview-bottom"><ListMusic size={16} />Drag tracks to reorder</div>
    </div>
    <div className="welcome-guide"><GuideInvitation /></div>
    <div className="feature-grid">
      <div><FolderOpen /><h3>Open your music</h3><p>Select a folder or files to browse and play your tracks.</p></div>
      <div><ListMusic /><h3>Arrange playlist tracks</h3><p>Drag tracks to reorder a playlist. Undo restores the previous order.</p></div>
      <div><Download /><h3>Save or export playlists</h3><p>Save to a connected folder or download an M3U8 playlist.</p></div>
    </div>
    <div className="browser-note"><div><strong>{direct ? 'Direct folder access available' : 'Portable mode available'}</strong><p>{direct ? 'Saving to your folder requires write permission.' : 'Select music and export playlists. Direct saving is unavailable here.'}</p></div><button className="text-button" onClick={help}>Browser support<ArrowRight size={15} /></button></div>
  </div>
}
