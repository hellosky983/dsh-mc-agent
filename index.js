/**
 * dsh-mc-launcher — Host half
 *
 * A real Minecraft launcher backend running inside the DSH host process.
 * Registers `/api/mc/*` routes on the web server; the client half renders the
 * full-screen launcher UI and talks to these endpoints.
 *
 * Capabilities:
 *   - Microsoft account login via OAuth2 device-code flow
 *     (device code -> XBL -> XSTS -> Minecraft services -> profile)
 *   - Version listing from Mojang's version manifest (cached)
 *   - Install: client jar, libraries (+ natives extraction), asset index & objects
 *   - Launch: builds the Java command line from the version JSON and spawns it
 *   - Live game logs (ring buffer, incremental fetch)
 *
 * Data lives in ~/.minecraft (compatible with the official launcher: existing
 * saves, versions and assets are reused) and ~/.dsh-mc (launcher state).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash, randomBytes } from 'node:crypto'
import { spawn, execFile } from 'node:child_process'
import { Readable } from 'node:stream'
import { defineTool } from '@deepseek-ai/dsh-tools'

let AdmZip = null
try {
  const mod = await import('adm-zip')
  AdmZip = mod.default || mod
} catch {
  /* fall back to the system unzip below */
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    if (AdmZip) {
      try {
        new AdmZip(zipPath).extractAllTo(destDir, true)
        return resolve()
      } catch (e) {
        // fall through to system unzip
      }
    }
    execFile('unzip', ['-o', '-q', zipPath, '-d', destDir], (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

export const name = 'dsh-mc-launcher'
export const inject = ['webServer', 'tools', 'systemPrompt', 'llm', 'agentDefaultModel']

// ---------------------------------------------------------------------------
// paths & persistence
// ---------------------------------------------------------------------------

const HOME = os.homedir()
const MC_DIR = () => store.settings.gameDir
const DATA_DIR = path.join(HOME, '.dsh-mc')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
const ACCOUNT_FILE = path.join(DATA_DIR, 'account.json')
const GOALS_FILE = path.join(DATA_DIR, 'goals.json')

const DEFAULT_SETTINGS = {
  gameDir: path.join(HOME, '.minecraft'),
  javaPath: '',
  memoryMb: 2048,
  clientId: '6a3728d6-27a3-4180-99bb-479895b8f88e', // HMCL's public client id (open-source launcher); you may replace it with your own Azure app id in Settings
  width: null,
  height: null,
  fullscreen: false,
  eulaAccepted: false,
  uiMode: 'tab', // 'tab' = a Minecraft tab inside the DSH chat UI; 'fullscreen' = replace the whole page
  showTab: true, // when uiMode is 'tab', whether to show the Minecraft tab in the session
  theme: { preset: 'default', accent: '' }, // 'default' | 'light' | 'ocean' | 'end' | 'lava'; accent overrides the primary color
  dashscopeKey: '', // optional: override the DASHSCOPE_API_KEY from ~/.bashrc for mc_see
  onboarded: false, // first-run welcome/guide shown until accepted
  autoReconnect: true, // auto-connect the bot + start autonomy when the game opens to LAN
}

// ---------------------------------------------------------------------------
// in-memory store
// ---------------------------------------------------------------------------

const store = {
  settings: { ...DEFAULT_SETTINGS },
  account: null,            // { name, uuid, accessToken, type }
  selected: null,           // version id
  manifest: null,           // cached version manifest
  manifestFetchedAt: 0,
  download: null,           // active install progress
  downloadBusy: false,
  game: {
    running: false,
    pid: null,
    exitCode: null,
    startedAt: null,
    logs: [],               // ring buffer, newest last
    logSeq: 0,
    maxLogs: 1500,
  },
  login: null,              // device-code login session
  oauth: null,              // PKCE oauth in-flight state { verifier, state }
  goals: null,              // autonomous play: { persona, goals: [{text, done}], updatedAt }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json(res, code, data) {
  res.statusCode = code
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(data))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (e) {
        reject(new Error('bad JSON body'))
      }
    })
    req.on('error', reject)
  })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))
    store.settings = { ...DEFAULT_SETTINGS, ...raw }
  } catch {
    store.settings = { ...DEFAULT_SETTINGS }
  }
  try {
    store.account = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'))
  } catch {
    store.account = null
  }
}

function saveSettings() {
  ensureDir(DATA_DIR)
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(store.settings, null, 2), { mode: 0o600 })
}

function saveAccount() {
  ensureDir(DATA_DIR)
  if (store.account) {
    fs.writeFileSync(ACCOUNT_FILE, JSON.stringify(store.account, null, 2), { mode: 0o600 })
  } else {
    try { fs.unlinkSync(ACCOUNT_FILE) } catch { /* ignore */ }
  }
}

function loadGoals() {
  try {
    const g = JSON.parse(fs.readFileSync(GOALS_FILE, 'utf8'))
    store.goals = { persona: g.persona || '', goals: Array.isArray(g.goals) ? g.goals : [], updatedAt: g.updatedAt || '' }
  } catch {
    store.goals = { persona: '', goals: [], updatedAt: '' }
  }
  return store.goals
}

function saveGoals(g) {
  g.updatedAt = new Date().toISOString()
  store.goals = g
  ensureDir(DATA_DIR)
  fs.writeFileSync(GOALS_FILE, JSON.stringify(g, null, 2), { mode: 0o600 })
  return g
}

function pushLog(line) {
  const ts = new Date().toISOString().slice(11, 23)
  store.game.logs.push(`[${ts}] ${line}`)
  store.game.logSeq++
  if (store.game.logs.length > store.game.maxLogs) {
    store.game.logs.splice(0, store.game.logs.length - store.game.maxLogs)
  }
}

function logState(action, msg) {
  pushLog(`[launcher] ${action}: ${msg}`)
  console.log(`[dsh-mc-launcher] ${action}: ${msg}`)
}

// ---------------------------------------------------------------------------
// java detection
// ---------------------------------------------------------------------------

function javaCandidates() {
  const list = []
  if (store.settings.javaPath) list.push(store.settings.javaPath)
  // mojang java runtimes shipped with the official launcher
  const runtimeDir = path.join(MC_DIR(), 'runtime')
  const found = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    let entries = []
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name === 'bin') {
        const j = path.join(dir, 'bin', 'java')
        if (fs.existsSync(j)) found.push(j)
        continue
      }
      walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(runtimeDir, 0)
  // prefer newest version string among mojang runtimes
  found.sort((a, b) => b.localeCompare(a))
  list.push(...found)
  list.push('java') // PATH fallback
  return list
}

function probeJava(bin) {
  return new Promise((resolve) => {
    let out = ''
    const child = spawn(bin, ['-version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const grab = (c) => { out += String(c) }
    child.stdout.on('data', grab)
    child.stderr.on('data', grab)
    child.on('error', () => resolve(null))
    child.on('close', () => {
      const m = out.match(/version "([^"]+)"/)
      resolve(m ? { path: bin, version: m[1] } : null)
    })
  })
}

async function detectJava() {
  for (const bin of javaCandidates()) {
    const info = await probeJava(bin)
    if (info) return info
  }
  return null
}

// ---------------------------------------------------------------------------
// mojang api
// ---------------------------------------------------------------------------

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json'

async function getManifest(force = false) {
  if (!force && store.manifest && Date.now() - store.manifestFetchedAt < 30 * 60 * 1000) {
    return store.manifest
  }
  const res = await fetch(MANIFEST_URL)
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`)
  store.manifest = await res.json()
  store.manifestFetchedAt = Date.now()
  return store.manifest
}

function installedVersions() {
  const dir = path.join(MC_DIR(), 'versions')
  const out = []
  try {
    for (const id of fs.readdirSync(dir)) {
      const jar = path.join(dir, id, `${id}.jar`)
      const jf = path.join(dir, id, `${id}.json`)
      if (fs.existsSync(jar) && fs.existsSync(jf)) {
        let type = 'installed'
        try { type = JSON.parse(fs.readFileSync(jf, 'utf8')).type || 'installed' } catch { /* ignore */ }
        out.push({ id, type, installed: true })
      }
    }
  } catch { /* no versions dir */ }
  return out.sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))
}

async function fetchVersionJson(id) {
  const manifest = await getManifest()
  const entry = manifest.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`version ${id} not in manifest`)
  const res = await fetch(entry.url)
  if (!res.ok) throw new Error(`version json HTTP ${res.status}`)
  return res.json()
}

function readLocalVersionJson(id) {
  const f = path.join(MC_DIR(), 'versions', id, `${id}.json`)
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}

// ---------------------------------------------------------------------------
// downloads
// ---------------------------------------------------------------------------

async function downloadFile(url, dest, onProgress) {
  ensureDir(path.dirname(dest))
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  let done = 0
  const reader = res.body.getReader()
  const ws = fs.createWriteStream(dest)
  try {
    for (;;) {
      const { done: d, value } = await reader.read()
      if (d) break
      done += value.byteLength
      if (onProgress) onProgress(done, total)
      if (!ws.write(Buffer.from(value))) {
        await new Promise((r) => ws.once('drain', r))
      }
    }
    ws.end()
    await new Promise((resolve, reject) => {
      ws.on('finish', resolve)
      ws.on('error', reject)
    })
  } catch (e) {
    ws.destroy()
    throw e
  }
  return total || done
}

function osName() {
  switch (process.platform) {
    case 'darwin': return 'osx'
    case 'win32': return 'windows'
    default: return 'linux'
  }
}

function libraryAllowed(lib) {
  if (!lib.rules) return true
  const os = osName()
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86'
  for (const rule of lib.rules) {
    let ok = true
    if (rule.os) {
      ok = rule.os.name === os && (!rule.os.arch || rule.os.arch === arch)
    }
    if (rule.features && rule.features.is_demo_user !== undefined) ok = false
    const want = rule.action === 'disallow' ? !ok : ok
    if (!want) return false
  }
  return true
}

function libraryPath(lib) {
  const a = lib.downloads.artifact
  return path.join(MC_DIR(), 'libraries', ...a.path.split('/'))
}

function nativeClassifiers(lib) {
  if (!lib.natives) return null
  const key = lib.natives[osName()]
  if (!key) return null
  const c = lib.downloads.classifiers && lib.downloads.classifiers[key]
  if (!c) return null
  return { key, classifier: c }
}

/** Set the active download progress; returns true when cancelled. */
async function withProgress(patch) {
  if (!store.download || store.download.cancelled) return true
  Object.assign(store.download, patch)
  return false
}

async function installVersion(id) {
  if (store.downloadBusy) throw new Error('another install is running')
  store.downloadBusy = true
  store.download = {
    version: id,
    stage: 'preparing',
    filesTotal: 0,
    filesDone: 0,
    current: null,
    bytesDone: 0,
    bytesTotal: 0,
    error: null,
    cancelled: false,
  }
  const gameDir = MC_DIR()
  const versionsDir = path.join(gameDir, 'versions', id)
  ensureDir(versionsDir)

  const fail = (e) => {
    const detail = e && e.cause ? ` | cause: ${e.cause.message || e.cause}` : ''
    const stack = e && e.stack ? ` | ${String(e.stack).split('\n').slice(0, 3).join(' / ')}` : ''
    logState('install', `failed: ${e.message}${detail}${stack}`)
    store.download.error = `${e.message}${detail}`
    store.downloadBusy = false
  }

  try {
    logState('install', `resolving ${id}`)
    let vjson
    try {
      vjson = readLocalVersionJson(id)
    } catch {
      vjson = await fetchVersionJson(id)
      fs.writeFileSync(path.join(versionsDir, `${id}.json`), JSON.stringify(vjson, null, 2))
    }

    // ---- file list ----
    const files = [] // { url, dest, size, isNatives }
    files.push({
      url: vjson.downloads.client.url,
      dest: path.join(versionsDir, `${id}.jar`),
      size: vjson.downloads.client.size || 0,
      name: `${id}.jar`,
    })
    for (const lib of vjson.libraries || []) {
      if (!libraryAllowed(lib)) continue
      if (lib.downloads && lib.downloads.artifact) {
        files.push({
          url: lib.downloads.artifact.url,
          dest: libraryPath(lib),
          size: lib.downloads.artifact.size || 0,
          name: lib.name,
        })
      }
      const nat = nativeClassifiers(lib)
      if (nat) {
        files.push({
          url: nat.classifier.url,
          dest: path.join(gameDir, 'libraries', ...nat.classifier.path.split('/')),
          size: nat.classifier.size || 0,
          name: `${lib.name}:${nat.key}`,
          isNatives: true,
        })
      }
    }

    // asset index (download synchronously so objects can be resolved)
    let assetIndex = null
    if (vjson.assetIndex) {
      const idxFile = path.join(gameDir, 'assets', 'indexes', `${vjson.assetIndex.id}.json`)
      if (!fs.existsSync(idxFile)) {
        store.download.current = { name: `asset-index-${vjson.assetIndex.id}.json`, done: 0, total: vjson.assetIndex.size || 0 }
        await downloadFile(vjson.assetIndex.url, idxFile, (b, t) => {
          store.download.current = { name: `asset-index-${vjson.assetIndex.id}.json`, done: b, total: t }
        })
        store.download.current = null
        store.download.filesDone += 1
      }
      try { assetIndex = JSON.parse(fs.readFileSync(idxFile, 'utf8')) } catch { assetIndex = null }
    }

    // assets objects (only when the index is new or missing objects)
    if (assetIndex && assetIndex.objects) {
      const objectsDir = path.join(gameDir, 'assets', 'objects')
      const missing = []
      let totalBytes = 0
      for (const [key, obj] of Object.entries(assetIndex.objects)) {
        const p = path.join(objectsDir, obj.hash.slice(0, 2), obj.hash)
        if (!fs.existsSync(p) || fs.statSync(p).size !== obj.size) missing.push([key, obj])
        totalBytes += obj.size
      }
      if (missing.length > 0) {
        const base = 'https://resources.download.minecraft.net/'
        for (const [, obj] of missing) {
          files.push({
            url: `${base}${obj.hash.slice(0, 2)}/${obj.hash}`,
            dest: path.join(objectsDir, obj.hash.slice(0, 2), obj.hash),
            size: obj.size,
            name: obj.hash.slice(0, 8),
          })
        }
      }
    }

    store.download.filesTotal = files.length + 1 // + asset index
    store.download.stage = 'downloading'

    // ---- download with size check skip ----
    let done = 1 // asset index already fetched
    for (const f of files) {
      if (store.download.cancelled) break
      if (fs.existsSync(f.dest) && f.size > 0 && fs.statSync(f.dest).size === f.size) {
        store.download.filesDone = ++done
        continue
      }
      store.download.current = { name: f.name, done: 0, total: f.size }
      await downloadFile(f.url, f.dest, (b, t) => {
        store.download.current = { name: f.name, done: b, total: t }
      })
      store.download.filesDone = ++done
      store.download.current = null
    }

    // ---- extract natives ----
    if (!store.download.cancelled) {
      store.download.stage = 'extracting'
      const nativesDir = path.join(versionsDir, 'natives')
      ensureDir(nativesDir)
      for (const f of files) {
        if (!f.isNatives) continue
        try {
          await extractZip(f.dest, nativesDir)
        } catch (e) {
          logState('install', `natives extract failed for ${f.name}: ${e.message}`)
        }
      }
    }

    if (store.download.cancelled) {
      logState('install', `cancelled for ${id}`)
    } else {
      store.download.stage = 'done'
      logState('install', `finished ${id}: ${store.download.filesDone}/${store.download.filesTotal} files`)
    }
  } catch (e) {
    fail(e)
  }
  store.downloadBusy = false
}

// ---------------------------------------------------------------------------
// launch
// ---------------------------------------------------------------------------

function buildLaunchArgs(id, javaInfo, account) {
  const vjson = readLocalVersionJson(id)
  const gameDir = MC_DIR()
  const versionsDir = path.join(gameDir, 'versions', id)
  const nativesDir = path.join(versionsDir, 'natives')
  const assetsRoot = path.join(gameDir, 'assets')
  const assetIndexId = vjson.assetIndex ? vjson.assetIndex.id : 'legacy'

  const libs = []
  for (const lib of vjson.libraries || []) {
    if (!libraryAllowed(lib)) continue
    if (lib.downloads && lib.downloads.artifact) {
      const p = libraryPath(lib)
      if (fs.existsSync(p)) libs.push(p)
    }
  }
  const classpath = [path.join(versionsDir, `${id}.jar`), ...libs].join(path.sep === '\\' ? ';' : ':')

  const s = store.settings
  const mem = Math.max(512, Number(s.memoryMb) || 2048)
  const common = {
    '${auth_player_name}': account ? account.name : 'Player',
    '${auth_uuid}': account ? account.uuid : '00000000-0000-0000-0000-000000000000',
    '${auth_access_token}': account ? account.accessToken : '0',
    '${auth_session}': account ? `token:${account.accessToken}:${account.uuid}` : 'token:0:0',
    '${auth_xuid}': account && account.xuid ? account.xuid : '0',
    '${user_type}': account ? 'msa' : 'legacy',
    '${version_name}': id,
    '${version_type}': vjson.type || 'release',
    '${game_directory}': gameDir,
    '${game_assets}': assetsRoot,
    '${assets_root}': assetsRoot,
    '${assets_index_name}': assetIndexId,
    '${launcher_name}': 'dsh-mc-launcher',
    '${launcher_version}': '0.1.0',
    '${classpath}': classpath,
    '${library_directory}': path.join(gameDir, 'libraries'),
    '${natives_directory}': nativesDir,
    '${resolution_width}': String(s.width || 854),
    '${resolution_height}': String(s.height || 480),
  }

  const expand = (s) => String(s).replace(/\$\{(\w+)\}/g, (m, k) => {
    const key = '${' + k + '}'
    return common[key] !== undefined ? common[key] : m
  })

  const jvmArgs = ['-Xmx' + mem + 'M', '-Xms256M']
  const gameArgs = []
  if (Array.isArray(vjson.arguments)) {
    // old style: minecraftArguments is a string in vjson.minecraftArguments
    gameArgs.push(...vjson.minecraftArguments.split(' '))
  } else if (vjson.arguments) {
    const jvm = vjson.arguments.jvm || []
    const game = vjson.arguments.game || []
    for (const arg of jvm) {
      if (typeof arg === 'string') {
        const e = expand(arg)
        if (e.startsWith('${')) continue // unexpanded template: skip
        if (e.startsWith('-Xmx') || e.startsWith('-Xms')) continue // memory owned by us
        jvmArgs.push(e)
      } else if (arg.rules) {
        // rule-gated jvm arg (e.g. -Dos.name for macOS)
        const fake = { rules: arg.rules }
        if (libraryAllowed(fake)) {
          for (const v of arg.value) {
            const e = expand(v)
            if (!e.startsWith('${')) jvmArgs.push(e)
          }
        }
      }
    }
    for (const arg of game) {
      if (typeof arg === 'string') {
        const e = expand(arg)
        if (!e.startsWith('${')) gameArgs.push(e)
      } else if (arg.rules) {
        const fake = { rules: arg.rules }
        if (libraryAllowed(fake)) {
          for (const v of arg.value) {
            const e = expand(v)
            if (!e.startsWith('${')) gameArgs.push(e)
          }
        }
      }
    }
  } else if (vjson.minecraftArguments) {
    gameArgs.push(...vjson.minecraftArguments.split(' '))
  }

  if (s.fullscreen) jvmArgs.push('-Dorg.lwjgl.opengl.Window.fullscreen=true')

  return { args: [...jvmArgs, vjson.mainClass, ...gameArgs], nativesDir, mainClass: vjson.mainClass }
}

function launch(id, account) {
  if (store.game.running) throw new Error('game already running')
  const vjson = readLocalVersionJson(id)
  const gameDir = MC_DIR()
  const versionsDir = path.join(gameDir, 'versions', id)
  if (!fs.existsSync(path.join(versionsDir, `${id}.jar`))) {
    throw new Error(`version ${id} is not installed (missing jar)`)
  }

  const javaInfo = store.javaInfo
  if (!javaInfo) throw new Error('no usable Java runtime found')
  const { args } = buildLaunchArgs(id, javaInfo, account)

  logState('launch', `${id} with ${javaInfo.path}`)
  pushLog(`[launcher] command: ${javaInfo.path} ${args.slice(0, 6).join(' ')} ...`)

  const child = spawn(javaInfo.path, args, {
    cwd: gameDir,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  store.game.running = true
  store.game.pid = child.pid
  store.game.exitCode = null
  store.game.startedAt = Date.now()

  const pipe = (chunk) => {
    const text = String(chunk)
    for (const line of text.split('\n')) {
      const t = line.replace(/\r$/, '')
      if (t) pushLog(t)
    }
  }
  child.stdout.on('data', pipe)
  child.stderr.on('data', pipe)
  child.on('error', (e) => {
    pushLog(`[launcher] spawn error: ${e.message}`)
    store.game.running = false
  })
  child.on('close', (code) => {
    store.game.running = false
    store.game.exitCode = code
    store.game.pid = null
    pushLog(`[launcher] game exited with code ${code}`)
  })
  return { pid: child.pid }
}

// ---------------------------------------------------------------------------
// microsoft device-code login
// ---------------------------------------------------------------------------

function msAuthHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' }
}

function xblHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' }
}

async function xblAuthenticate(accessToken) {
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: xblHeaders(),
    body: JSON.stringify({
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${accessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`XBL auth failed HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const uhs = data.DisplayClaims && data.DisplayClaims.xui && data.DisplayClaims.xui[0] && data.DisplayClaims.xui[0].uhs
  if (!uhs) throw new Error(`XBL auth missing uhs: ${JSON.stringify(data).slice(0, 300)}`)
  return { token: data.Token, uhs }
}

async function xstsAuthenticate(xblToken) {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: xblHeaders(),
    body: JSON.stringify({
      Properties: { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    }),
  })
  if (res.status === 401) {
    const data = await res.json().catch(() => null)
    throw new Error(`XSTS rejected (${data && data.XErr ? 'XErr ' + data.XErr : 'no xbox account'})`)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`XSTS auth failed HTTP ${res.status}: ${body.slice(0, 300)}`)
  }
  const data = await res.json()
  const uhs = data.DisplayClaims && data.DisplayClaims.xui && data.DisplayClaims.xui[0] && data.DisplayClaims.xui[0].uhs
  if (!uhs) throw new Error(`XSTS auth missing uhs: ${JSON.stringify(data).slice(0, 300)}`)
  return { token: data.Token, uhs }
}

async function mcLoginWithXbox(xstsToken, uhs) {
  const res = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: msAuthHeaders(),
    body: JSON.stringify({ identityToken: `XBL3.0 x=${uhs};${xstsToken}` }),
  })
  if (!res.ok) throw new Error(`Minecraft login failed HTTP ${res.status}`)
  return (await res.json()).access_token
}

async function mcProfile(accessToken) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) throw new Error('this account owns no Minecraft (no game purchased)')
  if (!res.ok) throw new Error(`profile fetch failed HTTP ${res.status}`)
  return res.json()
}

async function msLoginStart() {
  if (!store.settings.clientId) {
    throw new Error('no Azure client id configured \u2014 register your own app (see README \u00a7Sign-in) and set it in Settings')
  }
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: store.settings.clientId,
      scope: 'XboxLive.signin offline_access',
    }).toString(),
  })
  if (!res.ok) throw new Error(`devicecode HTTP ${res.status}`)
  const data = await res.json()
  store.login = {
    status: 'pending',
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    message: data.message || '',
    expiresAt: Date.now() + (data.expires_in || 900) * 1000,
    interval: Math.max(5, data.interval || 5),
    error: null,
  }
  return store.login
}

async function msLoginPoll() {
  const login = store.login
  if (!login || login.status !== 'pending') return login
  if (Date.now() > login.expiresAt) {
    login.status = 'error'
    login.error = 'code expired'
    return login
  }
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: store.settings.clientId,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: login.deviceCode,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (data.error === 'authorization_pending') {
    login.status = 'pending'
    return login
  }
  if (data.error === 'slow_down') {
    login.interval = Math.min(login.interval + 5, 60)
    login.status = 'pending'
    return login
  }
  if (!res.ok || !data.access_token) {
    login.status = 'error'
    login.error = data.error_description || data.error || `HTTP ${res.status}`
    return login
  }

  // exchange chain
  try {
    const xbl = await xblAuthenticate(data.access_token)
    const xsts = await xstsAuthenticate(xbl.token)
    const mcToken = await mcLoginWithXbox(xsts.token, xsts.uhs)
    const profile = await mcProfile(mcToken)
    store.account = {
      name: profile.name,
      uuid: profile.id,
      accessToken: mcToken,
      type: 'msa',
      xuid: xsts.uhs,
    }
    saveAccount()
    login.status = 'ok'
    login.account = { name: profile.name, uuid: profile.id }
    logState('login', `signed in as ${profile.name} (${profile.id})`)
  } catch (e) {
    login.status = 'error'
    login.error = e.message
  }
  return login
}

async function exchangeMicrosoftToken(accessToken) {
  const xbl = await xblAuthenticate(accessToken)
  const xsts = await xstsAuthenticate(xbl.token)
  const mcToken = await mcLoginWithXbox(xsts.token, xsts.uhs)
  const profile = await mcProfile(mcToken)
  const account = { name: profile.name, uuid: profile.id, accessToken: mcToken, type: 'msa', xuid: xsts.uhs }
  store.account = account
  saveAccount()
  logState('login', `signed in as ${profile.name} (${profile.id})`)
  return account
}

function pkcePair() {
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function oauthStart(port) {
  if (!store.settings.clientId) {
    throw new Error('no Azure client id configured \u2014 register your own app (see README) and set it in Settings')
  }
  const { verifier, challenge } = pkcePair()
  const state = randomBytes(16).toString('hex')
  store.oauth = { verifier, state }
  const redirectUri = `http://127.0.0.1:${port}/api/mc/oauth/callback`
  const params = new URLSearchParams({
    client_id: store.settings.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'XboxLive.signin offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  })
  return `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params.toString()}`
}

async function oauthCallback(code, state, port) {
  const oauth = store.oauth
  if (!oauth || oauth.state !== state) throw new Error('OAuth state mismatch \u2014 please start sign-in again')
  store.oauth = null
  const redirectUri = `http://127.0.0.1:${port}/api/mc/oauth/callback`
  const res = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: store.settings.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: oauth.verifier,
    }).toString(),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || `HTTP ${res.status}`)
  }
  return exchangeMicrosoftToken(data.access_token)
}

function oauthCallbackHtml(ok, message) {
  const color = ok ? '#4ade80' : '#f87171'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>DSH Minecraft Launcher \u00b7 Sign in</title></head>
<body style="margin:0;background:#0d1318;color:#e8e8e8;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh">
<div style="text-align:center">
<div style="font-size:42px;font-weight:900;color:${color}">${ok ? '\u2713 Sign-in complete' : '\u2717 Sign-in failed'}</div>
<div style="margin-top:14px;font-size:15px;color:#9fb5a6;max-width:420px;line-height:1.6">${message}</div>
<div style="margin-top:22px;font-size:13px;color:#6f8a78">You can close this tab and return to the launcher.</div>
</div></body></html>`
}

// ---------------------------------------------------------------------------
// http api
// ---------------------------------------------------------------------------

async function route(req, res) {
  const u = new URL(req.url, 'http://localhost')
  const m = u.pathname.match(/^\/api\/mc\/([\w-]+)$/)
  if (!m) return json(res, 404, { error: 'not found' })
  const action = m[1]
  try {
    switch (action) {
      case 'state': {
        const java = await detectJava()
        store.javaInfo = java
        json(res, 200, {
          account: store.account ? { name: store.account.name, uuid: store.account.uuid, type: store.account.type } : null,
          selected: store.selected,
          settings: { ...store.settings },
          java: java,
          download: store.download
            ? { ...store.download, current: store.download.current && { ...store.download.current } }
            : null,
          game: {
            running: store.game.running,
            exitCode: store.game.exitCode,
            startedAt: store.game.startedAt,
            logCount: store.game.logs.length,
            logSeq: store.game.logSeq,
          },
          login: store.login
            ? {
                status: store.login.status,
                userCode: store.login.userCode,
                verificationUri: store.login.verificationUri,
                message: store.login.message,
                expiresAt: store.login.expiresAt,
                error: store.login.error,
                account: store.login.account || null,
              }
            : null,
        })
        break
      }
      case 'versions': {
        const manifest = await getManifest()
        json(res, 200, {
          latest: manifest.latest,
          versions: manifest.versions.map((v) => ({
            id: v.id,
            type: v.type,
            releaseTime: v.releaseTime,
          })),
          installed: installedVersions(),
        })
        break
      }
      case 'select': {
        const body = await readBody(req)
        store.selected = body.id || null
        json(res, 200, { ok: true, selected: store.selected })
        break
      }
      case 'install': {
        const body = await readBody(req)
        if (!body.id) return json(res, 400, { error: 'missing id' })
        installVersion(body.id) // fire & forget; progress via /state
        json(res, 200, { ok: true, id: body.id })
        break
      }
      case 'cancel-install': {
        if (store.download) store.download.cancelled = true
        json(res, 200, { ok: true })
        break
      }
      case 'launch': {
        const body = await readBody(req)
        const id = body.id || store.selected
        if (!id) return json(res, 400, { error: 'no version selected' })
        if (store.game.running) return json(res, 409, { error: 'game already running' })
        const java = await detectJava()
        store.javaInfo = java
        if (!java) return json(res, 500, { error: 'no Java runtime found' })
        const account = store.account
        if (!account) return json(res, 403, { error: 'not signed in — sign in with your Microsoft account (playing Minecraft requires a valid, legitimately purchased account)' })
        const r = launch(id, account)
        json(res, 200, { ok: true, pid: r.pid })
        break
      }
      case 'kill': {
        if (store.game.pid) {
          try { process.kill(store.game.pid) } catch { /* gone */ }
          store.game.running = false
        }
        json(res, 200, { ok: true })
        break
      }
      case 'logs': {
        const since = Number(u.searchParams.get('since') || 0)
        const start = Math.max(0, store.game.logs.length - (store.game.logSeq - since))
        json(res, 200, { lines: store.game.logs.slice(start), next: store.game.logSeq })
        break
      }
      case 'login-start': {
        const l = await msLoginStart()
        json(res, 200, {
          userCode: l.userCode,
          verificationUri: l.verificationUri,
          message: l.message,
          expiresAt: l.expiresAt,
          interval: l.interval,
        })
        break
      }
      case 'login-poll': {
        const l = await msLoginPoll()
        json(res, 200, {
          status: l.status,
          error: l.error,
          account: l.account || null,
          userCode: l.userCode,
          verificationUri: l.verificationUri,
          interval: l.interval,
        })
        break
      }
      case 'logout': {
        store.account = null
        saveAccount()
        json(res, 200, { ok: true })
        break
      }
      case 'settings': {
        const body = await readBody(req)
        const patch = {}
        for (const key of ['gameDir', 'javaPath', 'memoryMb', 'clientId', 'width', 'height', 'fullscreen', 'eulaAccepted', 'uiMode', 'showTab', 'theme', 'dashscopeKey', 'onboarded', 'autoReconnect']) {
          if (body[key] !== undefined) patch[key] = body[key]
        }
        store.settings = { ...store.settings, ...patch }
        saveSettings()
        store.javaInfo = null // force re-detect
        json(res, 200, { ok: true, settings: store.settings })
        break
      }
      case 'java': {
        const java = await detectJava()
        store.javaInfo = java
        json(res, 200, { java })
        break
      }
      case 'mc-dir': {
        json(res, 200, { gameDir: MC_DIR(), dataDir: DATA_DIR })
        break
      }
      case 'map': {
        json(res, 200, mapState())
        break
      }
      default:
        json(res, 404, { error: `unknown action ${action}` })
    }
  } catch (e) {
    logState('api', `${action} error: ${e.message}`)
    json(res, 500, { error: e.message })
  }
}

// ---------------------------------------------------------------------------
// game analysis helpers (agent tools)
// ---------------------------------------------------------------------------

// ---- vision + control: let the agent see and play Minecraft ----
function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, {
      timeout: opts.timeout || 12000,
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' },
    }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), code: err ? err.code : 0 })
    })
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const withTimeout = (promise, ms, fallback = null) => Promise.race([promise, sleep(ms).then(() => fallback)])

async function findGameWindow() {
  for (const pat of ['Minecraft', 'minecraft', 'Java']) {
    const r = await sh('xdotool', ['search', '--name', pat])
    const ids = r.stdout.trim().split('\n').filter(Boolean)
    if (ids.length) return ids[0]
  }
  return null
}

async function gameGeometry(winId) {
  const r = await sh('xdotool', ['getwindowgeometry', '--shell', winId])
  const g = { x: 0, y: 0, w: 854, h: 480 }
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^(X|Y|WIDTH|HEIGHT)=(-?\d+)/)
    if (!m) continue
    if (m[1] === 'X') g.x = Number(m[2])
    else if (m[1] === 'Y') g.y = Number(m[2])
    else if (m[1] === 'WIDTH') g.w = Number(m[2])
    else if (m[1] === 'HEIGHT') g.h = Number(m[2])
  }
  return g
}

function dashscopeKey() {
  if (store.settings.dashscopeKey) return store.settings.dashscopeKey
  try {
    const rc = fs.readFileSync(path.join(HOME, '.bashrc'), 'utf8')
    const m = rc.match(/DASHSCOPE_API_KEY\s*=\s*['"]?([^'"\n]+)/)
    return m ? m[1] : ''
  } catch { return '' }
}

const KEYMAP = {
  forward: 'w', back: 's', left: 'a', right: 'd', jump: 'space', sneak: 'shift',
  sprint: 'ctrl', inventory: 'e', drop: 'q', chat: 't', slash: 'slash',
  escape: 'Escape', slot1: '1', slot2: '2', slot3: '3', slot4: '4', slot5: '5',
  slot6: '6', slot7: '7', slot8: '8', slot9: '9',
}

async function mcScreenshot() {
  const win = await findGameWindow()
  if (!win) return { ok: false, error: 'no Minecraft window found — start the game first (windowed mode is easier to control)' }
  const geo = await gameGeometry(win)
  const outDir = path.join(DATA_DIR, 'shots')
  ensureDir(outDir)
  const file = path.join(outDir, `shot-${Date.now()}.png`)
  const r = await sh('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'x11grab',
    '-video_size', `${geo.w}x${geo.h}`, '-i', `:0+${geo.x},${geo.y}`,
    '-frames:v', '1', file,
  ])
  if (!r.ok || !fs.existsSync(file)) return { ok: false, error: `screenshot failed: ${r.stderr || r.stdout}` }
  store.lastShot = file
  return { ok: true, path: file, width: geo.w, height: geo.h }
}

async function mcSee(imagePath, prompt) {
  const key = dashscopeKey()
  if (!key) return { ok: false, error: 'DASHSCOPE_API_KEY not configured — set it in ~/.bashrc or in Settings' }
  const file = imagePath || store.lastShot
  if (!file || !fs.existsSync(file)) return { ok: false, error: 'no screenshot available — call mc_screenshot first' }
  const b64 = fs.readFileSync(file).toString('base64')
  const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'qwen-vl-plus',
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
          { type: 'text', text: prompt || 'Describe this Minecraft game screen in detail: what is visible, the environment (biome, time of day), the player\'s immediate situation, and anything notable (health, hunger bar, hotbar selection, nearby mobs or threats).' },
        ],
      }],
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: `vision API HTTP ${res.status}: ${data.error?.message || JSON.stringify(data).slice(0, 200)}` }
  const text = data.choices?.[0]?.message?.content
  return { ok: true, description: typeof text === 'string' ? text : JSON.stringify(text) }
}

async function mcControl(action, opts = {}) {
  const win = await findGameWindow()
  if (!win) return { ok: false, error: 'no Minecraft window found' }
  await sh('xdotool', ['windowactivate', '--sync', win])
  await sh('xdotool', ['windowfocus', '--sync', win])
  await sleep(80)
  if (action === 'click' || action === 'attack' || action === 'break') {
    await sh('xdotool', ['click', '--window', win, '1'])
    return { ok: true, action: 'left-click' }
  }
  if (action === 'rclick' || action === 'use' || action === 'place') {
    await sh('xdotool', ['click', '--window', win, '3'])
    return { ok: true, action: 'right-click' }
  }
  if (action === 'look') {
    const dx = Number(opts.dx) || 0
    const dy = Number(opts.dy) || 0
    await sh('xdotool', ['mousemove_relative', '--', String(dx), String(dy)])
    return { ok: true, action: `look dx=${dx} dy=${dy}` }
  }
  if (action === 'type') {
    const text = String(opts.text || '')
    await sh('xdotool', ['type', '--window', win, '--delay', '30', '--', text])
    return { ok: true, action: 'type', text }
  }
  const key = KEYMAP[action] || action
  const holdMs = (action === 'forward' || action === 'back' || action === 'left' || action === 'right')
    ? (Number(opts.ms) || 400) : 90
  await sh('xdotool', ['keydown', '--window', win, key])
  await sleep(holdMs)
  await sh('xdotool', ['keyup', '--window', win, key])
  return { ok: true, action, key, heldMs: holdMs }
}

// ---- Mineflayer bot: direct game-data access + protocol-level control ----
let bot = null
let _mf = null, _pf = null, _Vec3 = null, _goals = null
let autonomyCtx = null  // the apply ctx, for social/decision LLM calls

async function loadBotLibs() {
  if (!_mf || !_pf || !_Vec3) {
    _mf = await import('mineflayer')
    const vec3mod = await import('vec3')
    _Vec3 = vec3mod.default || vec3mod
    _pf = await import('mineflayer-pathfinder')
    _goals = _pf.goals
  }
  return { mineflayer: _mf, pathfinder: _pf.pathfinder, Movements: _pf.Movements, Vec3: _Vec3, goals: _goals }
}

function lanPortFromLogs() {
  const parts = [store.game.logs.join('\n')]
  try {
    // game writes its own log file, which survives DSH restarts
    parts.push(fs.readFileSync(path.join(MC_DIR(), 'logs', 'latest.log'), 'utf8'))
  } catch { /* ignore */ }
  const all = parts.join('\n')
  // matches "port 45947", "端口[45947]", "Started serving on 45947", etc.
  let m = all.match(/port\s*[\[:(：]?\s*(\d{4,5})/i)
    || all.match(/端口\s*[\[:(：]?\s*(\d{4,5})/)
    || all.match(/serving on (\d{4,5})/i)
  if (m) return Number(m[1])
  m = all.match(/(\d{4,5})\s*(?:局域网|LAN|local game)/i) || all.match(/(?:局域网|LAN|local game)[^\d]*(\d{4,5})/i)
  return m ? Number(m[1]) : null
}

async function botConnect(port, username) {
  if (bot) { try { bot.end() } catch { /* ignore */ } bot = null }
  const { mineflayer, pathfinder, Movements, Vec3 } = await loadBotLibs()
  const p = Number(port) || lanPortFromLogs()
  if (!p) return { ok: false, error: 'no LAN port — open the game to LAN (Esc → Open to LAN) or pass port' }
  const b = mineflayer.createBot({ host: '127.0.0.1', port: p, username: username || 'DSH-Bot' })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`connect timeout on port ${p}`)), 12000)
    b.once('spawn', () => { clearTimeout(t); resolve() })
    b.once('error', (e) => { clearTimeout(t); reject(e) })
  })
  b.loadPlugin(pathfinder)
  b.pathfinder.setMovements(new Movements(b))
  b.on('kicked', (r) => { pushLog(`[bot] kicked: ${r}`) })
  b.on('end', () => { if (bot === b) { bot = null; stopAutonomy() } })
  b.on('chat', (username, message) => {
    // ignore the bot's own echoed chat (username shows as "Bot"/"DSH-Bot"),
    // and any other bot-named entity, so the bot never replies to itself
    if (username === b.username || /bot/i.test(username)) return
    pushLog(`[social] ${username}: ${message}`)
    onPlayerChat(username, message)
  })
  bot = b
  return { ok: true, username: b.username, port: p }
}

function botReq() {
  return bot
}

// ASCII top-down map centered on the bot, for in-game chat display.
function asciiMap() {
  const m = mapState()
  if (!m.ok || !m.botPos) return null
  const SIZE = 11, R = 5
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill('\u00b7'))
  grid[R][R] = 'B'
  let player = null
  for (const p of m.players) {
    if (p.isBot) continue
    const gx = R + (p.x - m.botPos.x)
    const gz = R + (p.z - m.botPos.z)
    if (gx >= 0 && gx < SIZE && gz >= 0 && gz < SIZE) grid[gz][gx] = 'P'
    player = p
  }
  // terrain: mark water/ore roughly
  const TERRAIN = { water: '~', lava: '#', coal_ore: 'o', iron_ore: 'O', diamond_ore: '*' }
  for (const g of m.ground || []) {
    const gx = R + g.dx, gz = R + g.dz
    if (gx >= 0 && gx < SIZE && gz >= 0 && gz < SIZE && grid[gz][gx] === '\u00b7') {
      grid[gz][gx] = TERRAIN[g.name] || '\u00b7'
    }
  }
  const rows = grid.map((r) => r.join(''))
  return {
    rows,
    bot: m.botPos,
    player: player ? { x: player.x, z: player.z } : null,
  }
}

// Compact live-state snapshot injected into the model context each step, so
// the agent "sees" the game directly without calling mc_bot_state every time.
function formatLiveState() {
  const b = botReq()
  if (!b || !b.entity || !b.entity.position) return ''
  const p = b.entity.position
  const lines = []
  lines.push(`位置=(${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})`)
  if (b.health !== undefined) lines.push(`血量=${b.health} 饥饿=${b.food}`)
  if (b.heldItem) lines.push(`手持=${b.heldItem.name}×${b.heldItem.count}`)
  const inv = b.inventory ? b.inventory.items().slice(0, 9).map((i) => `${i.name}×${i.count}`).join(', ') : ''
  if (inv) lines.push(`快捷栏=[${inv}]`)
  if (_Vec3) {
    try {
      const below = b.blockAt(new _Vec3(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)))
      if (below && below.name) lines.push(`脚下=${below.name}`)
      const ahead = b.blockAt(new _Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)))
      if (ahead && ahead.name && ahead.name !== 'air') lines.push(`前方=${ahead.name}`)
    } catch { /* ignore */ }
  }
  return '[Minecraft 机器人实时状态]\n' + lines.join('\n')
}

function botState() {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected — call mc_bot_connect first (game must be open to LAN)' }
  const p = b.entity && b.entity.position
  return {
    ok: true,
    username: b.username,
    position: p ? { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, z: Math.round(p.z * 10) / 10 } : null,
    health: b.health,
    food: b.food,
    gamemode: b.game && b.game.gameMode,
    heldItem: b.heldItem ? { name: b.heldItem.name, count: b.heldItem.count } : null,
    inventory: b.inventory ? b.inventory.items().slice(0, 36).map((i) => ({ name: i.name, count: i.count })) : [],
    nearBlocks: b.blockAt ? (function () {
      if (!p) return []
      const out = []
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const bl = b.blockAt(new _Vec3(Math.floor(p.x) + dx, Math.floor(p.y), Math.floor(p.z) + dz))
        if (bl && bl.name !== 'air') out.push({ name: bl.name, rel: `${dx},0,${dz}` })
      }
      return out.slice(0, 12)
    })() : [],
  }
}

// Live positions of the bot and every nearby player, for the map panel.
function mapState() {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  const players = []
  if (b.entity && b.entity.position) {
    players.push({ name: b.username, x: Math.round(b.entity.position.x), z: Math.round(b.entity.position.z), yaw: b.entity.yaw, isBot: true })
  }
  try {
    const map = b.players || {}
    for (const [name, p] of Object.entries(map)) {
      if (name === b.username) continue
      const e = p.entity || p
      if (e && e.position) players.push({ name, x: Math.round(e.position.x), z: Math.round(e.position.z), yaw: e.yaw, isBot: false })
    }
  } catch { /* ignore */ }
  // terrain snapshot (ground blocks around the bot) for a rough map
  const ground = []
  if (b.entity && b.entity.position && _Vec3) {
    const p = b.entity.position
    try {
      for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) {
        const bl = b.blockAt(new _Vec3(Math.floor(p.x) + dx, Math.floor(p.y) - 1, Math.floor(p.z) + dz))
        if (bl && bl.name !== 'air' && bl.name !== 'void_air') ground.push({ dx, dz, name: bl.name })
      }
    } catch { /* ignore */ }
  }
  return { ok: true, players, ground, botPos: b.entity ? { x: Math.round(b.entity.position.x), z: Math.round(b.entity.position.z) } : null }
}

async function botMove(x, y, z) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  const { Vec3 } = await loadBotLibs()
  const { goals } = _pf
  return new Promise((resolve) => {
    const goal = new goals.GoalNear(x, y, z, 1)
    b.pathfinder.setGoal(goal)
    const t = setTimeout(() => { b.pathfinder.setGoal(null); resolve({ ok: false, error: 'path timeout (unreachable?)' }) }, 20000)
    const onReach = () => { clearTimeout(t); b.removeListener('goal_reached', onReach); resolve({ ok: true }) }
    b.once('goal_reached', onReach)
  })
}

async function botLook(yaw, pitch) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  await b.look(Number(yaw) || 0, Number(pitch) || 0, true)
  return { ok: true, yaw: b.entity.yaw, pitch: b.entity.pitch }
}

async function botDig(x, y, z) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  const { Vec3 } = await loadBotLibs()
  const block = b.blockAt(new Vec3(Math.floor(x), Math.floor(y), Math.floor(z)))
  if (!block || block.name === 'air') return { ok: false, error: `no block at ${x},${y},${z}` }
  try {
    await b.dig(block)
    return { ok: true, dug: block.name }
  } catch (e) {
    return { ok: false, error: `dig failed: ${e.message}` }
  }
}

async function botPlace(x, y, z) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  const { Vec3 } = await loadBotLibs()
  const ref = b.blockAt(new Vec3(Math.floor(x), Math.floor(y) - 1, Math.floor(z)))
  if (!ref) return { ok: false, error: 'no reference block below target' }
  try {
    await b.placeBlock(ref, new Vec3(0, 1, 0))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `place failed: ${e.message}` }
  }
}

async function botEquip(name) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  const item = b.inventory.items().find((i) => i.name === name || (i.name && i.name.includes(name)))
  if (!item) return { ok: false, error: `no item matching "${name}"` }
  await b.equip(item, 'hand')
  return { ok: true, equipped: item.name }
}

async function botChat(msg) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected' }
  b.chat(String(msg))
  return { ok: true }
}

// Run a sequence of bot actions back-to-back with no LLM pauses between
// steps — this is what makes the bot move smoothly like a real player.
async function botRunScript(actions) {
  const b = botReq()
  if (!b) return { ok: false, error: 'bot not connected — call mc_bot_connect first' }
  if (!Array.isArray(actions) || !actions.length) return { ok: false, error: 'actions must be a non-empty array' }
  const results = []
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]
    let r
    try {
      switch (a.type) {
        case 'move': r = await botMove(a.x, a.y, a.z); break
        case 'dig': r = await botDig(a.x, a.y, a.z); break
        case 'place': r = await botPlace(a.x, a.y, a.z); break
        case 'look': r = await botLook(a.yaw, a.pitch); break
        case 'equip': r = await botEquip(a.name); break
        case 'chat': r = await botChat(a.message || a.text); break
        case 'jump': b.setControlState('jump', true); await sleep(120); b.setControlState('jump', false); r = { ok: true }; break
        case 'wait': await sleep(Number(a.ms) || 500); r = { ok: true }; break
        default: r = { ok: false, error: `unknown action type "${a.type}"` }
      }
    } catch (e) {
      r = { ok: false, error: e.message }
    }
    results.push({ i, type: a.type, ...r })
    if (r.ok === false && a.continue !== true) {
      results.push({ stopped: true, at: i, reason: r.error })
      break
    }
  }
  const done = results.filter((r) => r.ok === true).length
  return { ok: true, done, total: actions.length, results }
}

// ---- autonomy engine: LLM-free reflective loop for smooth, continuous play ----
const autonomy = {
  enabled: false,
  task: null,           // { type: 'gather'|'explore', target?, count?, done }
  stats: { tasksDone: 0, blocksMined: 0, startedAt: 0 },
  taskIndex: 0,
  _busy: false,
  _timer: null,
  _moveTarget: null,    // current pathfinder goal key, to avoid re-planning every tick
}

// Self-chosen survival goal cycle: the bot picks its own next goal without
// any player or model input, like a survivor working through its needs.
const SURVIVAL_TASKS = [
  { type: 'gather', target: 'oak_log', label: '砍树收集木材' },
  { type: 'gather', target: 'deepslate', label: '挖深板岩' },
  { type: 'gather', target: 'tuff', label: '挖凝灰岩' },
  { type: 'gather', target: 'deepslate_coal_ore', label: '挖深层煤矿' },
  { type: 'gather', target: 'deepslate_iron_ore', label: '挖深层铁矿' },
  { type: 'gather', target: 'deepslate_lapis_ore', label: '挖青金石矿' },
  { type: 'gather', target: 'stone', label: '挖石头' },
  { type: 'gather', target: 'coal_ore', label: '挖煤矿' },
  { type: 'gather', target: 'iron_ore', label: '挖铁矿' },
  { type: 'explore', label: '探索周围' },
]

function startAutonomy() {
  if (autonomy._timer) return { ok: true, already: true }
  autonomy.enabled = true
  autonomy.stats.startedAt = Date.now()
  autonomy._timer = setInterval(autonomyTick, 400)
  pushLog('[autonomy] 自主模式已开启')
  return { ok: true }
}

function stopAutonomy() {
  autonomy.enabled = false
  if (autonomy._timer) { clearInterval(autonomy._timer); autonomy._timer = null }
  autonomy.task = null
  pushLog('[autonomy] 自主模式已停止')
  return { ok: true }
}

function autonomyStatus() {
  return {
    enabled: autonomy.enabled,
    task: autonomy.task,
    stats: autonomy.stats,
    botConnected: !!bot,
  }
}

async function autonomyTick() {
  if (!autonomy.enabled || !bot || autonomy._busy) return
  autonomy._busy = true
  autonomy._busySince = Date.now()
  try {
    const b = bot
    // reflection: eat when hungry (survival, not avoidance)
    if (b.food !== undefined && b.food < 15) {
      await withTimeout(eatFood(b), 4000)
      return
    }
    // escape lava first (burns to death), then water (drowns)
    if (isInLava(b)) {
      await withTimeout(leaveLava(b), 3000)
      return
    }
    if (isInWater(b)) {
      await withTimeout(swimToLand(b), 3000)
      return
    }
    await withTimeout(runTask(b), 5000)
  } catch (e) {
    // keep the loop alive
  } finally {
    autonomy._busy = false
  }
}

async function eatFood(b) {
  try {
    const food = b.inventory.items().find((i) => /cooked_beef|beef|porkchop|cooked_porkchop|bread|apple|potato|chicken|cooked_chicken|mutton|cooked_mutton|salmon|cooked_salmon|cod|cooked_cod|carrot|melon|golden_apple/.test(i.name))
    if (food) {
      await b.equip(food, 'hand')
      await b.consume()
      pushLog(`[autonomy] 进食 ${food.name}`)
    }
  } catch { /* ignore */ }
}

function isInWater(b) {
  try {
    const p = b.entity.position
    const blk = b.blockAt(new _Vec3(Math.floor(p.x), Math.floor(p.y + 0.4), Math.floor(p.z)))
    return blk && (blk.name === 'water' || blk.name === 'flowing_water')
  } catch { return false }
}

function isInLava(b) {
  try {
    const p = b.entity.position
    const blk = b.blockAt(new _Vec3(Math.floor(p.x), Math.floor(p.y + 0.3), Math.floor(p.z)))
    return blk && (blk.name === 'lava' || blk.name === 'flowing_lava')
  } catch { return false }
}

async function swimToLand(b) {
  // swim up and toward a direction until out of water (not avoidance — avoid drowning)
  const ang = Math.random() * Math.PI * 2
  try { await b.look(ang, 0, true) } catch { /* ignore */ }
  b.setControlState('forward', true)
  b.setControlState('jump', true)
  await sleep(700)
  b.setControlState('jump', false)
  await sleep(300)
  b.setControlState('forward', false)
}

async function leaveLava(b) {
  // find the nearest non-lava block at foot level and move toward it, jumping
  const p = b.entity.position
  let best = null, bestDist = Infinity
  try {
    for (let dx = -6; dx <= 6; dx++) {
      for (let dz = -6; dz <= 6; dz++) {
        if (dx === 0 && dz === 0) continue
        const blk = b.blockAt(new _Vec3(Math.floor(p.x) + dx, Math.floor(p.y), Math.floor(p.z) + dz))
        if (blk && blk.name !== 'lava' && blk.name !== 'flowing_lava' && blk.name !== 'air') {
          const d = dx * dx + dz * dz
          if (d < bestDist) { bestDist = d; best = { dx, dz } }
        }
      }
    }
  } catch { /* ignore */ }
  if (best) {
    const yaw = Math.atan2(-best.dx, -best.dz)
    try { await b.look(yaw, 0, true) } catch { /* ignore */ }
  }
  b.setControlState('forward', true)
  b.setControlState('jump', true)
  await sleep(800)
  b.setControlState('jump', false)
  await sleep(200)
  b.setControlState('forward', false)
}

async function runTask(b) {
  if (!autonomy.task) {
    // 1. unified LLM decision (task + speech) based on real state
    const d = await llmDecideNextTask()
    if (d && d.task) {
      const tm = String(d.task).match(/^(gather|explore|idle)(?:\s+([a-z0-9_]+))?/)
      if (tm && tm[1] !== 'idle') {
        autonomy.task = { type: tm[1], target: tm[1] === 'gather' ? (tm[2] || 'deepslate') : undefined, count: 8, done: false }
        pushLog(`[autonomy] LLM 决策：${d.task}`)
        if (d.say) { try { b.chat(d.say) } catch { /* ignore */ }; pushLog(`[autonomy] 说话: ${d.say}`) }
        return
      }
    }
    // 2. fallback: self-chosen survival goal
    const t = SURVIVAL_TASKS[autonomy.taskIndex % SURVIVAL_TASKS.length]
    autonomy.taskIndex++
    autonomy.task = { type: t.type, target: t.target, count: 8, done: false }
    pushLog(`[autonomy] 自主目标：${t.label}`)
    maybeSpeak(`我现在去${t.label}了`)
  }
  const t = autonomy.task
  if (t.done) {
    autonomy.stats.tasksDone++
    pushLog(`[autonomy] 任务完成：${t.type} ${t.target || ''}（已累计完成 ${autonomy.stats.tasksDone} 个目标）`)
    autonomy.task = null
    return
  }
  if (t.type === 'gather') await gatherTask(b, t)
  else if (t.type === 'explore') await exploreTask(b, t)
  else autonomy.task = null
}

async function gatherTask(b, t) {
  // don't re-plan while already pathing to a target (this was the "bot won't move" bug)
  if (b.pathfinder.isMoving && b.pathfinder.isMoving()) return
  let block = null
  const by = Math.floor(b.entity.position.y)
  try {
    block = await withTimeout(b.findBlock({
      matching: (blk) => {
        if (blk.name !== t.target) return false
        // only target blocks the bot can actually reach (same height or below feet)
        return blk.position.y <= by + 2 && blk.position.y >= by - 2
      },
      maxDistance: 20,
      count: 1,
    }), 5000, null)
  } catch { block = null }
  if (!block) {
    // nothing nearby: wander to search, don't just give up
    t.missCount = (t.missCount || 0) + 1
    if (t.missCount > 8) {
      t.done = true
      pushLog(`[autonomy] 找不到 ${t.target}（${t.missCount} 次），切换目标`)
    } else {
      // direct walk + jump toward a random direction (pathfinder is unreliable underground)
      const ang = Math.random() * Math.PI * 2
      await b.look(ang, 0, true).catch(() => {})
      b.setControlState('forward', true)
      b.setControlState('jump', true)
      await sleep(500)
      b.setControlState('jump', false)
      await sleep(700)
      b.setControlState('forward', false)
    }
    return
  }
  t.missCount = 0
  const dist = block.position.distanceTo(b.entity.position)
  if (dist > 3) {
    // walk directly toward the block (pathfinder is unreliable)
    const dx = block.position.x - b.entity.position.x
    const dz = block.position.z - b.entity.position.z
    const yaw = Math.atan2(-dx, -dz)
    try { await b.look(yaw, 0, true) } catch { /* ignore */ }
    b.setControlState('forward', true)
    b.setControlState('jump', true)
    await sleep(300)
    b.setControlState('jump', false)
    await sleep(700)
    pushLog(`[autonomy] 走向 ${t.target}@(${block.position.x},${block.position.y},${block.position.z})，距离 ${Math.round(dist)}`)
  } else {
    b.setControlState('forward', false)
    try {
      // equip the right tool (pickaxe for stone/ore, axe for wood)
      const toolRe = /ore|stone|deepslate|tuff|granite|diorite|andesite|cobblestone/.test(block.name)
        ? /pickaxe/ : (/log|wood|planks/.test(block.name) ? /axe/ : null)
      if (toolRe) {
        const tool = b.inventory.items().find((i) => toolRe.test(i.name))
        if (tool) { try { await withTimeout(b.equip(tool, 'hand'), 2000) } catch { /* ignore */ } }
      }
      await withTimeout(b.dig(block), 4000)
      autonomy.stats.blocksMined++
      pushLog(`[autonomy] 挖了 ${block.name}`)
      if (/ore|diamond|emerald|gold/.test(block.name)) {
        maybeSpeak(`我挖到 ${block.name} 了！`)
      }
    } catch (e) {
      pushLog(`[autonomy] 挖掘失败: ${e.message}`)
    }
  }
}

async function exploreTask(b, t) {
  const now = Date.now()
  // keep walking forward (control state persists between ticks)
  b.setControlState('forward', true)
  b.setControlState('sprint', true)
  // every ~3s turn to a new random heading and jump, so it roams the map
  if (!t.lastTurn || now - t.lastTurn > 3000) {
    t.lastTurn = now
    const ang = Math.random() * Math.PI * 2
    try { await b.look(ang, 0, true) } catch { /* ignore */ }
    b.setControlState('jump', true)
    await sleep(250)
    b.setControlState('jump', false)
    pushLog(`[autonomy] 跑图转向 (${Math.round(b.entity.position.x)},${Math.round(b.entity.position.z)})`)
  }
  // roam for a while, then mark done so the model re-decides
  t.roamed = (t.roamed || 0) + 1
  if (t.roamed >= 12) {
    t.done = true
    b.setControlState('forward', false)
    b.setControlState('sprint', false)
  }
}

// ---- social layer: the bot chats back like a friend, via the default model ----
const SOCIAL_SYSTEM_PROMPT = '你是 Minecraft 世界里玩家的 AI 伙伴。你正在这个世界里生存（采集、探索、建造）。玩家会通过聊天和你说话。请像朋友一样自然、简短地回应（一般 1-2 句话，30 字以内），语气轻松友好，必要时可以报告你正在做的事（如"我在砍树""我刚挖到煤"）。不要用列表或格式，就像真人聊天。'

// Command parser: the player can direct the AI from in-game chat, not just chat.
const COMMAND_SYSTEM = '你是 Minecraft 世界里玩家的 AI 伙伴。玩家通过游戏聊天发消息。请判断意图，只返回一行 JSON（不要任何其他文字）：\n1. 若玩家让你做某件事（砍树/挖矿/采集/探索/过来/建房子/去找X），返回 {"action":"task","task":"gather <英文方块名> 或 explore","reply":"一句简短确认"}（方块名用英文，如 oak_log/stone/coal_ore/iron_ore；"过来/找我"用 explore）。\n2. 若是闲聊、问候、提问，返回 {"action":"chat","reply":"简短自然回复，30字内"}。'

// Unified decision: the model picks the next task AND what to say, based on
// real game state, so the bot's words match its actions.
const DECISION_SYSTEM = '你是 Minecraft 世界里自主生存的 AI 伙伴。根据给你的当前状态，决定下一步行动并说一句话。只返回一行 JSON（不要任何其他文字）：{"task":"gather <英文方块名> 或 explore 或 idle","say":"一句简短的话（30字内，说明你要做什么）"}。方块名用英文。要根据状态选：周围有矿石就挖矿，在地下就挖深板岩/凝灰岩，在地面就砍树或挖石头，没目标就 explore。说的话要和任务一致。'

async function llmDecideNextTask() {
  const b = bot
  if (!b) return null
  const s = botState()
  const p = s.position
  const near = (s.nearBlocks || []).map((x) => x.name).join(', ')
  const inv = (s.inventory || []).slice(0, 9).map((i) => `${i.name}×${i.count}`).join(', ')
  const summary = `位置=(${p ? `${p.x},${p.y},${p.z}` : '?'}) 血量=${s.health} 饥饿=${s.food} 手持=${s.heldItem ? s.heldItem.name : '无'} 快捷栏=[${inv}] 周围方块=[${near}] 已完成${autonomy.stats.tasksDone}个目标`
  const parsed = await withTimeout(llmChat(DECISION_SYSTEM, summary, 600), 15000, null)
  if (!parsed) return null
  const m = parsed.match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const obj = JSON.parse(m[0])
    return { task: obj.task, say: obj.say }
  } catch { return null }
}

let _lastSpeak = 0
function maybeSpeak(text) {
  if (!bot || !text) return
  const now = Date.now()
  if (now - _lastSpeak < 20000) return // throttle: at most once per 20s
  _lastSpeak = now
  try { bot.chat(text) } catch { /* ignore */ }
  pushLog(`[autonomy] 主动说话: ${text}`)
}

function userMessage(text) {
  return {
    id: 'mc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

async function llmChat(system, userText, maxTokens = 200) {
  if (!autonomyCtx || !autonomyCtx.llm) { pushLog('[llm] no ctx/llm service'); return null }
  try {
    const sel = autonomyCtx.agentDefaultModel.currentSelection()
    let text = ''
    let reasoning = ''
    for await (const chunk of autonomyCtx.llm.stream({
      provider: sel.provider,
      model: sel.model,
      messages: [userMessage(userText)],
      system,
      maxTokens,
    })) {
      if (chunk.type === 'text-delta') text += chunk.text
      else if (chunk.type === 'reasoning-delta') reasoning += chunk.text
      else if (chunk.type === 'error' || chunk.type === 'aborted') { pushLog('[llm] chunk error: ' + JSON.stringify(chunk).slice(0, 200)); break }
    }
    if (!text) {
      pushLog(`[llm] empty text (reasoning ${reasoning.length} chars)`)
      if (reasoning) return reasoning.slice(0, 300)
      return null
    }
    return text.trim() || null
  } catch (e) {
    pushLog('[llm] error: ' + e.message)
    return null
  }
}

let _replying = false

// instant rule-based replies for common greetings so chat feels snappy
const QUICK_REPLIES = [
  { re: /^(你好|您好|在吗|在不在|hi|hello|hey|嗨|哈喽|nihao|ni hao)/i, replies: ['我在呢！', '你好呀～', '在的，怎么啦？', '嗨！我在'] },
  { re: /(干嘛|做什么|忙什么|在干啥)/, replies: ['在附近采集资源呢', '正在砍树，攒点木头', '四处逛逛看看有没有矿'] },
  { re: /(谢谢|thanks|thank you|谢了|多谢)/i, replies: ['不客气！', '应该的～', '小事儿！'] },
  { re: /(在哪|位置|坐标)/, replies: ['我就在你附近，看地图上的蓝点'] },
]

function quickReply(message) {
  for (const q of QUICK_REPLIES) {
    if (q.re.test(message)) return q.replies[Math.floor(Math.random() * q.replies.length)]
  }
  return null
}

async function onPlayerChat(username, message) {
  if (_replying) return
  if (message.startsWith('/')) return // ignore commands
  _replying = true
  try {
    const b = bot
    if (!b) return
    // 0. in-game map request
    if (/地图|map|小地图/.test(message)) {
      const mm = asciiMap()
      if (mm) {
        b.chat('\u5730\u56fe\uff08B=\u6211\uff0cP=\u4f60\uff0c~=\u6c34\uff0c*=\u94bb\u77f3\uff09\uff1a')
        for (const row of mm.rows) { b.chat(row); await sleep(80) }
        if (mm.player) b.chat(`\u6211\u5728(${mm.bot.x},${mm.bot.z})\uff0c\u4f60\u5728(${mm.player.x},${mm.player.z})`)
      } else {
        b.chat('\u6211\u8fd8\u6ca1\u8fde\u8fdb\u4e16\u754c\uff0c\u8fde\u4e0a\u540e\u5c31\u80fd\u770b\u5730\u56fe\u4e86')
      }
      return
    }
    // 1. instant rule-based replies for common greetings
    const quick = quickReply(message)
    if (quick) { b.chat(quick); pushLog(`[social] 快速回复 ${username}: ${quick}`); return }
    // 2. parse intent: is it a task command or small talk?
    const parsed = await withTimeout(llmChat(COMMAND_SYSTEM, `玩家 ${username} 说：${message}`, 250), 10000, null)
    if (parsed) {
      const m = parsed.match(/\{[\s\S]*\}/)
      if (m) {
        try {
          const obj = JSON.parse(m[0])
          if (obj.action === 'task' && obj.task) {
            const tm = String(obj.task).match(/^(gather|explore)(?:\s+([a-z0-9_]+))?/)
            if (tm) {
              if (!autonomy.enabled) startAutonomy()
              autonomy.task = { type: tm[1], target: tm[1] === 'gather' ? (tm[2] || 'oak_log') : undefined, count: 8, done: false }
              pushLog(`[social] ${username} 指令 → 任务: ${tm[1]} ${tm[2] || ''}`)
              b.chat(obj.reply || '\u597d\u7684\uff0c\u6211\u8fd9\u5c31\u53bb\uff01')
            } else {
              b.chat(obj.reply || parsed)
            }
            return
          }
          if (obj.action === 'chat' && obj.reply) { b.chat(obj.reply); return }
        } catch { /* fall through to social reply */ }
      }
    }
    // 3. fallback: social LLM reply
    const p = b.entity && b.entity.position
    const loc = p ? `（我当前在 (${Math.round(p.x)}, ${Math.round(p.y)}, ${Math.round(p.z)})）` : ''
    const reply = await withTimeout(llmChat(SOCIAL_SYSTEM_PROMPT, `玩家 ${username} 说：${message}\n${loc}`, 120), 10000, null)
    if (reply) {
      b.chat(reply)
      pushLog(`[social] 回复 ${username}: ${reply}`)
    }
  } catch (e) { /* ignore */ }
  finally {
    _replying = false
  }
}

// Automatically open the single-player world to LAN via keyboard navigation:
// Esc -> menu, Down x3 to "Open to LAN" (Back to Game / Advancements /
// Statistics / Open to LAN), Enter, then Enter to confirm the dialog.
async function openLan() {
  const win = await findGameWindow()
  if (!win) return { ok: false, error: 'no Minecraft window found (start the game first)' }
  await sh('xdotool', ['windowactivate', '--sync', win])
  await sh('xdotool', ['windowfocus', '--sync', win])
  await sleep(200)
  await sh('xdotool', ['key', '--window', win, 'Escape'])
  await sleep(450)
  for (let i = 0; i < 3; i++) { await sh('xdotool', ['key', '--window', win, 'Down']); await sleep(110) }
  await sh('xdotool', ['key', '--window', win, 'Return'])
  await sleep(500)
  await sh('xdotool', ['key', '--window', win, 'Return'])
  await sleep(700)
  const port = lanPortFromLogs()
  if (port) return { ok: true, port }
  // fallback: try reading the latest log line mentioning a port
  return { ok: false, error: 'could not detect LAN port — open LAN manually (Esc → Open to LAN) or check the game chat for the port', port }
}

function readCrashReport() {
  const gameDir = MC_DIR()
  const crashDir = path.join(gameDir, 'crash-reports')
  let crash = null
  try {
    const files = fs.readdirSync(crashDir).filter((f) => f.endsWith('.txt'))
    if (files.length) {
      files.sort()
      const latest = path.join(crashDir, files[files.length - 1])
      crash = fs.readFileSync(latest, 'utf8').slice(0, 6000)
    }
  } catch { /* no crash reports */ }

  let logTail = ''
  try {
    const logFile = path.join(gameDir, 'logs', 'latest.log')
    const raw = fs.readFileSync(logFile, 'utf8')
    logTail = raw.split('\n').slice(-120).join('\n')
  } catch { /* no log */ }

  return { crash, logTail, recentLauncherLogs: store.game.logs.slice(-60).join('\n') }
}

function worldInfo() {
  const savesDir = path.join(MC_DIR(), 'saves')
  const worlds = []
  try {
    for (const name of fs.readdirSync(savesDir)) {
      const dir = path.join(savesDir, name)
      if (!fs.statSync(dir).isDirectory()) continue
      const statsDir = path.join(dir, 'stats')
      let playTicks = 0
      let mined = 0
      let deaths = 0
      try {
        for (const f of fs.readdirSync(statsDir)) {
          if (!f.endsWith('.json')) continue
          const s = JSON.parse(fs.readFileSync(path.join(statsDir, f), 'utf8'))
          const m = s.stats?.['minecraft:custom'] || {}
          playTicks = Math.max(playTicks, m['minecraft:play_one_minute'] || 0)
          mined = Math.max(mined, m['minecraft:mined'] || 0)
          deaths = Math.max(deaths, m['minecraft:deaths'] || 0)
        }
      } catch { /* no stats */ }
      let lastPlayed = ''
      try { lastPlayed = fs.statSync(dir).mtime.toISOString() } catch { /* ignore */ }
      worlds.push({
        name,
        playHours: +(playTicks / 20 / 3600).toFixed(1),
        deaths,
        lastPlayed,
      })
    }
  } catch { /* no saves */ }
  return worlds
}

function modsList() {
  const modsDir = path.join(MC_DIR(), 'mods')
  const mods = []
  try {
    for (const f of fs.readdirSync(modsDir)) {
      if (!f.endsWith('.jar')) continue
      const jarPath = path.join(modsDir, f)
      let meta = null
      if (AdmZip) {
        try {
          const zip = new AdmZip(jarPath)
          for (const candidate of ['fabric.mod.json', 'META-INF/mods.toml', 'mcmod.info']) {
            const entry = zip.getEntry(candidate)
            if (entry) {
              const raw = entry.getData().toString('utf8')
              if (candidate === 'fabric.mod.json') {
                const j = JSON.parse(raw)
                meta = { name: j.name || f, version: j.version || '', loader: 'fabric' }
              } else if (candidate === 'META-INF/mods.toml') {
                const m = raw.match(/modId\s*=\s*"([^"]+)"/)
                const v = raw.match(/version\s*=\s*"([^"]+)"/)
                meta = { name: m ? m[1] : f, version: v ? v[1] : '', loader: 'forge' }
              }
              break
            }
          }
        } catch { /* unreadable jar */ }
      }
      mods.push({ file: f, ...(meta || { name: f.replace(/\.jar$/, ''), version: '', loader: 'unknown' }) })
    }
  } catch { /* no mods dir */ }
  return mods
}

function versionAdvice() {
  const installed = installedVersions().map((v) => v.id)
  const manifest = store.manifest
  const latest = manifest ? manifest.latest : null
  const installedRelease = installed.find((id) => !/-snapshot|pre|rc/i.test(id))
  return {
    installed,
    latest,
    suggestion: installedRelease && latest && installedRelease !== latest.release
      ? `installed ${installedRelease}; latest release is ${latest.release} (upgrade if you want the newest features)`
      : 'already on the latest release',
  }
}

function toolResult(renderText) {
  return (args, value) => [{ type: 'text', text: typeof renderText === 'string' ? renderText : JSON.stringify(value, null, 2) }]
}

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

export function apply(ctx) {
  autonomyCtx = ctx
  loadSettings()
  ensureDir(DATA_DIR)
  loadGoals()
  logState('boot', `launcher backend ready (gameDir=${MC_DIR()})`)

  const webServer = ctx.webServer
  const disposeRoute = webServer.register({
    kind: 'prefix',
    path: '/api/mc',
    handler: route,
  })
  ctx.effect(() => disposeRoute)

  // OAuth2 PKCE browser sign-in (separate routes: start returns the authorize
  // URL as JSON; callback handles the redirect and shows a result page).
  const disposeOauthStart = webServer.register({
    kind: 'exact',
    path: '/api/mc/oauth/start',
    handler: (req, res) => {
      try {
        json(res, 200, { authorizeUrl: oauthStart(webServer.port) })
      } catch (e) {
        json(res, 400, { error: e.message })
      }
    },
  })
  const disposeOauthCb = webServer.register({
    kind: 'exact',
    path: '/api/mc/oauth/callback',
    handler: async (req, res) => {
      const u = new URL(req.url, 'http://localhost')
      const code = u.searchParams.get('code')
      const state = u.searchParams.get('state')
      const err = u.searchParams.get('error_description') || u.searchParams.get('error')
      let html
      if (err) {
        html = oauthCallbackHtml(false, String(err))
      } else if (!code) {
        html = oauthCallbackHtml(false, 'No authorization code in callback.')
      } else {
        try {
          const account = await oauthCallback(code, state, webServer.port)
          html = oauthCallbackHtml(true, `Signed in as ${account.name} (${account.uuid})`)
        } catch (e) {
          html = oauthCallbackHtml(false, e.message)
        }
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(html)
    },
  })
  ctx.effect(() => { disposeOauthStart(); disposeOauthCb() })

  // ---- live game state auto-injected into the model context each step ----
  // The agent "sees" the bot's position/health/inventory directly every turn,
  // no need to call mc_bot_state just to check the situation.
  const disposeLiveContext = ctx.systemPrompt.context({
    name: 'minecraft-live-state',
    order: 250,
    text: () => formatLiveState(),
  })
  ctx.effect(() => disposeLiveContext)

  // ---- auto-reconnect: when the game opens to LAN, join the bot and start autonomy ----
  let _reconnecting = false
  let _lastFail = 0
  let _tickCount = 0
  pushLog('[auto] 自动重连监视器已启动')
  const autoReconnectTimer = setInterval(async () => {
    _tickCount++
    if (!store.settings.autoReconnect) return
    if (_reconnecting || bot) return
    if (Date.now() - _lastFail < 60000) return // back off 60s after a failed connect
    const port = lanPortFromLogs()
    if (_tickCount <= 3) pushLog(`[auto] tick ${_tickCount}: port=${port}`)
    if (!port) return
    _reconnecting = true
    try {
      const r = await botConnect(port)
      if (r.ok) {
        pushLog(`[auto] 自动连接 bot 到端口 ${port}`)
        startAutonomy()
      }
    } catch (e) {
      _lastFail = Date.now()
      pushLog(`[auto] 自动连接失败: ${e.message}`)
    }
    _reconnecting = false
  }, 15000)
  ctx.effect(() => () => clearInterval(autoReconnectTimer))

  // ---- agent tools: bring the launcher into DSH conversations ----
  const tools = ctx.tools

  tools.register(defineTool({
    name: 'mc_list_versions',
    description: 'List Minecraft versions: locally installed ones plus the latest release/snapshot from Mojang. Use to see what is available or already installed.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      const manifest = await getManifest()
      const installed = installedVersions()
      return { installed, latest: manifest.latest, count: manifest.versions.length }
    },
  }))

  tools.register(defineTool({
    name: 'mc_install',
    description: 'Install a Minecraft version (downloads client jar, libraries, and assets from Mojang official servers). Returns immediately; track progress with mc_status.',
    parameters: {
      id: { type: 'string', required: true, description: 'Minecraft version id, e.g. "1.21.11" (see mc_list_versions)' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      if (store.downloadBusy) return { ok: false, error: 'another install is running' }
      installVersion(args.id)
      return { ok: true, id: args.id, note: 'installation started; poll mc_status for progress' }
    },
  }))

  tools.register(defineTool({
    name: 'mc_launch',
    description: 'Launch an installed Minecraft version. Requires the user to be signed in with a Microsoft account first.',
    parameters: {
      id: { type: 'string', description: 'Version id; defaults to the selected one' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      const id = args.id || store.selected
      if (!id) return { ok: false, error: 'no version selected' }
      if (store.game.running) return { ok: false, error: 'game already running' }
      if (!store.account) return { ok: false, error: 'not signed in — playing Minecraft requires a valid, legitimately purchased account' }
      const account = store.account
      const java = await detectJava()
      store.javaInfo = java
      if (!java) return { ok: false, error: 'no Java runtime found' }
      const r = launch(id, account)
      return { ok: true, pid: r.pid, id }
    },
  }))

  tools.register(defineTool({
    name: 'mc_kill',
    description: 'Stop the running Minecraft game process (SIGTERM).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      if (store.game.pid) {
        try { process.kill(store.game.pid) } catch { /* gone */ }
        store.game.running = false
        return { ok: true }
      }
      return { ok: false, error: 'game not running' }
    },
  }))

  tools.register(defineTool({
    name: 'mc_logs',
    description: 'Read recent launcher/game logs from the ring buffer. Useful for diagnosing launch or runtime problems.',
    parameters: {
      lines: { type: 'number', description: 'How many recent lines to return (default 50, max 300)' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      const n = Math.min(300, Math.max(1, Number(args.lines) || 50))
      return { lines: store.game.logs.slice(-n) }
    },
  }))

  tools.register(defineTool({
    name: 'mc_status',
    description: 'Launcher status: account, selected version, Java runtime, active download progress, and running game state.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      const java = await detectJava()
      store.javaInfo = java
      return {
        account: store.account ? { name: store.account.name, uuid: store.account.uuid } : null,
        selected: store.selected,
        java: java ? java.version : null,
        download: store.download ? { version: store.download.version, stage: store.download.stage, filesDone: store.download.filesDone, filesTotal: store.download.filesTotal, current: store.download.current && store.download.current.name, error: store.download.error } : null,
        game: { running: store.game.running, exitCode: store.game.exitCode },
        settings: { gameDir: MC_DIR(), memoryMb: store.settings.memoryMb },
      }
    },
  }))

  tools.register(defineTool({
    name: 'mc_analyze_crash',
    description: 'Read the latest Minecraft crash report and recent game log so the model can diagnose a crash. Returns raw text for analysis.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      const data = readCrashReport()
      if (!data.crash && !data.logTail && !data.recentLauncherLogs) {
        return { hasCrash: false, note: 'no crash reports or logs found' }
      }
      return { hasCrash: !!data.crash, ...data }
    },
  }))

  tools.register(defineTool({
    name: 'mc_world_info',
    description: 'List local Minecraft worlds (saves) with play time and deaths, read from each world\'s stats files.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      return { worlds: worldInfo() }
    },
  }))

  tools.register(defineTool({
    name: 'mc_mods',
    description: 'List installed mods (mods/ directory) with their loader and version, parsed from fabric.mod.json / mods.toml metadata.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      return { mods: modsList() }
    },
  }))

  tools.register(defineTool({
    name: 'mc_version_advice',
    description: 'Suggest a Minecraft version: compare installed versions against the latest release from Mojang.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      await getManifest()
      return versionAdvice()
    },
  }))

  // ---- autonomous play: persona-driven goal planning (visual/keyboard control
  // is intentionally left as a pluggable seam for a future vision-capable model) ----
  tools.register(defineTool({
    name: 'mc_goals',
    description: 'Read the current autonomous-play goal list for the active persona (see mc_set_goals). Returns the persona and each goal with its done status.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      return loadGoals()
    },
  }))

  tools.register(defineTool({
    name: 'mc_set_goals',
    description: 'Set up autonomous play: store a persona (who the AI is role-playing) and a list of at least 20 concrete, achievable in-game goals. Goals should build on the current game state (use mc_status / mc_world_info / mc_mods first). Persisted to disk; then work through them with mc_goals + mc_complete_goal, re-observing game state between actions.',
    parameters: {
      persona: { type: 'string', required: true, description: 'The persona/character the AI role-plays, e.g. "a cautious survivalist who builds a farm" or "an explorer mapping the whole world"' },
      goals: { type: 'string', required: true, description: 'JSON-encoded array of at least 20 goal strings, e.g. \'["punch a tree and craft a crafting table","mine 64 cobblestone","build a wooden house","..." ]\'' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      let goals
      try { goals = JSON.parse(args.goals) } catch { return { ok: false, error: 'goals must be a JSON-encoded array of strings' } }
      if (!Array.isArray(goals) || goals.length < 20) return { ok: false, error: `need at least 20 goals, got ${Array.isArray(goals) ? goals.length : 'non-array'}` }
      const g = saveGoals({ persona: args.persona, goals: goals.map((t) => ({ text: String(t), done: false })) })
      return { ok: true, count: g.goals.length, persona: g.persona }
    },
  }))

  tools.register(defineTool({
    name: 'mc_complete_goal',
    description: 'Mark one goal in the autonomous-play list as complete (or un-complete) by index. Use after verifying the goal was actually achieved.',
    parameters: {
      index: { type: 'number', required: true, description: '0-based index of the goal in the list (see mc_goals)' },
      done: { type: 'boolean', description: 'true to mark done (default), false to mark not done' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      const g = loadGoals()
      const i = Number(args.index)
      if (!g.goals[i]) return { ok: false, error: `no goal at index ${i}` }
      g.goals[i].done = args.done !== false
      saveGoals(g)
      return { ok: true, done: g.goals.filter((x) => x.done).length, total: g.goals.length }
    },
  }))

  // ---- vision + control: let the agent see and play the game (X11 + Qwen-VL) ----
  tools.register(defineTool({
    name: 'mc_screenshot',
    description: 'Capture a screenshot of the running Minecraft game window (X11). Requires the game to be running in a window on the same display. Saves the PNG locally and returns its path, ready for mc_see.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      return mcScreenshot()
    },
  }))

  tools.register(defineTool({
    name: 'mc_see',
    description: 'Analyze a Minecraft game screenshot with a vision model (DashScope Qwen-VL) and return a text description of what is on screen — environment, threats, player status. Use mc_screenshot first, then mc_see to understand the current situation before acting.',
    parameters: {
      path: { type: 'string', description: 'Screenshot path; defaults to the most recent mc_screenshot' },
      prompt: { type: 'string', description: 'Optional question or description focus for the vision model' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      return mcSee(args.path, args.prompt)
    },
  }))

  tools.register(defineTool({
    name: 'mc_control',
    description: 'Send keyboard/mouse input to the running Minecraft window. action: forward/back/left/right (move, hold ms), jump/sneak/sprint, inventory/drop/chat/escape, slot1..slot9, attack (left-click/break), use (right-click/place), look (turn view by dx/dy mouse).',
    parameters: {
      action: { type: 'string', required: true, description: 'One of: forward, back, left, right, jump, sneak, sprint, inventory, drop, chat, escape, slot1..slot9, attack, use, look' },
      ms: { type: 'number', description: 'Hold time in ms for movement keys (default 400)' },
      dx: { type: 'number', description: 'Horizontal mouse delta for look' },
      dy: { type: 'number', description: 'Vertical mouse delta for look' },
      text: { type: 'string', description: 'Text to type (for action "type", e.g. a chat command)' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      return mcControl(args.action, { ms: args.ms, dx: args.dx, dy: args.dy })
    },
  }))

  // ---- Mineflayer bot tools: fast, precise data + control via the LAN protocol ----
  tools.register(defineTool({
    name: 'mc_bot_connect',
    description: 'Connect a bot into the running single-player world via LAN (fast, precise alternative to screenshots). The game must be open to LAN first (Esc → Open to LAN). Port is auto-detected from game logs if omitted.',
    parameters: {
      port: { type: 'number', description: 'LAN port (auto-detected from logs if omitted)' },
      username: { type: 'string', description: 'Bot name (default DSH-Bot)' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      return botConnect(args.port, args.username)
    },
  }))

  tools.register(defineTool({
    name: 'mc_bot_state',
    description: 'Read the bot\'s live in-game state: position, health, food, gamemode, held item, inventory and nearby blocks. Much faster and more precise than screenshots.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() { return botState() },
  }))

  tools.register(defineTool({
    name: 'mc_bot_move',
    description: 'Move the bot to a block coordinate (pathfinding). Returns when the goal is reached or times out.',
    parameters: {
      x: { type: 'number', required: true, description: 'Target x' },
      y: { type: 'number', required: true, description: 'Target y' },
      z: { type: 'number', required: true, description: 'Target z' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botMove(args.x, args.y, args.z) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_look',
    description: 'Turn the bot\'s head to a yaw/pitch (radians).',
    parameters: {
      yaw: { type: 'number', description: 'Yaw in radians' },
      pitch: { type: 'number', description: 'Pitch in radians' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botLook(args.yaw, args.pitch) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_dig',
    description: 'Make the bot mine/break the block at (x,y,z).',
    parameters: {
      x: { type: 'number', required: true, description: 'Block x' },
      y: { type: 'number', required: true, description: 'Block y' },
      z: { type: 'number', required: true, description: 'Block z' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botDig(args.x, args.y, args.z) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_place',
    description: 'Place the currently held block at (x,y,z).',
    parameters: {
      x: { type: 'number', required: true, description: 'Target x' },
      y: { type: 'number', required: true, description: 'Target y' },
      z: { type: 'number', required: true, description: 'Target z' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botPlace(args.x, args.y, args.z) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_equip',
    description: 'Equip an inventory item in the bot\'s hand by name (e.g. "stone_pickaxe", "diamond_sword", "cobblestone").',
    parameters: {
      name: { type: 'string', required: true, description: 'Item name or substring' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botEquip(args.name) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_chat',
    description: 'Send a chat message or game command from the bot (prefix "/" for commands, e.g. "/time set day").',
    parameters: {
      message: { type: 'string', required: true, description: 'Message or command' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) { return botChat(args.message) },
  }))

  tools.register(defineTool({
    name: 'mc_bot_disconnect',
    description: 'Disconnect the bot from the world.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      if (bot) { try { bot.end() } catch { /* ignore */ } bot = null }
      return { ok: true }
    },
  }))

  tools.register(defineTool({
    name: 'mc_open_lan',
    description: 'Automatically open the single-player world to LAN via keyboard navigation (Esc → Open to LAN → confirm) and return the LAN port. Use before mc_bot_connect so the bot can join.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() {
      return openLan()
    },
  }))

  tools.register(defineTool({
    name: 'mc_bot_script',
    description: 'Run a whole sequence of bot actions back-to-back with NO pauses between steps — this makes the bot move smoothly like a real player. PREFER this over calling mc_bot_move/dig/place one at a time. Pass a JSON array of actions: [{"type":"move","x":..,"y":..,"z":..},{"type":"dig","x":..,"y":..,"z":..},{"type":"place",...},{"type":"look","yaw":..,"pitch":..},{"type":"equip","name":".."},{"type":"chat","message":".."},{"type":"jump"},{"type":"wait","ms":500}]. Plan 10-30 actions at once for smooth, human-like behavior.',
    parameters: {
      actions: { type: 'string', required: true, description: 'JSON-encoded array of action objects' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      let actions
      try { actions = JSON.parse(args.actions) } catch { return { ok: false, error: 'actions must be a JSON-encoded array' } }
      return botRunScript(actions)
    },
  }))

  // ---- autonomy tools: the bot survives/plays on its own without LLM per-step ----
  tools.register(defineTool({
    name: 'mc_autonomy_start',
    description: 'Start autonomous mode: the bot continuously plays on its own (eats when hungry, roams the map, gathers resources) WITHOUT needing the model to decide every step — smooth and human-like. The model only sets a task and lets the engine run it.',
    parameters: {
      task: { type: 'string', description: 'Initial task, e.g. "gather oak_log" or "explore". Defaults to gathering oak_log.' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      const r = startAutonomy()
      if (args && args.task) {
        const m = String(args.task).match(/^(gather|explore)(?:\s+(\w+))?/)
        if (m) {
          autonomy.task = { type: m[1], target: m[1] === 'gather' ? (m[2] || 'oak_log') : undefined, count: 8, done: false }
        }
      }
      return r
    },
  }))

  tools.register(defineTool({
    name: 'mc_autonomy_stop',
    description: 'Stop autonomous mode.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() { return stopAutonomy() },
  }))

  tools.register(defineTool({
    name: 'mc_autonomy_status',
    description: 'Get autonomous mode status: enabled, current task, and stats (tasks done, blocks mined).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute() { return autonomyStatus() },
  }))

  tools.register(defineTool({
    name: 'mc_autonomy_task',
    description: 'Set the current autonomous task while the engine keeps running it smoothly. task: "gather <block>" (e.g. gather stone, gather coal_ore) or "explore".',
    parameters: {
      task: { type: 'string', required: true, description: 'e.g. "gather oak_log", "gather stone", "explore"' },
    },
    output: { schema: { type: 'object', additionalProperties: true, properties: {} }, render: toolResult() },
    async execute(args) {
      if (!autonomy.enabled) return { ok: false, error: 'autonomy not started — call mc_autonomy_start first' }
      const m = String(args.task).match(/^(gather|explore)(?:\s+(\w+))?/)
      if (!m) return { ok: false, error: 'task must be "gather <block>" or "explore"' }
      autonomy.task = { type: m[1], target: m[1] === 'gather' ? (m[2] || 'oak_log') : undefined, count: 8, done: false }
      return { ok: true, task: autonomy.task }
    },
  }))
}
