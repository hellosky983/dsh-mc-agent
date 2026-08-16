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
export const inject = ['webServer', 'tools']

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
  clientId: '', // register your own Azure app; see README (using a third-party client id is not allowed by Microsoft terms)
  width: null,
  height: null,
  fullscreen: false,
  eulaAccepted: false,
  uiMode: 'tab', // 'tab' = a Minecraft tab inside the DSH chat UI; 'fullscreen' = replace the whole page
  showTab: true, // when uiMode is 'tab', whether to show the Minecraft tab in the session
  theme: { preset: 'default', accent: '' }, // 'default' | 'light' | 'ocean' | 'end' | 'lava'; accent overrides the primary color
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

async function xblAuthenticate(accessToken) {
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: msAuthHeaders(),
    body: JSON.stringify({
      Properties: { AuthMethod: 'RST', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${accessToken}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    }),
  })
  if (!res.ok) throw new Error(`XBL auth failed HTTP ${res.status}`)
  const data = await res.json()
  const uhs = data.DisplayClaims && data.DisplayClaims.xui && data.DisplayClaims.xui[0] && data.DisplayClaims.xui[0].uhs
  if (!uhs) throw new Error('XBL auth missing uhs')
  return { token: data.Token, uhs }
}

async function xstsAuthenticate(xblToken) {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: msAuthHeaders(),
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
  if (!res.ok) throw new Error(`XSTS auth failed HTTP ${res.status}`)
  const data = await res.json()
  const uhs = data.DisplayClaims && data.DisplayClaims.xui && data.DisplayClaims.xui[0] && data.DisplayClaims.xui[0].uhs
  if (!uhs) throw new Error('XSTS auth missing uhs')
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
        for (const key of ['gameDir', 'javaPath', 'memoryMb', 'clientId', 'width', 'height', 'fullscreen', 'eulaAccepted', 'uiMode', 'showTab', 'theme']) {
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

  // ---- agent tools: bring the launcher into DSH conversations ----
  const tools = ctx.tools

  tools.register(defineTool({
    name: 'mc_list_versions',
    description: 'List Minecraft versions: locally installed ones plus the latest release/snapshot from Mojang. Use to see what is available or already installed.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
    async execute(args) {
      const id = args.id || store.selected
      if (!id) return { ok: false, error: 'no version selected' }
      if (store.game.running) return { ok: false, error: 'game already running' }
      if (!store.account) return { ok: false, error: 'not signed in — playing Minecraft requires a valid, legitimately purchased account' }
      const java = await detectJava()
      store.javaInfo = java
      if (!java) return { ok: false, error: 'no Java runtime found' }
      const r = launch(id, store.account)
      return { ok: true, pid: r.pid, id }
    },
  }))

  tools.register(defineTool({
    name: 'mc_kill',
    description: 'Stop the running Minecraft game process (SIGTERM).',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
    async execute(args) {
      const n = Math.min(300, Math.max(1, Number(args.lines) || 50))
      return { lines: store.game.logs.slice(-n) }
    },
  }))

  tools.register(defineTool({
    name: 'mc_status',
    description: 'Launcher status: account, selected version, Java runtime, active download progress, and running game state.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
    async execute() {
      return { worlds: worldInfo() }
    },
  }))

  tools.register(defineTool({
    name: 'mc_mods',
    description: 'List installed mods (mods/ directory) with their loader and version, parsed from fabric.mod.json / mods.toml metadata.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
    async execute() {
      return { mods: modsList() }
    },
  }))

  tools.register(defineTool({
    name: 'mc_version_advice',
    description: 'Suggest a Minecraft version: compare installed versions against the latest release from Mojang.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
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
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: toolResult() },
    async execute(args) {
      const g = loadGoals()
      const i = Number(args.index)
      if (!g.goals[i]) return { ok: false, error: `no goal at index ${i}` }
      g.goals[i].done = args.done !== false
      saveGoals(g)
      return { ok: true, done: g.goals.filter((x) => x.done).length, total: g.goals.length }
    },
  }))
}
