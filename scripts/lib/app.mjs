// MIT License - Copyright (c) fintonlabs.com
/**
 * Drives the real app for a test, over DevTools-on-a-pipe.
 *
 * A pipe rather than `--remote-debugging-port`, for two reasons: it needs no
 * loopback interface, which is not guaranteed to exist on a machine that has
 * been doing network work; and nothing on the network can reach it.
 */
import { spawn } from 'child_process'
import { join } from 'path'
import { fileURLToPath } from 'url'

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Launches the editor on a take and attaches to its window. */
export async function openEditor(takeDir, { width = 1500, height = 950 } = {}) {
  const bin = join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const child = spawn(bin, ['.', '--remote-debugging-pipe'], {
    cwd: ROOT,
    env: { ...process.env, DEMODOG_OPEN: takeDir },
    stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe']
  })
  const [, , , toBrowser, fromBrowser] = child.stdio
  let buffered = Buffer.alloc(0)
  let id = 0
  const waiting = new Map()
  fromBrowser.on('data', (chunk) => {
    buffered = Buffer.concat([buffered, chunk])
    let at
    while ((at = buffered.indexOf(0)) !== -1) {
      const message = JSON.parse(buffered.subarray(0, at).toString())
      buffered = buffered.subarray(at + 1)
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)(message)
        waiting.delete(message.id)
      }
    }
  })
  const rpc = (method, params = {}, sessionId) =>
    new Promise((resolve) => {
      const next = ++id
      waiting.set(next, resolve)
      toBrowser.write(JSON.stringify({ id: next, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0')
    })

  await sleep(4500)
  const targets = (await rpc('Target.getTargets')).result?.targetInfos ?? []
  const studio = targets.find((t) => t.url.includes('#/studio'))
  if (!studio) {
    child.kill()
    throw new Error('the studio window never opened')
  }
  const session = (await rpc('Target.attachToTarget', { targetId: studio.targetId, flatten: true })).result.sessionId
  const call = (method, params) => rpc(method, params, session)
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })

  const app = {
    child,
    call,
    close: () => child.kill(),
    async eval(expression) {
      const r = (await call('Runtime.evaluate', { expression, returnByValue: true })).result
      if (r?.exceptionDetails) console.log('    ', r.exceptionDetails.exception?.description?.split('\n')[0])
      return r?.result?.value
    },
    async ready(selector = '.zoom-block', tries = 60) {
      for (let i = 0; i < tries; i++) {
        if (await app.eval(`document.querySelectorAll('${selector}').length`)) return true
        await sleep(500)
      }
      return false
    },
    rect: async (selector) =>
      JSON.parse(await app.eval(`JSON.stringify(document.querySelector('${selector}').getBoundingClientRect())`)),
    key: async (code, { meta = false, shift = false, alt = false, key } = {}) => {
      const modifiers = (alt ? 1 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0)
      for (const type of ['keyDown', 'keyUp']) {
        await call('Input.dispatchKeyEvent', { type, modifiers, code, key: key ?? code, windowsVirtualKeyCode: 0 })
      }
      await sleep(350)
    },
    wheel: (x, y, { deltaX = 0, deltaY = 0, alt = false } = {}) =>
      call('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY, modifiers: alt ? 1 : 0 }),
    drag: async (from, to, { alt = false, steps = 10 } = {}) => {
      const modifiers = alt ? 1 : 0
      await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1, modifiers })
      for (let i = 1; i <= steps; i++) {
        await call('Input.dispatchMouseEvent', {
          type: 'mouseMoved', button: 'left', buttons: 1, modifiers,
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps
        })
        await sleep(12)
      }
      await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1, modifiers })
      await sleep(250)
    },
    /**
     * Where a moment sits on screen, read off the ruler itself.
     *
     * Derived from the rendered marks rather than from the component's own
     * arithmetic, so a test cannot agree with a bug by using the same maths.
     */
    async mapping() {
      // In viewport coordinates, like every pointer event: the marks are
      // positioned within the lane stack, and mixing the two spaces silently
      // shifts every reading by the timeline's left padding.
      const marks = JSON.parse(await app.eval(`JSON.stringify((() => { const origin = document.querySelector('.track-stack').getBoundingClientRect().left; return [...document.querySelectorAll('.rule.major')].map((r) => ({ left: origin + parseFloat(r.style.left), label: r.querySelector('i')?.textContent })) })())`))
      const seconds = (label) => {
        if (!label) return null
        if (label.endsWith('s')) return parseFloat(label)
        const [m, s] = label.split(':')
        return Number(m) * 60 + Number(s)
      }
      const known = marks.map((m) => ({ x: m.left, t: seconds(m.label) })).filter((m) => m.t !== null)
      if (known.length < 2) throw new Error('not enough labelled marks to read the ruler')
      const first = known[0]
      const last = known[known.length - 1]
      const perPixel = (last.t - first.t) / (last.x - first.x)
      return {
        timeAt: (x) => first.t + (x - first.x) * perPixel,
        xOf: (t) => first.x + (t - first.t) / perPixel,
        perPixel
      }
    }
  }
  return app
}
