"use strict";
const electron = require("electron");
const node_path = require("node:path");
const node_url = require("node:url");
const node_fs = require("node:fs");
const electronUpdater = require("electron-updater");
const node_crypto = require("node:crypto");
const node_child_process = require("node:child_process");
const promises = require("node:fs/promises");
const node_util = require("node:util");
const node_stream = require("node:stream");
const { autoUpdater } = electronUpdater;
const logPath = node_path.join(electron.app.getPath("logs"), "updater.log");
function note(message) {
  const line = `${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`;
  try {
    node_fs.mkdirSync(electron.app.getPath("logs"), { recursive: true });
    node_fs.appendFileSync(logPath, line);
  } catch {
  }
  console.log(`[update] ${message}`);
}
autoUpdater.logger = {
  info: (m) => note(`info  ${String(m)}`),
  warn: (m) => note(`warn  ${String(m)}`),
  error: (m) => note(`error ${String(m)}`),
  debug: (m) => note(`debug ${String(m)}`)
};
const FIRST_CHECK_DELAY = 8e3;
const RECHECK_INTERVAL = 2 * 60 * 60 * 1e3;
const MIN_GAP = 20 * 60 * 1e3;
let busy = false;
function setupUpdates(window, isRecording) {
  if (!electron.app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("update-downloaded", (info) => {
    if (busy) return;
    busy = true;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    void electron.dialog.showMessageBox(window, {
      type: "info",
      message: `DemoDog ${info.version} is ready to install`,
      detail: "DemoDog will close, swap itself for the new version, and reopen. It stays closed for about ten seconds in the middle — that gap is the installer working, not a crash.\n\nAnything you have recorded is saved and will still be there afterwards.",
      buttons: ["Restart now", "Later", "What's new"],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      busy = false;
      if (result.response === 0) {
        note("user chose to restart; calling quitAndInstall");
        try {
          autoUpdater.quitAndInstall(false, true);
        } catch (error) {
          note(`quitAndInstall threw: ${String(error)}`);
        }
        setTimeout(() => {
          note("still running after quitAndInstall");
          void electron.dialog.showMessageBox(window, {
            type: "warning",
            message: "The update could not be installed",
            detail: `DemoDog is still running ${info.version} rather than restarting, so the update did not take effect.

Downloading it by hand always works, and takes about a minute.`,
            // A way out, not a diagnosis. Telling someone to read a log file
            // is telling them to give up politely; the point of this dialog
            // is that they end up on the new version either way.
            buttons: ["Download it manually", "Show me the log", "Not now"],
            defaultId: 0,
            cancelId: 2
          }).then((choice) => {
            if (choice.response === 0) {
              void electron.shell.openExternal(
                "https://github.com/justynroberts/demodog/releases/latest"
              );
            } else if (choice.response === 1) {
              electron.shell.showItemInFolder(logPath);
            }
          });
        }, 25e3);
      } else if (result.response === 2) {
        void electron.shell.openExternal(
          `https://github.com/justynroberts/demodog/releases/tag/v${info.version}`
        );
      }
    });
  });
  autoUpdater.on("error", (error) => {
    note(`check failed: ${error.message}`);
  });
  autoUpdater.on("update-available", (info) => note(`update available: ${info.version}`));
  autoUpdater.on("update-not-available", () => note("no update available"));
  autoUpdater.on("download-progress", (p) => note(`downloading ${Math.round(p.percent)}%`));
  let lastCheck = 0;
  const check = () => {
    if (isRecording()) return;
    const now = Date.now();
    if (now - lastCheck < MIN_GAP) return;
    lastCheck = now;
    autoUpdater.checkForUpdates().catch(() => void 0);
  };
  setTimeout(check, FIRST_CHECK_DELAY);
  setInterval(check, RECHECK_INTERVAL);
  window.on("focus", check);
}
async function checkForUpdatesNow(window) {
  if (!electron.app.isPackaged) {
    await electron.dialog.showMessageBox(window, {
      type: "info",
      message: "Running from source",
      detail: "Updates only apply to an installed copy of DemoDog.",
      buttons: ["OK"]
    });
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || result.updateInfo.version === electron.app.getVersion()) {
      await electron.dialog.showMessageBox(window, {
        type: "info",
        message: "DemoDog is up to date",
        detail: `You are running ${electron.app.getVersion()}.`,
        buttons: ["OK"]
      });
    }
  } catch (error) {
    await electron.dialog.showMessageBox(window, {
      type: "warning",
      message: "Could not check for updates",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"]
    });
  }
}
const BUNDLE_ID = "com.fintonlabs.demodog";
function installMenu(window) {
  const template = [
    {
      label: electron.app.name,
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          click: () => {
            const target = window();
            if (target) void checkForUpdatesNow(target);
          }
        },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [{ role: "close" }]
    },
    {
      // Without this the standard shortcuts simply do not exist.
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "togglefullscreen" }]
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }]
    },
    {
      role: "help",
      submenu: [
        {
          label: "Releases and Downloads",
          click: () => void electron.shell.openExternal("https://github.com/justynroberts/demodog/releases")
        },
        {
          label: "Reveal Update Log",
          click: () => electron.shell.showItemInFolder(`${electron.app.getPath("logs")}/updater.log`)
        },
        {
          // Squirrel's own log, which is the one that says where an update was
          // actually installed to. Both are buried in a hidden folder that
          // cannot be browsed to, so asking someone to find them by hand means
          // walking them through Go to Folder every time.
          label: "Reveal Installer Log",
          click: () => electron.shell.showItemInFolder(
            `${electron.app.getPath("home")}/Library/Caches/${BUNDLE_ID}.ShipIt/ShipIt_stderr.log`
          )
        }
      ]
    }
  ];
  electron.Menu.setApplicationMenu(electron.Menu.buildFromTemplate(template));
}
const MEASUREMENT_ID = process.env["DEMODOG_GA_ID"] ?? "";
const API_SECRET = process.env["DEMODOG_GA_SECRET"] ?? "";
const ENDPOINT = "https://www.google-analytics.com/mp/collect";
function statePath() {
  return node_path.join(electron.app.getPath("userData"), "analytics.json");
}
let cached = null;
function state() {
  if (cached) return cached;
  try {
    if (node_fs.existsSync(statePath())) {
      const parsed = JSON.parse(node_fs.readFileSync(statePath(), "utf8"));
      if (parsed.clientId) {
        cached = { clientId: parsed.clientId, enabled: parsed.enabled === true };
        return cached;
      }
    }
  } catch {
  }
  cached = { clientId: node_crypto.randomUUID(), enabled: false };
  save();
  return cached;
}
function save() {
  try {
    node_fs.writeFileSync(statePath(), JSON.stringify(cached, null, 2));
  } catch {
  }
}
function analyticsEnabled() {
  return state().enabled;
}
function setAnalyticsEnabled(enabled) {
  cached = { ...state(), enabled };
  save();
}
function analyticsConfigured() {
  return !!MEASUREMENT_ID && !!API_SECRET;
}
async function track(name, params = {}) {
  if (!analyticsConfigured()) return;
  const current = state();
  if (!current.enabled) return;
  const body = JSON.stringify({
    client_id: current.clientId,
    // No user_id: there is no account here, and inventing a stable identity for
    // someone who never signed up is not something to do quietly.
    events: [
      {
        name,
        params: {
          ...params,
          app_version: electron.app.getVersion(),
          // GA4 drops events with no engagement signal from a non-web client.
          engagement_time_msec: 1,
          session_id: sessionId
        }
      }
    ]
  });
  try {
    const request = electron.net.request({
      method: "POST",
      url: `${ENDPOINT}?measurement_id=${encodeURIComponent(MEASUREMENT_ID)}&api_secret=${encodeURIComponent(API_SECRET)}`
    });
    await new Promise((resolve) => {
      const done = () => resolve();
      request.on("response", (response) => {
        response.on("data", () => {
        });
        response.on("end", done);
        response.on("error", done);
      });
      request.on("error", done);
      request.setHeader("Content-Type", "application/json");
      request.write(body);
      request.end();
      setTimeout(done, 4e3);
    });
  } catch {
  }
}
const sessionId = String(Date.now());
const run = node_util.promisify(node_child_process.execFile);
const RECIPIENT = "justynroberts@gmail.com";
async function collectDiagnostics(note2) {
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folder = node_path.join(electron.app.getPath("temp"), `demodog-report-${stamp}`);
  await promises.mkdir(folder, { recursive: true });
  const lines = [];
  const add = (label, value) => {
    lines.push(`${label}: ${value}`);
  };
  add("App", `DemoDog ${electron.app.getVersion()}`);
  add("macOS", `${process.getSystemVersion?.() ?? "unknown"} (${process.arch})`);
  add("Electron", process.versions.electron);
  add("Packaged", String(electron.app.isPackaged));
  for (const service of ["ScreenCapture", "Microphone", "Camera", "SpeechRecognition"]) {
    try {
      const { stdout } = await run("/usr/bin/log", [
        "show",
        "--last",
        "1m",
        "--style",
        "compact",
        "--predicate",
        `subsystem == "com.apple.TCC" AND composedMessage CONTAINS "${service}"`
      ]);
      add(`TCC ${service}`, stdout.trim() ? "recent activity" : "no recent activity");
    } catch {
      add(`TCC ${service}`, "not readable");
    }
  }
  const summary = [...lines, "", "What happened:", note2.trim() || "(not described)"].join("\n");
  await promises.writeFile(node_path.join(folder, "summary.txt"), summary, "utf8");
  const updaterLog = node_path.join(electron.app.getPath("logs"), "updater.log");
  if (node_fs.existsSync(updaterLog)) {
    const text = await promises.readFile(updaterLog, "utf8");
    await promises.writeFile(node_path.join(folder, "updater.log"), text.slice(-2e5), "utf8");
  }
  const takes = node_path.join(electron.app.getPath("videos"), "DemoDog");
  if (node_fs.existsSync(takes)) {
    const recent = node_fs.readdirSync(takes).filter((name) => name.endsWith(".demodog")).map((name) => ({ name, at: node_fs.statSync(node_path.join(takes, name)).mtimeMs })).sort((a, b) => b.at - a.at).slice(0, 3);
    for (const take of recent) {
      const meta = node_path.join(takes, take.name, "meta.json");
      if (node_fs.existsSync(meta)) {
        await promises.writeFile(node_path.join(folder, `${take.name}.meta.json`), await promises.readFile(meta, "utf8"));
      }
    }
  }
  const zip = node_path.join(electron.app.getPath("temp"), `demodog-report-${stamp}.zip`);
  await run("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", folder, zip]);
  await promises.rm(folder, { recursive: true, force: true });
  return { zip, body: summary };
}
async function sendBugReport(note2) {
  const { zip, body } = await collectDiagnostics(note2);
  const subject = `DemoDog ${electron.app.getVersion()} — bug report`;
  const instructions = `

---
The diagnostics file has been revealed in Finder — please drag ${zip.split("/").pop()} onto this message before sending.

`;
  const url = `mailto:${RECIPIENT}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(instructions + body)}`;
  electron.shell.showItemInFolder(zip);
  await electron.shell.openExternal(url);
  return zip;
}
function clearQuarantine() {
  if (process.platform !== "darwin" || !electron.app.isPackaged) return;
  const bundle = node_path.dirname(node_path.dirname(node_path.dirname(electron.app.getPath("exe"))));
  if (!bundle.endsWith(".app")) return;
  try {
    node_child_process.execFileSync("xattr", ["-p", "com.apple.quarantine", bundle], { stdio: "ignore" });
  } catch {
    return;
  }
  node_child_process.execFile("xattr", ["-dr", "com.apple.quarantine", bundle], (error) => {
    console.log(
      error ? `[quarantine] could not clear it: ${error.message}` : "[quarantine] cleared; updates can install"
    );
  });
}
function helperPath() {
  const packaged = node_path.join(process.resourcesPath ?? "", "bin", "demodog-recorder");
  if (electron.app.isPackaged && node_fs.existsSync(packaged)) return packaged;
  return node_path.join(electron.app.getAppPath(), "bin", "demodog-recorder");
}
function reapStrayHelpers() {
  try {
    node_child_process.spawnSync("pkill", ["-f", helperPath()], { stdio: "ignore" });
  } catch {
  }
}
function describeError(message, code, errorCode) {
  if (errorCode === -3805 || code === "stream-stopped") {
    return "Screen capture was interrupted by macOS. This usually means another recorder is holding the screen, or a previous capture did not shut down cleanly. Quit other screen recorders and try again.";
  }
  if (code === "no-permission") {
    return "Screen Recording permission has not been granted to DemoDog.";
  }
  if (code === "timeout") {
    return "macOS did not respond to the capture request in time. Try again.";
  }
  return message;
}
const inFlight = /* @__PURE__ */ new Map();
function runOnceShared(args) {
  const key = args.join(" ");
  const existing = inFlight.get(key);
  if (existing) return existing;
  const promise = runOnce(args).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
function runOnce(args) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(helperPath(), args);
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => out += d);
    child.stderr.on("data", (d) => err += d);
    child.on("error", reject);
    child.on("close", () => {
      const lines = out.trim().split("\n").filter(Boolean);
      const last = lines[lines.length - 1];
      if (!last) return reject(new Error(err || "recorder helper produced no output"));
      try {
        resolve(JSON.parse(last));
      } catch {
        reject(new Error(`unparseable helper output: ${last}`));
      }
    });
  });
}
async function listSources() {
  const result = await runOnceShared(["list"]);
  if (result.event === "error") {
    throw Object.assign(
      new Error(describeError(String(result.message), result.code, result.errorCode)),
      { code: result.code }
    );
  }
  return { displays: result.displays, windows: result.windows };
}
async function checkPermissions(request = false) {
  const args = request ? ["permissions", "--request"] : ["permissions"];
  const result = await runOnceShared(args);
  return {
    screenRecording: Boolean(result.screenRecording),
    accessibility: Boolean(result.accessibility)
  };
}
function openPrivacySettings(kind) {
  const panes = {
    screen: "Privacy_ScreenCapture",
    accessibility: "Privacy_Accessibility",
    camera: "Privacy_Camera",
    microphone: "Privacy_Microphone"
  };
  node_child_process.spawn("open", [`x-apple.systempreferences:com.apple.preference.security?${panes[kind]}`]);
}
class RecorderProcess {
  child = null;
  dir;
  startedAt = null;
  stopPromise = null;
  constructor(dir) {
    this.dir = dir;
  }
  get outputDir() {
    return this.dir;
  }
  /** Resolves once the helper confirms the first frame is flowing. */
  start(options) {
    const args = ["record", "--out", this.dir, "--fps", String(options.fps)];
    if (options.displayId !== void 0) args.push("--display", String(options.displayId));
    if (options.windowId !== void 0) args.push("--window", String(options.windowId));
    args.push("--audio", options.systemAudio ? "1" : "0");
    args.push("--keys", options.trackKeystrokes ? "1" : "0");
    args.push("--cursor", "0");
    args.push("--exclude-pids", String(process.pid));
    if (options.maxWidth) args.push("--max-width", String(options.maxWidth));
    const child = node_child_process.spawn(helperPath(), args);
    this.child = child;
    return new Promise((resolve, reject) => {
      let buffer = "";
      const onData = (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (msg.event === "started") {
            this.startedAt = {
              wallClock: Number(msg.startWallClock),
              host: Number(msg.startHost)
            };
            resolve({
              width: Number(msg.width),
              height: Number(msg.height),
              startWallClock: Number(msg.startWallClock)
            });
          } else if (msg.event === "error") {
            const text = describeError(String(msg.message), msg.code, msg.errorCode);
            if (this.startedAt) console.error("[recorder]", text);
            else reject(new Error(text));
          }
        }
      };
      child.stdout.on("data", onData);
      child.on("error", reject);
      child.on("close", (code) => {
        if (!this.startedAt) reject(new Error(`recorder exited with code ${code}`));
      });
    });
  }
  /**
   * Asks the helper to finalise. The movie header is only written during
   * teardown, so this must complete before the files are read.
   */
  stop() {
    if (this.stopPromise) return this.stopPromise;
    const child = this.child;
    if (!child) return Promise.reject(new Error("recorder is not running"));
    this.stopPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
      }, 1e4);
      child.on("close", async () => {
        clearTimeout(timeout);
        try {
          resolve(await this.collect());
        } catch (error) {
          reject(error);
        }
      });
      child.stdin.write("stop\n");
    });
    return this.stopPromise;
  }
  /** Reads the finalised artefacts off disk into a single object. */
  async collect() {
    const meta = JSON.parse(await promises.readFile(node_path.join(this.dir, "meta.json"), "utf8"));
    const raw = await promises.readFile(node_path.join(this.dir, "events.jsonl"), "utf8");
    const events = raw.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    return {
      dir: this.dir,
      meta,
      events,
      screenPath: node_path.join(this.dir, "screen.mp4"),
      duration: meta.duration
    };
  }
}
function transcribe(audioPath, locale, onProgress) {
  return new Promise((resolve, reject) => {
    const child = node_child_process.spawn(helperPath(), ["transcribe", "--audio", audioPath, "--locale", locale]);
    let diagnostics = "";
    child.stderr.on("data", (chunk) => {
      diagnostics += chunk.toString();
      if (diagnostics.length > 4e3) diagnostics = diagnostics.slice(-4e3);
    });
    const cues = [];
    let buffered = "";
    let failure = null;
    child.stdout.on("data", (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.event === "cue") {
          cues.push({
            start: Number(message.start),
            end: Number(message.end),
            text: String(message.text),
            confidence: Number(message.confidence)
          });
        } else if (message.event === "progress") {
          const of = Number(message.of);
          if (of > 0) onProgress(Math.min(1, Number(message.seconds) / of));
        } else if (message.event === "error") {
          failure = new Error(
            describeTranscribeError(String(message.code), String(message.message))
          );
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (failure) {
        reject(failure);
      } else if (cues.length === 0 && (signal || code !== 0 && code !== null)) {
        console.error(`[transcribe] helper exited ${signal ?? code}: ${diagnostics.trim()}`);
        reject(
          new Error(
            `Transcription stopped unexpectedly (${signal ?? `exit ${code}`}). ` + (diagnostics.trim() || "No further detail was reported.")
          )
        );
      } else {
        resolve(cues);
      }
    });
  });
}
function describeTranscribeError(code, message) {
  switch (code) {
    case "denied":
      return "macOS has not granted DemoDog permission to recognise speech. Enable DemoDog under Privacy & Security → Speech Recognition.";
    case "no-on-device":
      return "This Mac has no on-device speech model for that language. Add the language under System Settings → General → Language & Region, then try again. Transcription never uploads your recording.";
    case "missing":
      return "That take has no audio to transcribe.";
    case "empty":
      return "The audio in that take is empty.";
    default:
      return message;
  }
}
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "rec",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  }
]);
let splashWindow = null;
let splashShownAt = 0;
let studioWindow = null;
const SPLASH_MIN_MS = 2600;
let barWindow = null;
let recorder = null;
let cameraStream = null;
let cameraMeta = null;
let barReady = Promise.resolve();
let markBarReady = () => {
};
const isDev = !electron.app.isPackaged;
const mediaRoots = /* @__PURE__ */ new Set();
function allowMediaPath(target) {
  mediaRoots.add(node_path.resolve(target));
}
function isMediaPathAllowed(target) {
  const candidate = node_path.resolve(target);
  for (const root of mediaRoots) {
    if (candidate === root || candidate.startsWith(root + node_path.sep)) return true;
  }
  return false;
}
const permittedWrites = /* @__PURE__ */ new Set();
const permittedFolders = /* @__PURE__ */ new Set();
function openExternally(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { action: "deny" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    console.warn(`[shell] refused to open ${parsed.protocol} URL`);
    return { action: "deny" };
  }
  void electron.shell.openExternal(parsed.toString());
  return { action: "deny" };
}
function rendererURL(hash) {
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  if (isDev && devServer) return `${devServer}#${hash}`;
  return `${node_url.pathToFileURL(node_path.join(__dirname, "../renderer/index.html")).toString()}#${hash}`;
}
function createSplashWindow() {
  splashWindow = new electron.BrowserWindow({
    width: 460,
    height: 320,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    center: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  splashWindow.once("ready-to-show", () => {
    splashShownAt = Date.now();
    splashWindow?.showInactive();
  });
  splashWindow.on("closed", () => splashWindow = null);
  splashWindow.loadURL(rendererURL("/splash"));
}
function dismissSplash() {
  if (!splashWindow) return Promise.resolve();
  const elapsed = Date.now() - (splashShownAt || Date.now());
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
  return new Promise((resolve) => {
    setTimeout(() => {
      if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy();
      splashWindow = null;
      resolve();
    }, wait);
  });
}
function createStudioWindow() {
  studioWindow = new electron.BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: "#0d0d0f",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      // The preload only uses contextBridge and ipcRenderer, both of which
      // work in a sandboxed renderer.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // An export is minutes of work that must survive the user switching
      // away. Chromium clamps timers in a hidden window to about one a second,
      // and both the decode read loop and the encoder's backpressure yield are
      // built on short timers — so throttling does not slow an export down, it
      // stops it. This is also why the headless benchmark could not measure
      // anything real.
      backgroundThrottling: false
    }
  });
  const headless = Boolean(process.env["DEMODOG_BENCH"]);
  const reveal = async () => {
    if (headless) return;
    await dismissSplash();
    studioWindow?.show();
  };
  studioWindow.on("ready-to-show", () => void reveal());
  studioWindow.webContents.once("did-finish-load", () => {
    if (pendingOpen) {
      const path = pendingOpen;
      pendingOpen = null;
      void deliverTake(path);
    }
  });
  studioWindow.webContents.on("did-finish-load", () => void reveal());
  studioWindow.webContents.on("did-fail-load", (_e, code, description, url) => {
    console.error(`[renderer] failed to load ${url}: ${description} (${code})`);
    void dismissSplash().then(() => studioWindow?.show());
  });
  studioWindow.webContents.on("console-message", (_e, level, message, line, source) => {
    console.log(`[renderer:${level}] ${message} (${source}:${line})`);
  });
  studioWindow.webContents.on(
    "render-process-gone",
    (_e, details) => console.error("[renderer] gone", details)
  );
  studioWindow.on("closed", () => studioWindow = null);
  studioWindow.webContents.setWindowOpenHandler(({ url }) => openExternally(url));
  studioWindow.loadURL(rendererURL("/studio"));
}
function createBarWindow() {
  const display = electron.screen.getPrimaryDisplay();
  const width = 520;
  const height = 132;
  barReady = new Promise((resolve) => {
    markBarReady = resolve;
  });
  const bar = new electron.BrowserWindow({
    width,
    height,
    x: Math.round(display.workArea.x + (display.workArea.width - width) / 2),
    y: Math.round(display.workArea.y + display.workArea.height - height - 28),
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      // The preload only uses contextBridge and ipcRenderer, both of which
      // work in a sandboxed renderer.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  bar.setAlwaysOnTop(true, "screen-saver");
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.loadURL(rendererURL("/bar"));
  bar.on("closed", () => {
    barWindow = null;
    barReady = Promise.resolve();
  });
  return bar;
}
async function runCountdown(seconds, displayId) {
  if (seconds <= 0) return;
  const target = (displayId !== void 0 ? electron.screen.getAllDisplays().find((d) => d.id === displayId) : null) ?? electron.screen.getPrimaryDisplay();
  const bounds = target.bounds;
  const win = new electron.BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    show: false,
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadURL(rendererURL(`/countdown?n=${seconds}`));
  win.once("ready-to-show", () => win.showInactive());
  await new Promise((resolve) => setTimeout(resolve, seconds * 1e3 + 250));
  if (!win.isDestroyed()) win.destroy();
}
const TAKE_EXTENSION = "demodog";
function recordingDir() {
  const now = /* @__PURE__ */ new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return node_path.join(electron.app.getPath("videos"), "DemoDog", `take_${stamp}.${TAKE_EXTENSION}`);
}
electron.app.whenReady().then(() => {
  allowMediaPath(node_path.join(electron.app.getPath("videos"), "DemoDog"));
  electron.protocol.handle("rec", async (request) => {
    const url = new URL(request.url);
    const filePath = decodeURIComponent(url.pathname);
    if (!isMediaPathAllowed(filePath)) {
      console.warn(`[rec] refused ${filePath}: outside the permitted media roots`);
      return new Response("Forbidden", { status: 403 });
    }
    let size;
    try {
      size = (await promises.stat(filePath)).size;
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const type = filePath.endsWith(".webm") ? "video/webm" : filePath.endsWith(".mp4") ? "video/mp4" : "application/octet-stream";
    const asStream = (start2, end2) => node_stream.Readable.toWeb(node_fs.createReadStream(filePath, { start: start2, end: end2 }));
    const range = request.headers.get("Range");
    const match = range?.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      return new Response(asStream(0, size - 1), {
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Length": String(size),
          // Says the file can be seeked at all; without it the element does
          // not even ask for a range.
          "Accept-Ranges": "bytes"
        }
      });
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isFinite(start) || start >= size || end < start) {
      return new Response("Range not satisfiable", {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` }
      });
    }
    return new Response(asStream(start, end), {
      status: 206,
      headers: {
        "Content-Type": type,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes"
      }
    });
  });
  if (electron.app.isPackaged) {
    electron.session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            [
              "default-src 'self'",
              "script-src 'self'",
              // React and this app both set style attributes directly.
              // No font hosts: the typefaces are bundled, so the renderer has
              // no reason to reach a third party at all.
              "style-src 'self' 'unsafe-inline'",
              "font-src 'self'",
              "img-src 'self' data: blob: rec:",
              "media-src 'self' blob: rec:",
              "connect-src 'self' data: blob: rec:",
              "object-src 'none'",
              "base-uri 'none'",
              "frame-src 'none'"
            ].join("; ")
          ]
        }
      });
    });
  }
  reapStrayHelpers();
  console.log(`[demodog] ready. DEMODOG_OPEN=${process.env["DEMODOG_OPEN"] ?? "(unset)"}`);
  if (!process.env["DEMODOG_BENCH"]) createSplashWindow();
  createStudioWindow();
  clearQuarantine();
  installMenu(() => studioWindow);
  void track("app_open");
  if (studioWindow) setupUpdates(studioWindow, () => Boolean(recorder));
  electron.globalShortcut.register("CommandOrControl+Shift+2", () => {
    if (recorder) barWindow?.webContents.send("bar:request-stop");
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createStudioWindow();
  });
});
let pendingOpen = null;
async function deliverTake(path) {
  try {
    const take = await loadTake(path);
    studioWindow?.webContents.send("recording:opened", take);
    studioWindow?.show();
    studioWindow?.focus();
  } catch (error) {
    console.error("[open-file]", error);
    electron.dialog.showErrorBox("Could not open take", `${path} does not look like a DemoDog take.`);
  }
}
electron.app.on("open-file", (event, path) => {
  event.preventDefault();
  if (studioWindow && !studioWindow.webContents.isLoading()) void deliverTake(path);
  else pendingOpen = path;
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
  reapStrayHelpers();
});
electron.ipcMain.handle("sources:list", () => listSources());
electron.ipcMain.handle("sources:thumbnails", async () => {
  const displays = {};
  const windows = {};
  try {
    const sources = await electron.desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 480, height: 300 },
      fetchWindowIcons: false
    });
    for (const source of sources) {
      if (source.thumbnail.isEmpty()) continue;
      const dataURL = source.thumbnail.toDataURL();
      if (source.id.startsWith("screen:")) {
        if (source.display_id) displays[source.display_id] = dataURL;
      } else {
        const id = source.id.split(":")[1];
        if (id) windows[id] = dataURL;
      }
    }
  } catch (error) {
    console.error("[thumbnails]", error);
  }
  return { displays, windows };
});
electron.ipcMain.handle("permissions:check", () => checkPermissions(false));
electron.ipcMain.handle("permissions:request", () => checkPermissions(true));
electron.ipcMain.handle("permissions:open", (_e, kind) => openPrivacySettings(kind));
electron.ipcMain.handle("transcribe:run", async (event, dir, locale) => {
  const spoken = ["camera.mp4", "camera.webm", "screen.mp4"].map((name) => node_path.join(dir, name)).find((candidate) => node_fs.existsSync(candidate));
  if (!spoken) throw new Error("That take has no audio to transcribe.");
  const cues = await transcribe(spoken, locale, (fraction) => {
    event.sender.send("transcribe:progress", fraction);
  });
  return { cues, source: spoken.includes("camera.") ? "camera" : "screen" };
});
electron.ipcMain.handle("app:relaunch", () => {
  electron.app.relaunch();
  electron.app.exit(0);
});
electron.ipcMain.handle(
  "recording:start",
  async (_e, options) => {
    if (recorder) throw new Error("a recording is already running");
    const dir = recordingDir();
    await promises.mkdir(dir, { recursive: true });
    recorder = new RecorderProcess(dir);
    barWindow ??= createBarWindow();
    barWindow.showInactive();
    await Promise.race([barReady, new Promise((r) => setTimeout(r, 5e3))]);
    barWindow.webContents.send("bar:prepare", {
      cameraDeviceId: options.cameraDeviceId,
      micDeviceId: options.micDeviceId
    });
    studioWindow?.hide();
    await runCountdown(options.countdown ?? 0, options.displayId);
    try {
      const info = await recorder.start(options);
      barWindow.webContents.send("bar:started", info);
      return info;
    } catch (error) {
      recorder = null;
      barWindow?.hide();
      studioWindow?.show();
      throw error;
    }
  }
);
electron.ipcMain.handle(
  "recording:stop",
  async () => {
    if (!recorder) throw new Error("no recording is running");
    const active = recorder;
    recorder = null;
    const result = await active.stop();
    if (cameraStream) {
      await new Promise((resolve) => cameraStream.end(resolve));
      cameraStream = null;
    }
    barWindow?.hide();
    studioWindow?.show();
    studioWindow?.focus();
    const payload = { ...result, camera: cameraMeta };
    cameraMeta = null;
    studioWindow?.webContents.send("recording:complete", payload);
    return payload;
  }
);
electron.ipcMain.handle("recording:cancel", async () => {
  if (!recorder) return;
  const active = recorder;
  recorder = null;
  await active.stop().catch(() => void 0);
  if (cameraStream) {
    await new Promise((resolve) => cameraStream.end(resolve));
    cameraStream = null;
  }
  cameraMeta = null;
  barWindow?.hide();
  studioWindow?.show();
});
electron.ipcMain.handle("camera:open", async (_e, info) => {
  if (!recorder) throw new Error("no recording is running");
  const extension = info.mimeType.startsWith("video/mp4") ? "mp4" : "webm";
  const path = node_path.join(recorder.outputDir, `camera.${extension}`);
  cameraStream = node_fs.createWriteStream(path);
  cameraMeta = { path, startWallClock: info.startWallClock, mimeType: info.mimeType };
  await promises.writeFile(node_path.join(recorder.outputDir, "camera.json"), JSON.stringify(cameraMeta, null, 2));
  return path;
});
electron.ipcMain.handle("camera:started", async (_e, startWallClock) => {
  if (!recorder || !cameraMeta) return;
  cameraMeta = { ...cameraMeta, startWallClock };
  await promises.writeFile(node_path.join(recorder.outputDir, "camera.json"), JSON.stringify(cameraMeta, null, 2));
});
electron.ipcMain.on("camera:chunk", (_e, chunk) => {
  cameraStream?.write(Buffer.from(chunk));
});
electron.ipcMain.handle(
  "dialog:save",
  async (_e, options) => {
    const result = await electron.dialog.showSaveDialog(studioWindow, {
      defaultPath: options.defaultPath,
      filters: options.filters
    });
    if (result.canceled || !result.filePath) return null;
    permittedWrites.add(node_path.resolve(result.filePath));
    permittedFolders.add(node_path.dirname(node_path.resolve(result.filePath)));
    return result.filePath;
  }
);
electron.ipcMain.handle("file:write", async (_e, path, data) => {
  const target = node_path.resolve(path);
  if (!permittedWrites.has(target)) {
    throw new Error("refusing to write to a path the user did not choose");
  }
  permittedWrites.delete(target);
  await promises.writeFile(target, Buffer.from(data));
  return target;
});
electron.ipcMain.handle("app:version", () => electron.app.getVersion());
electron.ipcMain.handle("analytics:event", (_e, name, params) => {
  const clean = {};
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
  }
  void track(String(name).slice(0, 40), clean);
});
electron.ipcMain.handle("report:bug", async (_e, note2) => sendBugReport(String(note2 ?? "")));
electron.ipcMain.handle("analytics:enabled", () => analyticsEnabled());
electron.ipcMain.handle("analytics:set-enabled", (_e, enabled) => {
  setAnalyticsEnabled(!!enabled);
  return analyticsEnabled();
});
electron.ipcMain.handle("shell:reveal", (_e, path) => electron.shell.showItemInFolder(path));
electron.ipcMain.handle(
  "publish:youtube",
  async (_e, payload) => {
    const written = [];
    if (payload.subtitles.trim()) {
      const srt = node_path.resolve(payload.videoPath.replace(/\.mp4$/i, "") + ".srt");
      if (permittedFolders.has(node_path.dirname(srt))) {
        try {
          await promises.writeFile(srt, payload.subtitles, "utf8");
          written.push(srt);
        } catch (error) {
          console.warn(`[publish] could not write subtitles: ${String(error)}`);
        }
      }
    }
    electron.clipboard.writeText(
      payload.description.trim() ? `${payload.title}

${payload.description}` : payload.title
    );
    await electron.shell.openExternal("https://studio.youtube.com/channel/upload");
    electron.shell.showItemInFolder(payload.videoPath);
    return written;
  }
);
electron.ipcMain.handle("shell:open-external", (_e, url) => {
  openExternally(url);
});
async function loadTake(dir) {
  allowMediaPath(dir);
  const meta = JSON.parse(await promises.readFile(node_path.join(dir, "meta.json"), "utf8"));
  if (!meta.capture?.width || !meta.duration) {
    throw new Error("That take has no recorded video — it was stopped before capture started.");
  }
  const events = (await promises.readFile(node_path.join(dir, "events.jsonl"), "utf8")).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  let camera = null;
  const cameraPath = ["camera.mp4", "camera.webm"].map((name) => node_path.join(dir, name)).find((candidate) => node_fs.existsSync(candidate));
  if (cameraPath) {
    try {
      const sidecar = JSON.parse(await promises.readFile(node_path.join(dir, "camera.json"), "utf8"));
      camera = { ...sidecar, path: cameraPath };
    } catch {
      camera = { path: cameraPath, startWallClock: meta.startWallClock, mimeType: "video/mp4" };
    }
  }
  return {
    dir,
    meta,
    events,
    screenPath: node_path.join(dir, "screen.mp4"),
    duration: meta.duration,
    camera
  };
}
electron.ipcMain.handle("recording:open", async () => {
  const result = await electron.dialog.showOpenDialog(studioWindow, {
    // Both, deliberately: new takes are packages and behave like files, while
    // takes recorded before the extension existed are plain directories.
    properties: ["openFile", "openDirectory"],
    filters: [{ name: "DemoDog take", extensions: [TAKE_EXTENSION] }],
    defaultPath: node_path.join(electron.app.getPath("videos"), "DemoDog"),
    title: "Open a DemoDog take"
  });
  if (result.canceled || !result.filePaths[0]) return null;
  try {
    return await loadTake(result.filePaths[0]);
  } catch (error) {
    await electron.dialog.showMessageBox(studioWindow, {
      type: "warning",
      message: "That take could not be opened",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"]
    });
    return null;
  }
});
electron.ipcMain.handle("bench:config", () => {
  const dir = process.env["DEMODOG_BENCH"];
  if (!dir) return null;
  return {
    dir,
    out: process.env["DEMODOG_BENCH_OUT"] ?? node_path.join(dir, "bench.mp4"),
    // Cap the exported duration so a benchmark can report a rate quickly.
    seconds: Number(process.env["DEMODOG_BENCH_SECONDS"] ?? "0") || 0,
    // Export with no zoom, cursor or picture-in-picture, so the only thing that
    // can change between frames is the recording itself.
    plain: process.env["DEMODOG_BENCH_PLAIN"] === "1"
  };
});
electron.ipcMain.handle("bench:finish", async (_e, path, data) => {
  await promises.writeFile(path, Buffer.from(data));
  console.log(`[bench] wrote ${path} (${data.byteLength} bytes)`);
  electron.app.quit();
});
electron.ipcMain.handle("bench:fail", (_e, message) => {
  console.error(`[bench] failed: ${message}`);
  electron.app.exit(1);
});
electron.ipcMain.handle("recording:autoload", async () => {
  const dir = process.env["DEMODOG_BENCH"] ?? process.env["DEMODOG_OPEN"];
  if (!dir) return null;
  return loadTake(dir).catch((error) => {
    console.error("[autoload]", error);
    return null;
  });
});
electron.ipcMain.on("bar:ready", () => markBarReady());
electron.ipcMain.handle("dialog:image", async () => {
  const result = await electron.dialog.showOpenDialog(studioWindow, {
    properties: ["openFile"],
    title: "Choose a background image",
    filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "heic", "gif"] }]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  allowMediaPath(result.filePaths[0]);
  return result.filePaths[0];
});
function profilesPath() {
  return node_path.join(electron.app.getPath("userData"), "profiles.json");
}
async function readProfiles() {
  try {
    return JSON.parse(await promises.readFile(profilesPath(), "utf8"));
  } catch {
    return [];
  }
}
electron.ipcMain.handle("profiles:list", () => readProfiles());
function presetsPath() {
  return node_path.join(electron.app.getPath("userData"), "capture-presets.json");
}
async function readPresets() {
  try {
    return JSON.parse(await promises.readFile(presetsPath(), "utf8"));
  } catch {
    return [];
  }
}
electron.ipcMain.handle("presets:list", () => readPresets());
electron.ipcMain.handle("presets:save", async (_e, preset) => {
  const presets = await readPresets();
  const index = presets.findIndex((p) => p.id === preset.id);
  const next = preset.isDefault ? presets.map((p) => ({ ...p, isDefault: false })) : [...presets];
  if (index >= 0) next[index] = preset;
  else next.push(preset);
  await promises.writeFile(presetsPath(), JSON.stringify(next, null, 2));
  return next;
});
electron.ipcMain.handle("presets:delete", async (_e, id) => {
  const next = (await readPresets()).filter((p) => p.id !== id);
  await promises.writeFile(presetsPath(), JSON.stringify(next, null, 2));
  return next;
});
electron.ipcMain.handle("profiles:save", async (_e, profile) => {
  const profiles = await readProfiles();
  const index = profiles.findIndex((p) => p.id === profile.id);
  const next = profile.isDefault ? profiles.map((p) => ({ ...p, isDefault: false })) : [...profiles];
  if (index >= 0) next[index] = profile;
  else next.push(profile);
  await promises.writeFile(profilesPath(), JSON.stringify(next, null, 2));
  return next;
});
electron.ipcMain.handle("profiles:delete", async (_e, id) => {
  const next = (await readProfiles()).filter((p) => p.id !== id);
  await promises.writeFile(profilesPath(), JSON.stringify(next, null, 2));
  return next;
});
electron.ipcMain.handle("bar:set-size", (event, height) => {
  const win = electron.BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  const [w] = win.getSize();
  win.setSize(w, Math.round(height));
});
