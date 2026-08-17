// MIT License - Copyright (c) fintonlabs.com
import { useState, type ReactNode } from 'react'
import { api } from '../api'
import { toChapters, toSRT } from '../engine/subtitles'
import type { Caption } from '../engine/captions'

/**
 * What to do with a file that has just finished rendering.
 *
 * The YouTube button is a handoff, not an upload, and says so. Uploading
 * through the API needs a verified OAuth project; until one is verified, every
 * video it uploads is locked to private with no appeal. A button that appears
 * to work and quietly ruins the video is worse than a button that asks for one
 * more click.
 */
export default function ExportedPanel({
  path,
  captions,
  trim,
  hasCaptions,
  onClose
}: {
  path: string
  captions: Caption[]
  trim: { start: number; end: number }
  hasCaptions: boolean
  onClose: () => void
}): ReactNode {
  const [handedOff, setHandedOff] = useState(false)
  const [wrote, setWrote] = useState<string[]>([])

  const name = path.split('/').pop() ?? 'export.mp4'
  const title = name
    .replace(/\.mp4$/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()

  const publish = async (): Promise<void> => {
    const subtitles = hasCaptions ? toSRT(captions, trim.start, trim.end) : ''
    const description = hasCaptions ? toChapters(captions, trim.start, trim.end) : ''
    const written = await api.publishToYouTube({ videoPath: path, title, description, subtitles })
    setWrote(written)
    setHandedOff(true)
  }

  return (
    <div className="progress-wrap" onClick={onClose}>
      <div className="exported-card snap" onClick={(e) => e.stopPropagation()}>
        <span className="label">Exported</span>
        <h2>{name}</h2>

        {!handedOff ? (
          <>
            <p className="hint">
              {hasCaptions
                ? 'Your corrected captions can go up with it as a subtitle file, ' +
                  'so YouTube shows those rather than transcribing the audio again.'
                : 'Ready to upload.'}
            </p>

            <div className="exported-actions">
              <button className="btn violet" onClick={() => void publish()}>
                Publish to YouTube
              </button>
              <button className="btn" onClick={() => void api.reveal(path)}>
                Show in Finder
              </button>
              <button className="btn ghost" onClick={onClose}>
                Done
              </button>
            </div>

            <p className="hint exported-note">
              DemoDog hands the file to YouTube rather than uploading it. Uploading through
              YouTube&rsquo;s API requires a verified app, and until one is verified every video it
              uploads is locked to private permanently.
            </p>
          </>
        ) : (
          <>
            <ol className="exported-steps">
              <li>YouTube Studio is open in your browser.</li>
              <li>
                Drag <strong>{name}</strong> from the Finder window onto the page.
              </li>
              <li>
                Paste the title — it is already on your clipboard
                {hasCaptions ? ', with chapter marks below it' : ''}.
              </li>
              {wrote.length > 0 && (
                <li>
                  Add <strong>{wrote[0].split('/').pop()}</strong> under Subtitles, so your
                  corrected captions are the ones people read.
                </li>
              )}
            </ol>
            <div className="exported-actions">
              <button className="btn" onClick={() => void api.reveal(path)}>
                Show in Finder again
              </button>
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
