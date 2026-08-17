// MIT License - Copyright (c) fintonlabs.com
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'

export function Slider({
  label,
  value,
  min,
  max,
  step = 0.01,
  format,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
}): ReactNode {
  return (
    <div className="slider-row">
      <div className="slider-head">
        <span className="name">{label}</span>
        <span className="value">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}): ReactNode {
  return (
    <label className="row" style={{ cursor: 'pointer' }}>
      <span className="name">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="seg">
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Group({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div className="insp-group">
      <span className="label">{title}</span>
      {children}
    </div>
  )
}

/** Light / dark / system, persisted, applied to <html data-theme>. */
export function ThemeToggle(): ReactNode {
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>(() => {
    const stored = localStorage.getItem('demodog-theme')
    if (stored === 'light' || stored === 'dark') return stored
    // Light is the default rather than the system setting; following the
    // system would put half of all first runs in a dark shell, which flatters
    // every recording shown inside it.
    return stored === 'system' ? 'system' : 'light'
  })

  useEffect(() => {
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme')
      localStorage.setItem('demodog-theme', 'system')
    } else {
      document.documentElement.setAttribute('data-theme', theme)
      localStorage.setItem('demodog-theme', theme)
    }
  }, [theme])

  const next = (): void =>
    setTheme(theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system')

  const glyph = theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'

  return (
    <button
      className="btn icon"
      onClick={next}
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${theme}`}
    >
      <span style={{ fontSize: 15, lineHeight: 1 }}>{glyph}</span>
    </button>
  )
}

/** The house-style credit affordance; present on every screen. */
export function InfoButton(): ReactNode {
  const ref = useRef<HTMLDialogElement>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void api
      .getVersion()
      .then(setVersion)
      .catch(() => undefined)
  }, [])

  return (
    <>
      <button
        className="info-btn"
        aria-label="About this app"
        onClick={() => ref.current?.showModal()}
      >
        i
      </button>
      <dialog
        className="info"
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close()
        }}
      >
        <div className="body">
          <h2>DemoDog</h2>
          <p>
            Screen recording with automatic zoom, a reconstructed cursor and camera
            picture-in-picture{version ? ` — version ${version}` : ''}.
          </p>
          <p>
            <a
              href="https://fintonlabs.com"
              target="_blank"
              rel="noopener"
              onClick={(e) => {
                e.preventDefault()
                api.openExternal('https://fintonlabs.com')
              }}
            >
              Made by FintonLabs
            </a>
          </p>
          <button className="btn" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </dialog>
    </>
  )
}

/**
 * The brand mark. Falls back to a plain accent square until the artwork has
 * been generated with `npm run icon`, so a fresh checkout never shows a broken
 * image.
 */
export function Brand(): ReactNode {
  const [hasLogo, setHasLogo] = useState(true)
  return (
    <div className="brand">
      {hasLogo ? (
        <img className="mark" src="./logo.png" alt="" onError={() => setHasLogo(false)} />
      ) : (
        <span className="dot" />
      )}
      DemoDog
    </div>
  )
}

/**
 * Visible credit on the main screen, alongside the info button rather than
 * instead of it — the button carries the detail, this carries the mark.
 */
export function MadeByFintonLabs(): ReactNode {
  const [hasLogo, setHasLogo] = useState(true)
  return (
    <div className="made-by">
      {hasLogo && (
        <img src="./logo.png" alt="" className="made-by-mark" onError={() => setHasLogo(false)} />
      )}
      <span>
        DemoDog — made by{' '}
        <a
          href="https://fintonlabs.com"
          target="_blank"
          rel="noopener"
          onClick={(e) => {
            e.preventDefault()
            api.openExternal('https://fintonlabs.com')
          }}
        >
          FintonLabs
        </a>
      </span>
    </div>
  )
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds)
  const m = Math.floor(s / 60)
  const rest = s - m * 60
  return `${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`
}
