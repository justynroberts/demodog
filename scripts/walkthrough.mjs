// MIT License - Copyright (c) fintonlabs.com
/**
 * Spec in, finished video out.
 *
 * Authors a take from the description, then renders it through the same
 * exporter the app uses — headlessly, so it runs with no window, no focus
 * stolen and no human. That is the whole point: a walkthrough that can be
 * regenerated when the product it describes changes.
 *
 *     npm run walkthrough -- walkthrough.json
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { author } from './author.mjs'

const expand = (p) => (p.startsWith('~') ? join(homedir(), p.slice(1)) : resolve(p))

const specPath = process.argv[2]
if (!specPath) {
  console.error('usage: npm run walkthrough -- <spec.json>')
  process.exit(2)
}

const resolved = expand(specPath)
const spec = JSON.parse(await readFile(resolved, 'utf8'))

console.log('\n  authoring the take…')
const take = await author(spec, dirname(resolved))
console.log(`  ${take.events} events over ${take.duration.toFixed(1)}s`)

const output = expand(spec.export ?? spec.out?.replace(/\.demodog$/, '.mp4') ?? 'walkthrough.mp4')
const work = await mkdtemp(join(tmpdir(), 'demodog-walk-'))
const settings = join(work, 'project.json')
await writeFile(settings, JSON.stringify(spec.project ?? {}))

console.log('  rendering…')
const code = await new Promise((done) => {
  const child = spawn('npx', ['electron', '.'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      DEMODOG_BENCH: take.dir,
      DEMODOG_BENCH_OUT: output,
      DEMODOG_BENCH_PROJECT: settings,
      ...(spec.seconds ? { DEMODOG_BENCH_SECONDS: String(spec.seconds) } : {})
    }
  })
  let err = ''
  child.stderr.on('data', (d) => (err += d))
  child.on('close', (c) => {
    if (c !== 0) process.stderr.write(err.split('\n').slice(-6).join('\n') + '\n')
    done(c)
  })
})

if (code !== 0 || !existsSync(output)) {
  console.error('\n  the render failed\n')
  process.exit(1)
}
console.log(`\n  ${output}\n`)
