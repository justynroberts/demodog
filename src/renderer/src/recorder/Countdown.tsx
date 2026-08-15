// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useState, type ReactNode } from 'react'

/**
 * The 3-2-1 shown before capture starts.
 *
 * Its window is transparent and covers the whole display, so this component
 * paints the overlay itself: a scrim across everything, with the count on top.
 * Painting only a small card would leave the rest of the window invisible and
 * read as a floating dialog rather than something over the screen.
 *
 * The window is click-through, and capture does not begin until the count
 * reaches zero, so this can never appear in the recording.
 */
export default function Countdown({ from }: { from: number }): ReactNode {
  const [count, setCount] = useState(Math.max(1, Math.round(from)))

  useEffect(() => {
    if (count <= 0) return
    const id = setTimeout(() => setCount((n) => n - 1), 1000)
    return () => clearTimeout(id)
  }, [count])

  const done = count <= 0

  return (
    <div className="cd-root">
      <div className="cd-stage">
        {/* Keyed so the ring and the number replay on every tick. */}
        <svg className="cd-ring" viewBox="0 0 100 100" key={`r${count}`} aria-hidden>
          <circle className="cd-ring-track" cx="50" cy="50" r="46" />
          <circle className="cd-ring-sweep" cx="50" cy="50" r="46" />
        </svg>

        <span className={`cd-number${done ? ' go' : ''}`} key={count}>
          {done ? 'GO' : count}
        </span>
      </div>

      <span className="cd-label">{done ? 'Recording' : 'Get ready'}</span>
    </div>
  )
}
