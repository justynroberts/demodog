// MIT License - Copyright (c) fintonlabs.com
const { app, BrowserWindow, ipcMain } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')

const OUT = process.env.PROBE_OUT
app.disableHardwareAcceleration()

app.whenReady().then(() => {
  // Shown, and small. A hidden window is throttled by Chromium, and a canvas
  // that is not being composited produces frames at whatever rate it likes —
  // which would measure the throttle rather than the recorder.
  const win = new BrowserWindow({
    width: 360,
    height: 300,
    x: 20,
    y: 20,
    show: true,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
  })
  win.loadFile(join(__dirname, 'probe.html'))
  ipcMain.on('probe:done', (_e, payload) => {
    writeFileSync(`${OUT}.mp4`, Buffer.from(payload.data))
    writeFileSync(`${OUT}.json`, JSON.stringify({ ...payload, data: undefined }, null, 2))
    app.exit(0)
  })
  ipcMain.on('probe:failed', (_e, why) => {
    console.error('probe failed:', why)
    app.exit(3)
  })
  setTimeout(() => {
    console.error('probe timed out')
    app.exit(3)
  }, 60000)
})
