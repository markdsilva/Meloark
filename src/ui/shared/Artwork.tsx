import { useEffect, useState } from 'react'
import { Disc3, Music2 } from 'lucide-react'
export function Artwork({ blob, title, large = false }: { blob?: Blob; title: string; large?: boolean }) {
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (!blob) { setUrl(undefined); return }
    const next = URL.createObjectURL(blob); setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])
  const variant = [...title].reduce((total, char) => total + char.charCodeAt(0), 0) % 5
  return <span className={`artwork art-${variant} ${large ? 'large' : ''}`}>
    {url ? <img src={url} alt="" /> : large ? <Disc3 aria-hidden="true" /> : <Music2 aria-hidden="true" />}
  </span>
}
