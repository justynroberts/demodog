// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'

/**
 * The 3-2-1 shown full-screen before capture starts.
 *
 * Its window is transparent and click-through, so this is only ever a graphic —
 * it neither blocks the screen nor appears in the recording, because capture
 * does not begin until the count reaches zero.
 */
export default function Countdown({ from }: { from: number }): ReactNode {
  const [count, setCount] = useState(Math.max(1, Math.round(from)))

  useEffect(() => {
    if (count <= 0) return
    const id = setTimeout(() => setCount((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [count])

  return (
    <div className="cd-root">
      <div className="cd-card">
        {/* Keying the number restarts the animation on every tick. */}
        <span className="cd-number" key={count}>
          {count > 0 ? count : 'GO'}
        </span>
        <span className="cd-label">Recording starts</span>
      </div>
    </div>
  )
}
