// MIT License - Copyright (c) fintonlabs.com
import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { probeAudio } from './recorder'

const run = promisify(execFile)

/** Where reports are sent. */
const RECIPIENT = 'justynroberts@gmail.com'

/**
 * Collects what is needed to diagnose a fault, and hands it to Mail.
 *
 * `mailto:` cannot carry an attachment — there is no parameter for it in RFC
 * 6068 and no mail client invents one — so "with the logs attached" is done in
 * two halves: a zip is written and revealed in Finder ready to drag, and the
 * message itself opens with the version, the system and a summary already in
 * the body. Pretending otherwise would produce a mail with a promise of logs
 * and no logs, which is worse than asking for one drag.
 *
 * What goes in is deliberately bounded: this app records people's screens, and
 * a diagnostic bundle that quietly swept up a take would be a far worse problem
 * than the bug it was collected for. Logs and metadata only — never a frame of
 * video, never audio, never a transcript.
 */
export async function collectDiagnostics(note: string): Promise<{ zip: string; body: string }> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const folder = join(app.getPath('temp'), `demodog-report-${stamp}`)
  await mkdir(folder, { recursive: true })

  const lines: string[] = []
  const add = (label: string, value: string): void => {
    lines.push(`${label}: ${value}`)
  }

  add('App', `DemoDog ${app.getVersion()}`)
  add('macOS', `${process.getSystemVersion?.() ?? 'unknown'} (${process.arch})`)
  add('Electron', process.versions.electron)
  add('Packaged', String(app.isPackaged))

  // Permission states, because most reports that read as "it did nothing" are
  // one of these being off — and the user cannot see them from inside the app.
  for (const service of ['ScreenCapture', 'Microphone', 'Camera', 'SpeechRecognition']) {
    try {
      const { stdout } = await run('/usr/bin/log', [
        'show',
        '--last',
        '1m',
        '--style',
        'compact',
        '--predicate',
        `subsystem == "com.apple.TCC" AND composedMessage CONTAINS "${service}"`
      ])
      add(`TCC ${service}`, stdout.trim() ? 'recent activity' : 'no recent activity')
    } catch {
      add(`TCC ${service}`, 'not readable')
    }
  }

  const summary = [...lines, '', 'What happened:', note.trim() || '(not described)'].join('\n')
  await writeFile(join(folder, 'summary.txt'), summary, 'utf8')

  // The updater's own log, which is the one that explains a failed update.
  const updaterLog = join(app.getPath('logs'), 'updater.log')
  if (existsSync(updaterLog)) {
    const text = await readFile(updaterLog, 'utf8')
    // The tail only. These grow for the life of an install and nobody reads
    // the beginning of one.
    await writeFile(join(folder, 'updater.log'), text.slice(-200_000), 'utf8')
  }

  // The most recent take's metadata — geometry, frame rate, clock offsets and
  // the frame-status counts that say why a capture produced no video. Not the
  // recording: just the numbers describing it.
  const takes = join(app.getPath('videos'), 'DemoDog')
  if (existsSync(takes)) {
    const recent = readdirSync(takes)
      .filter((name) => name.endsWith('.demodog'))
      .map((name) => ({ name, at: statSync(join(takes, name)).mtimeMs }))
      .sort((a, b) => b.at - a.at)
      .slice(0, 3)
    for (const take of recent) {
      const meta = join(takes, take.name, 'meta.json')
      if (existsSync(meta)) {
        await writeFile(join(folder, `${take.name}.meta.json`), await readFile(meta, 'utf8'))
      }
      // What each track actually contains. "Transcription found nothing" has
      // three different causes — no audio track, a silent one, and speech the
      // recogniser could not make out — and they are indistinguishable from a
      // description. A peak level settles it without anyone sending a file.
      const lines: string[] = []
      for (const name of ['camera.mp4', 'camera.webm', 'screen.mp4']) {
        const path = join(takes, take.name, name)
        if (!existsSync(path)) continue
        const probe = await probeAudio(path)
        lines.push(
          probe.hasAudio
            ? `${name}: audio, ${probe.duration?.toFixed(1) ?? '?'}s, peaks ${probe.peakDb?.toFixed(1) ?? '?'} dB`
            : `${name}: no audio track`
        )
      }
      if (lines.length) {
        await writeFile(join(folder, `${take.name}.audio.txt`), lines.join('\n'), 'utf8')
      }
    }
  }

  const zip = join(app.getPath('temp'), `demodog-report-${stamp}.zip`)
  await run('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', folder, zip])
  await rm(folder, { recursive: true, force: true })

  return { zip, body: summary }
}

/** Builds the bundle, reveals it, and opens a pre-filled message. */
export async function sendBugReport(note: string): Promise<string> {
  const { zip, body } = await collectDiagnostics(note)

  const subject = `DemoDog ${app.getVersion()} — bug report`
  const instructions =
    `\n\n---\nThe diagnostics file has been revealed in Finder — please drag ` +
    `${zip.split('/').pop()} onto this message before sending.\n\n`

  const url =
    `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(instructions + body)}`

  // Revealed first, so the file is already sitting there when the message opens.
  shell.showItemInFolder(zip)
  // Deliberately not routed through `openExternally`, which allows only http
  // and https. That gate exists to stop the *renderer* handing an arbitrary
  // scheme to macOS; this URL is built here from a fixed recipient and encoded
  // parameters, and mailto: is the whole point of it.
  await shell.openExternal(url)
  return zip
}
