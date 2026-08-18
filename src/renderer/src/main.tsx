// MIT License - Copyright (c) fintonlabs.com
import { StrictMode } from 'react'
import type React from 'react'
import { createRoot } from 'react-dom/client'
import './styles/fonts.css'
import './styles/app.css'
import StudioApp from './StudioApp'
import ControlBar from './recorder/ControlBar'
import Countdown from './recorder/Countdown'
import Splash from './ui/Splash'

// Several windows share one bundle; the hash decides which one this is.
const [route, query] = (window.location.hash.replace('#', '') || '/studio').split('?')
const params = new URLSearchParams(query ?? '')

// These routes render into transparent windows and must not paint a ground.
if (route === '/countdown' || route === '/bar' || route === '/splash') {
  document.documentElement.classList.add('transparent-window')
}

function Root(): React.ReactNode {
  if (route === '/bar') return <ControlBar />
  if (route === '/countdown') return <Countdown from={Number(params.get('n') ?? 3)} />
  if (route === '/splash') return <Splash />
  return <StudioApp />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
