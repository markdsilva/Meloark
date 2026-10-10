import { useEffect, useState } from 'react'
import { Globe2, X } from 'lucide-react'
import type { Capabilities } from '../../platform/capabilities/detect'
import { useApp } from '../../app/store'
import { useGuide } from './Guide'

const preference = 'trackindex-browser-tip-v1'
let seenInSession = false

// Browser identity is used only for this optional recommendation. All feature
// availability and application behavior continue to use capability detection.
export function isChromiumBrowser(browser: Pick<Navigator, 'userAgent'> & { userAgentData?: { brands: { brand: string }[] } } = navigator) {
  if (browser.userAgentData?.brands.some(({ brand }) => /^(Chromium|Google Chrome|Microsoft Edge)$/i.test(brand))) return true
  return !/iPhone|iPad|iPod|CriOS|EdgiOS/i.test(browser.userAgent) && /(?:Chrome|Chromium|Edg|OPR|Vivaldi)\//.test(browser.userAgent)
}

export function BrowserRecommendation() {
  return <><strong>Save directly with desktop Chrome or Edge</strong><p>Desktop Chrome and Edge support direct folder access. You can still listen, edit and export here.</p></>
}

export function BrowserSuggestion({ capabilities, paused = false, details }: { capabilities: Capabilities; paused?: boolean; details: () => void }) {
  const ready = useApp(s => s.ready), guideActive = useGuide(s => s.active)
  const [eligible] = useState(() => !capabilities.directoryPicker && !isChromiumBrowser())
  const [dismissed, setDismissed] = useState(() => {
    try { return seenInSession || localStorage.getItem(preference) === 'seen' } catch { return seenInSession }
  })
  const visible = eligible && ready && !dismissed && !paused && !guideActive
  useEffect(() => {
    if (!visible) return
    seenInSession = true
    try { localStorage.setItem(preference, 'seen') } catch { /* Once for this in-memory session. */ }
  }, [visible])
  if (!visible) return null
  return <section className="browser-suggestion" role="region" aria-label="Browser tip">
    <Globe2 size={18} aria-hidden="true" />
    <div><BrowserRecommendation /><button className="text-button" onClick={() => { setDismissed(true); details() }}>Browser options</button></div>
    <button className="icon-button ghost-button" aria-label="Dismiss browser tip" onClick={() => setDismissed(true)}><X size={16} /></button>
  </section>
}
