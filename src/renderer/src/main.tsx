// MIT License - Copyright (c) fintonlabs.com
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/app.css'
import StudioApp from './StudioApp'
import ControlBar from './recorder/ControlBar'

// Two windows share one bundle; the hash decides which one this is.
const route = window.location.hash.replace('#', '') || '/studio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>{route === '/bar' ? <ControlBar /> : <StudioApp />}</StrictMode>
)
