import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/shell/App'
import './styles/tokens.css'
import './styles/app.css'
import './styles/lyrics.css'
import './styles/search.css'
import './styles/ambient.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
