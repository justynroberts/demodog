// MIT License - Copyright (c) fintonlabs.com
import { app, net } from 'electron'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Product analytics, over GA4's Measurement Protocol.
 *
 * Deliberately *not* gtag.js in the renderer. Two reasons, and the first is
 * the one that decides it:
 *
 * 1. The packaged renderer runs under `script-src 'self'` with no third-party
 *    hosts. Loading a tag manager script would mean reopening that, which is a
 *    real widening of what a screen recorder is allowed to execute — for
 *    counting two events. The Measurement Protocol is an HTTPS POST, and this
 *    process is not subject to the renderer's CSP at all.
 * 2. gtag.js expects a browser: cookies, a referrer, a document. In an app
 *    window it produces a stream of half-populated page views. The protocol
 *    wants exactly what a desktop app can honestly supply — a stable client id
 *    and named events.
 *
 * Nothing about the user or their recordings is sent: no paths, no titles, no
 * durations, no display names. The client id is a random UUID generated here
 * and never derived from the machine.
 *
 * **Currently dormant.** It is off by default and no build carries credentials,
 * so nothing is sent by any shipped copy. That is not an accident of
 * configuration — 1.3.0 told users in its release notes that the app makes no
 * third-party requests at all, and that stays true until someone decides
 * otherwise and says so in the same place.
 */

/**
 * Filled in at build time or by the environment. Without both values every
 * call below is a no-op, which is what makes a development tree silent and a
 * fork of this repo not report to someone else's property.
 */
const MEASUREMENT_ID = process.env['DEMODOG_GA_ID'] ?? ''
const API_SECRET = process.env['DEMODOG_GA_SECRET'] ?? ''

const ENDPOINT = 'https://www.google-analytics.com/mp/collect'

/** Where the opt-out and the client id live. */
function statePath(): string {
  return join(app.getPath('userData'), 'analytics.json')
}

interface State {
  clientId: string
  /**
   * Off until switched on, deliberately.
   *
   * There are two independent gates — credentials must be present *and* this
   * must be true — because they guard different mistakes. Missing credentials
   * stop a fork or a dev tree reporting to someone else's property; this stops
   * a build that happens to carry credentials from reporting before anyone
   * decided it should.
   */
  enabled: boolean
}

let cached: State | null = null

function state(): State {
  if (cached) return cached
  try {
    if (existsSync(statePath())) {
      const parsed = JSON.parse(readFileSync(statePath(), 'utf8')) as Partial<State>
      if (parsed.clientId) {
        cached = { clientId: parsed.clientId, enabled: parsed.enabled === true }
        return cached
      }
    }
  } catch {
    // A corrupt file is not worth failing a launch over; a new id costs nothing.
  }
  cached = { clientId: randomUUID(), enabled: false }
  save()
  return cached
}

function save(): void {
  try {
    writeFileSync(statePath(), JSON.stringify(cached, null, 2))
  } catch {
    // Not being able to remember the id means a new one next launch. Harmless.
  }
}

export function analyticsEnabled(): boolean {
  return state().enabled
}

export function setAnalyticsEnabled(enabled: boolean): void {
  cached = { ...state(), enabled }
  save()
}

/** True when this build actually has somewhere to report to. */
export function analyticsConfigured(): boolean {
  return !!MEASUREMENT_ID && !!API_SECRET
}

/**
 * Sends one event, and never throws.
 *
 * Analytics failing is not a reason for anything the user asked for to fail,
 * so every path out of here is a resolved promise. Being offline is the normal
 * case, not an error.
 */
export async function track(name: string, params: Record<string, string | number> = {}): Promise<void> {
  if (!analyticsConfigured()) return
  const current = state()
  if (!current.enabled) return

  const body = JSON.stringify({
    client_id: current.clientId,
    // No user_id: there is no account here, and inventing a stable identity for
    // someone who never signed up is not something to do quietly.
    events: [
      {
        name,
        params: {
          ...params,
          app_version: app.getVersion(),
          // GA4 drops events with no engagement signal from a non-web client.
          engagement_time_msec: 1,
          session_id: sessionId
        }
      }
    ]
  })

  try {
    const request = net.request({
      method: 'POST',
      url: `${ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`
    })
    await new Promise<void>((resolve) => {
      // Resolved on any outcome. A metric is never worth a hang.
      const done = (): void => resolve()
      request.on('response', (response) => {
        response.on('data', () => {})
        response.on('end', done)
        response.on('error', done)
      })
      request.on('error', done)
      request.setHeader('Content-Type', 'application/json')
      request.write(body)
      request.end()
      setTimeout(done, 4000)
    })
  } catch {
    // Nothing to do and nobody to tell.
  }
}

/** One per launch, so GA can group a session without anything persistent. */
const sessionId = String(Date.now())
