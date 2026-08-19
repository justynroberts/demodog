// MIT License - Copyright (c) fintonlabs.com
/**
 * An MCP server for authoring walkthroughs.
 *
 * The point is that a model can compose a finished demo video: describe the
 * clicks and the narration, and get back an mp4 with the zooms placed, the
 * cursor drawn and smoothed, the captions burned in and the music ducked.
 * Nothing here records anything — the video comes from a browser automation
 * tool, which is why speech and camera are out of scope by design.
 *
 *     npm run mcp                 # prints the URL and the key, then serves
 *     DEMODOG_MCP_KEY=… npm run mcp
 *
 * Bound to the loopback interface and requiring a bearer token. A local model
 * runs as an ordinary user process, so anything it can reach, anything else on
 * the machine can reach — an unauthenticated server here would let any page in
 * any browser drive file writes and process spawns through it.
 */
import { createServer } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')
const HOME = homedir()
const expand = (p) => (String(p).startsWith('~') ? join(HOME, String(p).slice(1)) : resolve(String(p)))

/** Where authored specs live between calls, so a model can revise one. */
const SPECS = join(HOME, 'Movies', 'DemoDog', 'walkthroughs')

// ---- the key -------------------------------------------------------------

/**
 * Generated once and kept, so restarting the server does not invalidate a key
 * the model has been configured with.
 */
async function apiKey() {
  if (process.env.DEMODOG_MCP_KEY) return process.env.DEMODOG_MCP_KEY
  const path = join(HOME, '.demodog-mcp-key')
  if (existsSync(path)) return (await readFile(path, 'utf8')).trim()
  const key = randomBytes(24).toString('base64url')
  await writeFile(path, key + '\n', { mode: 0o600 })
  return key
}

/** Constant time, so the key cannot be recovered a byte at a time. */
function keyMatches(given, expected) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---- the work ------------------------------------------------------------

function run(command, args, env = {}) {
  return new Promise((done) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', (e) => done({ code: 1, out, err: String(e) }))
    child.on('close', (code) => done({ code, out, err }))
  })
}

async function loadSpec(name) {
  const path = join(SPECS, `${name}.json`)
  if (!existsSync(path)) throw new Error(`no walkthrough called "${name}" — create it first`)
  return JSON.parse(await readFile(path, 'utf8'))
}

async function saveSpec(name, spec) {
  await mkdir(SPECS, { recursive: true })
  const path = join(SPECS, `${name}.json`)
  await writeFile(path, JSON.stringify(spec, null, 2))
  return path
}

/** Merges an update over a spec, replacing arrays outright rather than joining. */
function apply(base, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = key in out && !Array.isArray(value) && typeof value === 'object' && value !== null
      ? apply(out[key] ?? {}, value)
      : value
  }
  return out
}

const text = (s) => ({ content: [{ type: 'text', text: s }] })

// ---- tools ---------------------------------------------------------------

const TOOLS = [
  {
    name: 'create_walkthrough',
    description: `Create a walkthrough: a polished demo video built from a screen recording plus a description of what happened in it.

Give it a video (from Playwright's recordVideo, or any screen capture) and the times and coordinates of the clicks, scrolls and moves. DemoDog reconstructs the presentation around them — it zooms in on what was clicked, draws and smooths a cursor that was never in the recording, animates the clicks, frames the whole thing on a background, and burns in captions.

The coordinates are in the video's own pixels, and the times are seconds from its first frame. Both come straight out of an automation tool: Playwright knows where it clicked and when.

Nothing is recorded here and nothing is spoken — there is no camera and no speech synthesis. Narration is captions.

Call export_walkthrough afterwards to render the mp4.`,
    inputSchema: {
      type: 'object',
      required: ['name', 'video'],
      properties: {
        name: { type: 'string', description: 'A short name to revise and export it by later.' },
        video: { type: 'string', description: 'Path to the screen recording. mp4 or webm.' },
        fps: { type: 'number', description: 'Frame rate of the recording. Defaults to 60.' },
        cursorStart: {
          type: 'object',
          description: 'Where the pointer rests before the first action, in video pixels.',
          properties: { x: { type: 'number' }, y: { type: 'number' } }
        },
        actions: {
          type: 'array',
          description:
            'What happened, in order. A click makes the camera zoom to it, so click the thing you want the viewer looking at.',
          items: {
            type: 'object',
            required: ['t', 'type'],
            properties: {
              t: { type: 'number', description: 'Seconds from the first frame.' },
              type: { type: 'string', enum: ['click', 'dblclick', 'move', 'scroll', 'app'] },
              x: { type: 'number' },
              y: { type: 'number' },
              dy: { type: 'number', description: 'Scroll distance; negative scrolls down the page.' },
              name: { type: 'string', description: 'For an "app" action: the application switched to.' }
            }
          }
        },
        captions: {
          type: 'array',
          description:
            'The narration, as timed text. Write it as someone would say it. These also drive the music ducking.',
          items: {
            type: 'object',
            required: ['start', 'end', 'text'],
            properties: {
              start: { type: 'number' },
              end: { type: 'number' },
              text: { type: 'string' }
            }
          }
        },
        intro: {
          type: 'object',
          description: 'A title card before the recording.',
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            seconds: { type: 'number' }
          }
        },
        outro: {
          type: 'object',
          description: 'A title card after it.',
          properties: {
            title: { type: 'string' },
            subtitle: { type: 'string' },
            seconds: { type: 'number' }
          }
        },
        music: {
          type: 'object',
          description:
            'A music bed. It ducks under the captions automatically when duckDb is above zero.',
          properties: {
            src: { type: 'string', description: 'Path to an mp3, wav or m4a.' },
            gain: { type: 'number', description: '0 to 1. Around 0.2 sits under narration.' },
            duckDb: { type: 'number', description: 'How far it drops while a caption is showing. 0 is off.' }
          }
        }
      }
    }
  },
  {
    name: 'update_walkthrough',
    description: `Revise a walkthrough that already exists. Pass only what changes.

Use this to retime captions, reword narration, add or remove actions, or change the music — then export again. Arrays are replaced wholesale, so send the complete list of actions or captions when changing either.`,
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        video: { type: 'string' },
        fps: { type: 'number' },
        actions: { type: 'array', items: { type: 'object' } },
        captions: { type: 'array', items: { type: 'object' } },
        intro: { type: 'object' },
        outro: { type: 'object' },
        music: { type: 'object' }
      }
    }
  },
  {
    name: 'export_walkthrough',
    description: `Render a walkthrough to an mp4 and return where it was written.

This runs the real exporter, so it takes roughly as long as the video is. The result has the zooms, the drawn cursor, the captions and the music already in it — there is no further editing step.`,
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        out: { type: 'string', description: 'Where to write the mp4. Defaults beside the walkthrough.' },
        seconds: { type: 'number', description: 'Render only the first N seconds, for a quick look.' }
      }
    }
  },
  {
    name: 'list_walkthroughs',
    description: 'List the walkthroughs that exist, with their durations and whether they have been exported.',
    inputSchema: { type: 'object', properties: {} }
  }
]

// ---- tool implementations ------------------------------------------------

function specFromArgs(args, base = {}) {
  const spec = { ...base }
  if (args.video) spec.video = expand(args.video)
  if (args.fps) spec.fps = args.fps
  if (args.cursorStart) spec.cursorStart = args.cursorStart
  if (args.actions) spec.actions = args.actions
  spec.project = { ...(base.project ?? {}) }
  if (args.captions) {
    spec.project.captions = args.captions.map((c, i) => ({
      id: c.id ?? `c${i + 1}`,
      start: c.start,
      end: c.end,
      text: c.text
    }))
  }
  for (const card of ['intro', 'outro']) {
    if (args[card]) {
      spec.project[card] = { ...(base.project?.[card] ?? {}), enabled: true, ...args[card] }
    }
  }
  if (args.music) {
    spec.project.music = {
      ...(base.project?.music ?? {}),
      ...args.music,
      ...(args.music.src ? { src: expand(args.music.src) } : {})
    }
  }
  return spec
}

async function callTool(name, args) {
  if (name === 'create_walkthrough' || name === 'update_walkthrough') {
    const creating = name === 'create_walkthrough'
    const base = creating ? {} : await loadSpec(args.name)
    const spec = creating ? specFromArgs(args) : apply(base, specFromArgs(args, base))
    if (!spec.video) throw new Error('a video is required')
    if (!existsSync(spec.video)) throw new Error(`no video at ${spec.video}`)
    spec.out = join(SPECS, `${args.name}.demodog`)
    spec.export = join(SPECS, `${args.name}.mp4`)
    const path = await saveSpec(args.name, spec)
    return text(
      `${creating ? 'Created' : 'Updated'} "${args.name}".\n` +
        `  actions:  ${spec.actions?.length ?? 0}\n` +
        `  captions: ${spec.project?.captions?.length ?? 0}\n` +
        `  spec:     ${path}\n\n` +
        `Call export_walkthrough with name "${args.name}" to render it.`
    )
  }

  if (name === 'export_walkthrough') {
    const spec = await loadSpec(args.name)
    if (args.out) spec.export = expand(args.out)
    if (args.seconds) spec.seconds = args.seconds
    const path = await saveSpec(args.name, spec)
    const result = await run('node', ['scripts/walkthrough.mjs', path])
    if (result.code !== 0 || !existsSync(spec.export)) {
      throw new Error(`the render failed:\n${(result.err || result.out).split('\n').slice(-8).join('\n')}`)
    }
    return text(`Rendered "${args.name}" to ${spec.export}`)
  }

  if (name === 'list_walkthroughs') {
    if (!existsSync(SPECS)) return text('No walkthroughs yet.')
    const { readdir, stat } = await import('node:fs/promises')
    const names = (await readdir(SPECS)).filter((f) => f.endsWith('.json'))
    if (!names.length) return text('No walkthroughs yet.')
    const lines = []
    for (const file of names) {
      const spec = JSON.parse(await readFile(join(SPECS, file), 'utf8'))
      const exported = spec.export && existsSync(spec.export)
      const size = exported ? `${Math.round((await stat(spec.export)).size / 1e6)} MB` : 'not exported'
      lines.push(`  ${file.replace(/\.json$/, '')} — ${spec.actions?.length ?? 0} actions, ${size}`)
    }
    return text(lines.join('\n'))
  }

  throw new Error(`unknown tool ${name}`)
}

// ---- transport -----------------------------------------------------------

const KEY = await apiKey()
const PORT = Number(process.env.DEMODOG_MCP_PORT ?? 8787)

const rpc = async (message) => {
  const { id, method, params } = message
  const reply = (result) => ({ jsonrpc: '2.0', id, result })

  if (method === 'initialize') {
    return reply({
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'demodog', version: '1.0.0' }
    })
  }
  if (method === 'tools/list') return reply({ tools: TOOLS })
  if (method === 'tools/call') {
    try {
      return reply(await callTool(params.name, params.arguments ?? {}))
    } catch (error) {
      // Reported as a tool error rather than a protocol one, so the model sees
      // the message and can correct itself instead of the call simply failing.
      return reply({ content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true })
    }
  }
  if (method?.startsWith('notifications/')) return null
  return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${method}` } }
}

const server = createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  const given = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
  if (!keyMatches(given, KEY)) {
    return send(401, { error: 'unauthorized' })
  }
  if (req.method !== 'POST') return send(405, { error: 'post only' })

  let body = ''
  req.on('data', (d) => {
    body += d
    // A bounded read: this is a local tool, not a file upload endpoint.
    if (body.length > 4_000_000) req.destroy()
  })
  req.on('end', async () => {
    let message
    try {
      message = JSON.parse(body)
    } catch {
      return send(400, { jsonrpc: '2.0', error: { code: -32700, message: 'bad json' } })
    }
    const result = await rpc(message)
    if (result === null) {
      res.writeHead(202).end()
      return
    }
    send(200, result)
  })
})

// Loopback only. Binding to every interface would put a file-writing,
// process-spawning endpoint on the network behind one shared secret.
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  DemoDog MCP server`)
  console.log(`  url:  http://127.0.0.1:${PORT}`)
  console.log(`  key:  ${KEY}`)
  console.log(`\n  Send it as: Authorization: Bearer <key>`)
  console.log(`  The key is kept in ~/.demodog-mcp-key; delete it to roll a new one.\n`)
})
