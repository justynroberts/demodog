// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'

/**
 * Brand card shown while the studio window loads.
 *
 * Its window is transparent and not focusable, so this paints the whole card
 * itself rather than relying on a window background.
 */
export default function Splash(): ReactNode {
  const [version, setVersion] = useState('')
  const [hasLogo, setHasLogo] = useState(true)

  useEffect(() => {
    void api
      .getVersion()
      .then(setVersion)
      .catch(() => undefined)
  }, [])

  return (
    <div className="splash">
      <div className="splash-card">
        {hasLogo && (
          <img className="splash-logo" src="./logo.png" alt="" onError={() => setHasLogo(false)} />
        )}
        <h1 className="splash-name">DemoDog</h1>
        <p className="splash-tag">Polish your demo until it&rsquo;s best in show</p>

        <div className="splash-rule" />

        <p className="splash-by">
          Made by <strong>FintonLabs</strong>
        </p>
        {version && <span className="splash-version mono">v{version}</span>}
      </div>
    </div>
  )
}
