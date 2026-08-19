# Authoring walkthroughs

DemoDog can build a finished demo video without recording one. A take is only
ever a video, a stream of input events on a shared clock, and some geometry —
and nothing in the engine cares whether a human produced them. So a browser
driven by Playwright, plus a list of what it clicked and when, becomes a take
and gets the automatic zoom, the smoothed cursor, the click animation and the
captions for free.

No camera, and no speech: narration is captions.

## By hand

```bash
npm run walkthrough -- walkthrough.json
```

```json
{
  "video": "run.webm",
  "fps": 30,
  "cursorStart": { "x": 640, "y": 700 },
  "actions": [
    { "t": 1.2, "type": "click",  "x": 310, "y": 345 },
    { "t": 3.0, "type": "scroll", "x": 640, "y": 500, "dy": -400 },
    { "t": 5.0, "type": "click",  "x": 890, "y": 345 }
  ],
  "project": {
    "captions": [{ "id": "c1", "start": 0.8, "end": 2.6, "text": "Start a trial here." }],
    "intro": { "enabled": true, "seconds": 1.5, "title": "Getting started" },
    "music": { "src": "~/Music/bed.mp3", "gain": 0.2, "duckDb": 12 }
  }
}
```

Coordinates are in the video's own pixels; times are seconds from its first
frame. Both come straight out of an automation tool.

`npm run author` stops after building the take, if you would rather open it in
the app and adjust it by hand before exporting.

## From Playwright

Playwright already knows every coordinate and timestamp. Record the video and
collect the actions as you go:

```js
const actions = []
const started = Date.now()
const at = () => (Date.now() - started) / 1000

const context = await browser.newContext({
  recordVideo: { dir: 'out/', size: { width: 1280, height: 800 } }
})
const page = await context.newPage()

async function click(selector) {
  const box = await page.locator(selector).boundingBox()
  actions.push({ t: at(), type: 'click', x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await page.locator(selector).click()
}

await page.goto('https://example.com/pricing')
await click('text=Start trial')
await context.close()          // flushes the video
```

Then write `{ video, actions, project }` to a spec and run it.

The one thing worth knowing: Playwright teleports the pointer, so the action
list has positions but no path between them. The author invents one — eased,
sampled at the rate a real pointer is, with a little tremor — because the
engine's smoothing can only smooth samples it is given, and two points read as
a snap.

## From a model, over MCP

```bash
npm run mcp
```

It prints a URL and a key, and serves on the loopback interface only. The key
is generated once and kept in `~/.demodog-mcp-key`; delete that file to roll a
new one, or set `DEMODOG_MCP_KEY` to choose your own. Send it as
`Authorization: Bearer <key>`.

Four tools: `create_walkthrough`, `update_walkthrough`, `export_walkthrough`,
`list_walkthroughs`. Specs are kept in `~/Movies/DemoDog/walkthroughs`, so a
model can revise one across several turns and export when it is happy.

The authentication is not ceremony. The server writes files and spawns
processes on request, and a local model runs as an ordinary user process — so
anything it can reach, any other program on the machine can reach too,
including a page in a browser.
