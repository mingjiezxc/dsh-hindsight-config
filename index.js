/**
 * @major.chen/dsh-hindsight-config —— 宿主半体（Hindsight 记忆模式管理面板）。
 *
 * 它做三件事：
 *   1. 维护一份「受管根目录 → 模式」的状态（`<配置目录>/coding-agent.dsh.json`）；
 *   2. 按工作区树把状态翻译成 `~/.hindsight/coding-agent.json` 的 `mapPathToBank` / `paths`
 *      （备份 + 原子写，其余键逐字保留；生成逻辑全在 ./generate.js 的纯函数里）；
 *   3. 通过 `/api/dsh-hindsight-config/*` 给浏览器半体提供读写口，并报告「本进程已解析过哪些
 *      工作目录」——Hindsight 的 DSH 半体把解析结果缓存进程内且无失效入口，所以「重载」的
 *      真实语义是：重读文件 + 报告生效范围；让已解析目录也换新，只能重启 DSH 宿主。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import {
  DEFAULT_DEPTH,
  DEFAULT_FILTERS,
  MODES,
  deriveMode,
  deriveRoots,
  generateConfig,
  gitUnavailable,
  isOwnedBy,
  isUnder,
  normalizeRoot,
  parseConfig,
  resetProbeCaches,
  scanRoot,
  serializeConfig,
} from './generate.js'

export const name = 'hindsight-config'
export const inject = []

const MAX_JSON_BODY_BYTES = 512 * 1024
const STATE_VERSION = 1
const BACKUP_KEEP = 10
const DEFAULT_UNIT = 'dsh-web.service'
/** 「自动」选项的默认模式（与旧行为一致：新增根目录按「独立」处理）。 */
const DEFAULT_AUTO_MODE = 'independent'
/**
 * 工作区注册表轮询间隔。「自动」开启时，宿主每这么久读一次 `ctx.workspaceRegistry.list()`
 * （内存投影，无磁盘 IO），发现新增/删除工作区就自动重写配置。
 * 环境变量 `HINDSIGHT_CONFIG_AUTO_POLL_MS` 可覆盖；设为 0 关闭轮询。
 */
const AUTO_POLL_MS = (() => {
  const raw = Number(process.env.HINDSIGHT_CONFIG_AUTO_POLL_MS)
  if (Number.isFinite(raw) && raw >= 0) return raw === 0 ? 0 : Math.max(1000, Math.round(raw))
  return 5000
})()

/* ------------------------------------------------------------------ *
 * 路径与状态
 * ------------------------------------------------------------------ */

const configFilePath = () => process.env.HINDSIGHT_CONFIG?.trim() || join(homedir(), '.hindsight', 'coding-agent.json')
const stateFilePath = () => join(dirname(configFilePath()), 'coding-agent.dsh.json')

function normalizeState(raw) {
  const roots = []
  const seen = new Set()
  for (const entry of Array.isArray(raw?.roots) ? raw.roots : []) {
    const path = normalizeRoot(entry?.path)
    if (path === '' || seen.has(path) || !MODES.includes(entry?.mode)) continue
    seen.add(path)
    const depth = Number.isSafeInteger(entry?.depth) && entry.depth > 0 ? entry.depth : DEFAULT_DEPTH
    roots.push({ path, mode: entry.mode, depth })
  }
  const filters = { ...DEFAULT_FILTERS }
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    if (typeof raw?.filters?.[key] === 'boolean') filters[key] = raw.filters[key]
  }
  const restartUnit = typeof raw?.restartUnit === 'string' && raw.restartUnit.trim() !== '' ? raw.restartUnit.trim() : DEFAULT_UNIT
  return {
    version: STATE_VERSION,
    roots,
    filters,
    restartUnit,
    restartAfterGenerate: raw?.restartAfterGenerate === true,
    // 「自动」选项：新增受管根目录套用的默认模式；受管根增减后是否立即写配置（缺省开）。
    autoMode: MODES.includes(raw?.autoMode) ? raw.autoMode : DEFAULT_AUTO_MODE,
    autoApply: raw?.autoApply !== false,
  }
}

/** 读面板状态。文件缺失/损坏时返回一份「空的、待派生」状态（`derived: true`）。 */
function readState() {
  const file = stateFilePath()
  let text = ''
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    text = ''
  }
  let parsed
  let derived = false
  if (text.trim() === '') {
    derived = true
    parsed = null
  } else {
    try {
      parsed = JSON.parse(text)
    } catch {
      derived = true
      parsed = null
    }
    if (parsed !== null && typeof parsed !== 'object') {
      derived = true
      parsed = null
    }
  }
  const state = normalizeState(parsed)
  if (derived) state.derived = true
  state.file = file
  return state
}

function writeState(state) {
  const body = {
    version: STATE_VERSION,
    roots: state.roots,
    filters: state.filters,
    restartUnit: state.restartUnit,
    restartAfterGenerate: state.restartAfterGenerate === true,
    autoMode: MODES.includes(state.autoMode) ? state.autoMode : DEFAULT_AUTO_MODE,
    autoApply: state.autoApply === true,
  }
  writeFileAtomic(stateFilePath(), `${JSON.stringify(body, null, 2)}\n`, 0o600)
}

/** 读 Hindsight 配置文件；返回 `{ file, exists, text, config }` 或 `{ file, error }`。 */
function readConfigFile() {
  const file = configFilePath()
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { file, exists: false, text: '', config: {} }
    return { file, error: `无法读取：${error?.code ?? error}` }
  }
  const parsed = parseConfig(text)
  if (parsed.error !== undefined) return { file, exists: true, text, error: parsed.error }
  return { file, exists: true, text, config: parsed.config }
}

/* ------------------------------------------------------------------ *
 * 文件写入：原子写 + 备份轮转
 * ------------------------------------------------------------------ */

function writeFileAtomic(file, data, mode = 0o600) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, data, { mode })
  renameSync(tmp, file)
}

function backupFile(file, text) {
  const stamp = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const name = `${basename(file)}.bak-${stamp.getFullYear()}${pad(stamp.getMonth() + 1)}${pad(stamp.getDate())}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`
  const target = join(dirname(file), name)
  writeFileAtomic(target, text, 0o600)
  pruneBackups(file)
  return target
}

function pruneBackups(file) {
  const prefix = `${basename(file)}.bak-`
  try {
    const entries = readdirSync(dirname(file))
      .filter((entry) => entry.startsWith(prefix))
      .sort()
    for (const entry of entries.slice(0, Math.max(0, entries.length - BACKUP_KEEP))) {
      try {
        unlinkSync(join(dirname(file), entry))
      } catch {
        /* 清理失败不影响写入结果 */
      }
    }
  } catch {
    /* 目录不可读时跳过清理 */
  }
}

/* ------------------------------------------------------------------ *
 * HTTP 工具（与同族插件的围栏语义一致）
 * ------------------------------------------------------------------ */

function isLoopbackRequest(request) {
  const address = request.socket?.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers?.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      size += chunk.length
      if (size > MAX_JSON_BODY_BYTES) return undefined
      chunks.push(chunk)
    }
  } catch {
    return undefined
  }
  if (chunks.length === 0) return {}
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/* ------------------------------------------------------------------ *
 * 视图
 * ------------------------------------------------------------------ */

function describeRoot(root, filters) {
  const scan = scanRoot(root.path, filters, root.depth)
  return {
    path: root.path,
    mode: root.mode,
    depth: root.depth,
    configured: true,
    exists: scan.error === undefined,
    error: scan.error,
    projectName: scan.projectName,
    isRepo: scan.projectName !== basename(root.path),
    subdirs: scan.error === undefined
      ? scan.dirs.filter((dir) => dir.level === 1).map((dir) => ({ name: dir.name, path: dir.path, projectName: dir.projectName }))
      : [],
  }
}

/* ------------------------------------------------------------------ *
 * 宿主服务
 * ------------------------------------------------------------------ */

export function createHost() {
  /** 本进程已经解析过的工作目录（Hindsight 半体的 `workspaces` 缓存 key）。 */
  const resolved = new Map()
  /** 宿主的工作区注册表（`ctx.workspaceRegistry`），inject 到位前为空。 */
  let workspaceRegistry
  let chain = Promise.resolve()
  /** 「自动」监听的运行状态（只读地暴露给面板）。 */
  const auto = {
    signature: undefined,
    lastRunAt: null,
    lastReason: '',
    lastAdded: [],
    lastRemoved: [],
    lastChanged: false,
    lastWritten: false,
    lastBackup: null,
    lastWarnings: [],
    lastError: null,
  }

  /** 串行化所有会读改写文件的操作。 */
  const withLock = (work) => {
    const run = chain.then(work, work)
    chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  const remember = (dir, source) => {
    const key = normalizeRoot(dir)
    if (key === '') return
    if (!resolved.has(key)) resolved.set(key, { at: Date.now(), source })
  }

  /** 用状态初始化根列表：状态文件缺失时由配置文件形状派生。 */
  const ensureRoots = (state, config) => {
    if (state.roots.length > 0 || state.derived !== true) return state
    state.roots = deriveRoots(config)
    if (state.roots.length > 0) {
      try {
        writeState(state)
      } catch {
        /* 派生失败不影响读取 */
      }
    }
    return state
  }

  const view = () => {
    const state = readState()
    const file = readConfigFile()
    const config = file.error === undefined ? file.config : {}
    ensureRoots(state, config)
    const roots = state.roots.map((root) => {
      const described = describeRoot(root, state.filters)
      described.fileMode = file.error === undefined ? deriveMode(config, root.path) : 'unknown'
      described.drift = described.fileMode !== 'unknown' && described.fileMode !== root.mode
      described.resolvedInProcess = resolved.has(root.path)
      return described
    })
    const others = [...resolved.entries()]
      .filter(([path]) => !state.roots.some((root) => root.path === path))
      .map(([path, meta]) => ({ path, ...meta }))
    return {
      ok: true,
      configFile: file.file,
      configExists: file.exists === true,
      configError: file.error,
      config: file.error === undefined ? config : undefined,
      stateFile: state.file,
      stateDerived: state.derived === true,
      roots,
      filters: state.filters,
      restartUnit: state.restartUnit,
      restartAfterGenerate: state.restartAfterGenerate === true,
      autoMode: state.autoMode,
      autoApply: state.autoApply === true,
      auto: {
        enabled: state.autoApply === true,
        pollIntervalMs: AUTO_POLL_MS,
        watching: state.autoApply === true && workspaceRegistry !== undefined,
        lastRunAt: auto.lastRunAt,
        lastReason: auto.lastReason,
        lastAdded: auto.lastAdded,
        lastRemoved: auto.lastRemoved,
        lastChanged: auto.lastChanged,
        lastWritten: auto.lastWritten,
        lastBackup: auto.lastBackup,
        lastWarnings: auto.lastWarnings,
        lastError: auto.lastError,
      },
      resolvedElsewhere: others,
      detectedUnit: detectUnit(),
      gitAvailable: !gitUnavailable(),
    }
  }

  const saveRoots = (body) => {
    const state = readState()
    const next = normalizeState({
      roots: body?.roots,
      filters: body?.filters ?? state.filters,
      restartUnit: body?.restartUnit ?? state.restartUnit,
      restartAfterGenerate: body?.restartAfterGenerate ?? state.restartAfterGenerate,
      autoMode: body?.autoMode ?? state.autoMode,
      autoApply: body?.autoApply ?? state.autoApply,
    })
    if (Array.isArray(body?.roots) && body.roots.length > 0 && next.roots.length === 0) {
      return { error: '没有任何有效根目录（需要绝对路径 + mode 为 off/independent/shared）' }
    }
    writeState(next)
    return { ok: true, roots: next.roots }
  }

  /** 在锁内执行：生成 →（有变化且非 dryRun）备份 + 原子写。 */
  const applyGenerate = (file, roots, filters, dryRun = false) => {
    const result = generateConfig({ config: file.config, roots, filters })
    const payload = {
      ok: true,
      dryRun,
      changed: result.changed,
      warnings: result.warnings,
      diff: result.diff,
      preview: serializeConfig(result.next),
      scanned: result.scans.map((scan) => ({ path: scan.path, dirs: scan.dirs.length })),
    }
    if (dryRun || !result.changed) return { ...payload, written: false }
    let backup
    try {
      if (file.exists) backup = backupFile(file.file, file.text)
      writeFileAtomic(file.file, serializeConfig(result.next), 0o644)
    } catch (error) {
      return { ok: false, error: `写入失败：${error?.message ?? error}`, warnings: result.warnings }
    }
    return { ...payload, written: true, backup }
  }

  const generate = async (body) => {
    const rootPaths = Array.isArray(body?.roots)
      ? body.roots.map((entry) => normalizeRoot(entry?.path ?? entry)).filter((path) => path !== '')
      : []
    const single = typeof body?.rootPath === 'string' && body.rootPath.trim() !== '' ? normalizeRoot(body.rootPath) : undefined
    const dryRun = body?.dryRun === true
    return withLock(() => {
      resetProbeCaches()
      const state = readState()
      const file = readConfigFile()
      if (file.error !== undefined) return { error: `配置文件无法解析，已拒绝写入：${file.error}` }
      ensureRoots(state, file.config)
      let roots = state.roots
      if (single !== undefined) {
        roots = state.roots.filter((root) => root.path === single)
        if (roots.length === 0) return { error: `根目录未在面板状态中管理：${single}` }
      } else if (rootPaths.length > 0) {
        roots = state.roots.filter((root) => rootPaths.includes(root.path))
        if (roots.length === 0) return { error: '指定的根目录都不在面板状态中' }
      }
      return applyGenerate(file, roots, state.filters, dryRun)
    })
  }

  /** 当前工作区注册表里的路径（排序去重）；注册表不可用时返回 undefined。 */
  const registryWorkspacePaths = () => {
    if (workspaceRegistry === undefined || typeof workspaceRegistry.list !== 'function') return undefined
    let rows
    try {
      rows = workspaceRegistry.list()
    } catch {
      return undefined
    }
    const paths = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const path = normalizeRoot(row?.path)
      if (path !== '' && !paths.includes(path)) paths.push(path)
    }
    return paths.sort()
  }

  /**
   * 「自动」监听的一拍：比较 DSH 工作区注册表的路径签名，发现新增/删除就重写配置。
   *
   * - 第一次观察不新增受管根，但对已有受管根做一次幂等重建（有变化才写），
   *   补上宿主停机期间新增的子目录；
   * - 新增的工作区若是「顶层工作区」且不被任何受管根覆盖，按 `autoMode` 自动加为受管根；
   *   已在受管根子树内的工作区不重复加根，重新生成即可覆盖；
   * - 删除工作区不会自动删受管根（目录可能还在用），只重新生成；
   * - `autoApply` 关闭时什么都不写，并把基线清空，下次开启重新取基线。
   */
  const autoTick = () =>
    withLock(() => {
      const state = readState()
      if (state.autoApply !== true) {
        auto.signature = undefined
        auto.lastError = null
        return { ok: true, skipped: 'auto-apply-off' }
      }
      const paths = registryWorkspacePaths()
      if (paths === undefined) {
        auto.signature = undefined
        return { ok: true, skipped: 'no-workspace-registry' }
      }
      const signature = paths.join('\n')
      if (auto.signature === undefined) {
        // 首次观察：不新增受管根（避免把历史工作区一次性塞进配置），
        // 但对已有受管根做一次幂等重建，补上宿主停机期间新增的子目录。
        auto.signature = signature
        auto.lastReason = 'baseline'
        auto.lastAdded = []
        auto.lastRemoved = []
        auto.lastRunAt = Date.now()
        const baselineFile = readConfigFile()
        if (baselineFile.error !== undefined) {
          auto.lastChanged = false
          auto.lastWritten = false
          auto.lastBackup = null
          auto.lastWarnings = []
          auto.lastError = `配置文件无法解析，已拒绝写入：${baselineFile.error}`
          return { ok: false, baseline: true, error: auto.lastError }
        }
        resetProbeCaches()
        ensureRoots(state, baselineFile.config)
        const baseline = applyGenerate(baselineFile, state.roots, state.filters, false)
        auto.lastChanged = baseline.changed === true
        auto.lastWritten = baseline.written === true
        auto.lastBackup = baseline.backup ?? null
        auto.lastWarnings = Array.isArray(baseline.warnings) ? baseline.warnings : []
        auto.lastError = baseline.ok === false ? baseline.error : null
        return {
          ok: baseline.ok !== false,
          baseline: true,
          workspaces: paths.length,
          changed: auto.lastChanged,
          written: auto.lastWritten,
          backup: auto.lastBackup,
          error: auto.lastError,
        }
      }
      if (signature === auto.signature) return { ok: true, unchanged: true }

      const previous = auto.signature.split('\n').filter(Boolean)
      auto.signature = signature
      const added = paths.filter((path) => !previous.includes(path))
      const removed = previous.filter((path) => !paths.includes(path))

      const file = readConfigFile()
      if (file.error !== undefined) {
        auto.lastRunAt = Date.now()
        auto.lastReason = 'workspace-registry-change'
        auto.lastAdded = added
        auto.lastRemoved = removed
        auto.lastChanged = false
        auto.lastWritten = false
        auto.lastError = `配置文件无法解析，已拒绝写入：${file.error}`
        return { ok: false, reason: 'workspace-registry-change', added, removed, error: auto.lastError }
      }
      resetProbeCaches()
      ensureRoots(state, file.config)

      // 顶层工作区 = 不被其它注册工作区包含的那些（与面板「候选起点」同义）。
      const topLevel = paths.filter((path) => !paths.some((other) => other !== path && isUnder(path, other)))
      const additions = []
      for (const path of added) {
        // 已受管根的子目录：重新生成就会写进映射，不再重复加根。
        if (state.roots.some((root) => isOwnedBy(path, root.path))) continue
        // 新工作区若包住一个已有受管根，加根会把它整棵子树重新切分，风险太大，跳过。
        if (state.roots.some((root) => isUnder(root.path, path))) continue
        if (!topLevel.includes(path)) continue
        try {
          if (!statSync(path).isDirectory()) continue
        } catch {
          continue
        }
        additions.push({ path, mode: MODES.includes(state.autoMode) ? state.autoMode : DEFAULT_AUTO_MODE, depth: DEFAULT_DEPTH })
      }
      if (additions.length > 0) {
        state.roots = [...state.roots, ...additions]
        try {
          writeState(state)
        } catch (error) {
          auto.lastRunAt = Date.now()
          auto.lastReason = 'workspace-registry-change'
          auto.lastAdded = []
          auto.lastRemoved = removed
          auto.lastError = `状态写入失败：${error?.message ?? error}`
          return { ok: false, reason: 'workspace-registry-change', added: [], removed, error: auto.lastError }
        }
      }

      const outcome = applyGenerate(file, state.roots, state.filters, false)
      auto.lastRunAt = Date.now()
      auto.lastReason = 'workspace-registry-change'
      auto.lastAdded = additions.map((root) => root.path)
      auto.lastRemoved = removed
      auto.lastChanged = outcome.changed === true
      auto.lastWritten = outcome.written === true
      auto.lastBackup = outcome.backup ?? null
      auto.lastWarnings = Array.isArray(outcome.warnings) ? outcome.warnings : []
      auto.lastError = outcome.ok === false ? outcome.error : null
      return {
        ok: outcome.ok !== false,
        reason: 'workspace-registry-change',
        added: auto.lastAdded,
        removed,
        changed: auto.lastChanged,
        written: auto.lastWritten,
        backup: auto.lastBackup,
        warnings: auto.lastWarnings,
        error: auto.lastError,
      }
    })

  /** 重读配置 + 报告生效范围（已解析的目录要重启宿主才换新）。 */
  const reload = () => {
    const snapshot = view()
    return {
      ok: true,
      configFile: snapshot.configFile,
      configError: snapshot.configError,
      config: snapshot.config,
      roots: snapshot.roots.map((root) => ({
        path: root.path,
        mode: root.mode,
        fileMode: root.fileMode,
        drift: root.drift,
        resolvedInProcess: root.resolvedInProcess,
        effective: root.resolvedInProcess ? 'restart-required' : 'live',
      })),
      resolvedElsewhere: snapshot.resolvedElsewhere,
      restartUnit: snapshot.restartUnit,
      note:
        'Hindsight 的 DSH 半体把「工作目录 → bank」缓存进程内；已解析过的目录要重启 DSH 宿主才会换到新的记忆空间，未解析过的目录立即生效。',
    }
  }

  const restart = (body) => {
    if (body?.confirm !== true) {
      return { status: 400, error: '需要 confirm: true —— 重启会打断当前正在进行的回复' }
    }
    const unit = (typeof body?.unit === 'string' && body.unit.trim() !== '' ? body.unit.trim() : undefined) ?? readState().restartUnit
    const command = `systemctl restart --no-block ${unit}`
    try {
      // 响应已经发出，这里只负责把结果写进宿主日志：stdout/stderr 都收下来，失败可查。
      const child = spawn('systemctl', ['restart', '--no-block', unit], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk) => {
        output += chunk
      })
      child.stderr?.on('data', (chunk) => {
        output += chunk
      })
      child.on('error', (error) => {
        console.warn(`[hindsight-config] ${command} failed to start: ${error?.message ?? error}`)
      })
      child.on('close', (code) => {
        if (code === 0) console.log(`[hindsight-config] ${command} ok`)
        else console.warn(`[hindsight-config] ${command} exited with ${code}: ${output.trim()}`)
      })
      child.unref()
    } catch (error) {
      return { status: 500, error: `无法执行 ${command}：${error?.message ?? error}`, command }
    }
    console.log(`[hindsight-config] restarting ${unit} (${command})`)
    return { ok: true, unit, command, scheduled: true }
  }

  /**
   * 候选起点：**顶层工作区**（不被其它工作区包含的那些）里还没加为受管根、且磁盘上存在的目录。
   * 例如已加 /root/dev、/root/watsons-ai、/root/workspace 时，只剩 /root/github 可选。
   */
  const candidates = () => {
    if (workspaceRegistry === undefined || typeof workspaceRegistry.list !== 'function') {
      return { ok: true, candidates: [], reason: 'no-workspace-registry' }
    }
    let rows
    try {
      rows = workspaceRegistry.list()
    } catch (error) {
      return { ok: true, candidates: [], reason: `workspace-registry-error: ${error?.message ?? error}` }
    }
    const paths = []
    for (const row of Array.isArray(rows) ? rows : []) {
      const path = normalizeRoot(row?.path)
      if (path !== '' && !paths.includes(path)) paths.push(path)
    }
    const topLevel = paths.filter((path) => !paths.some((other) => other !== path && isUnder(path, other)))
    const managed = new Set(readState().roots.map((root) => root.path))
    const out = []
    for (const path of topLevel) {
      if (managed.has(path)) continue
      try {
        if (!statSync(path).isDirectory()) continue
      } catch {
        continue
      }
      out.push({ path, title: basename(path) })
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { ok: true, candidates: out, workspaces: paths.length, topLevel: topLevel.length }
  }

  const tree = (query) => {
    const state = readState()
    const path = normalizeRoot(query?.get?.('path') ?? '')
    if (path === '') return { error: '缺少 path 参数' }
    try {
      if (!statSync(path).isDirectory()) return { error: '不是目录' }
    } catch (error) {
      return { error: error?.code === 'ENOENT' ? '目录不存在' : `无法访问：${error?.code ?? error}` }
    }
    const scan = scanRoot(path, state.filters, DEFAULT_DEPTH)
    return {
      ok: true,
      path,
      filters: state.filters,
      projectName: scan.projectName,
      exists: scan.error === undefined,
      error: scan.error,
      subdirs: scan.dirs.filter((dir) => dir.level === 1).map((dir) => ({
        name: dir.name,
        path: dir.path,
        projectName: dir.projectName,
        isRepo: dir.projectName !== dir.name,
      })),
    }
  }

  return {
    resolved,
    remember,
    view,
    saveRoots,
    generate,
    autoTick,
    reload,
    restart,
    tree,
    candidates,
    setWorkspaceRegistry(registry) {
      workspaceRegistry = registry ?? undefined
    },
  }
}

/** 从本进程 cgroup 推断托管它的 systemd 单元；失败回落默认值。 */
export function detectUnit() {
  try {
    const text = readFileSync('/proc/self/cgroup', 'utf8')
    for (const line of text.split('\n')) {
      const path = line.trim().split(':').pop() ?? ''
      const segments = path.split('/').filter(Boolean)
      for (let i = segments.length - 1; i >= 0; i -= 1) {
        if (/\.service$/.test(segments[i])) return segments[i]
      }
    }
  } catch {
    /* 非 Linux / 无 cgroup 时不推断 */
  }
  return DEFAULT_UNIT
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

export function makeRoutes(host) {
  const guard = (req, res, method) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only（请用 127.0.0.1:3080 打开本页面）' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${String(req.method)}` })
      return false
    }
    return true
  }
  const post = (path, handler) => ({
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!guard(req, res, 'POST')) return
      const body = await readJsonBody(req)
      if (body === undefined) {
        writeJson(res, 400, { error: 'invalid JSON body' })
        return
      }
      const result = await handler(body)
      const status = typeof result?.status === 'number' ? result.status : result?.error !== undefined ? 400 : 200
      writeJson(res, status, result)
    },
  })
  return [
    {
      kind: 'exact',
      path: '/api/dsh-hindsight-config/state',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, host.view())
      },
    },
    post('/api/dsh-hindsight-config/roots', async (body) => host.saveRoots(body)),
    post('/api/dsh-hindsight-config/generate', async (body) => host.generate(body)),
    post('/api/dsh-hindsight-config/reload', async () => host.reload()),
    post('/api/dsh-hindsight-config/restart', async (body) => host.restart(body)),
    {
      kind: 'exact',
      path: '/api/dsh-hindsight-config/candidates',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, host.candidates())
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-hindsight-config/tree',
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        let query
        try {
          query = new URL(req.url ?? '/', 'http://127.0.0.1')
        } catch {
          writeJson(res, 400, { error: 'invalid query' })
          return
        }
        const result = host.tree(query.searchParams)
        writeJson(res, result.error !== undefined ? 400 : 200, result)
      },
    },
  ]
}

/* ------------------------------------------------------------------ *
 * 插件本体
 * ------------------------------------------------------------------ */

const GUIDANCE = [
  '本机已安装 dsh-hindsight-config 插件（Hindsight 记忆模式管理）：Web GUI 的插件配置里有「Hindsight 记忆模式」卡片，按工作区树管理 ~/.hindsight/coding-agent.json 的 bank 路由。',
  '三种模式：关闭（该目录不产生记忆）；独立（根目录与其每个直接子目录各自一个记忆空间，映射写成 mapPathToBank 的显式条目）；共享（整棵子树收敛到根目录的一个记忆空间）。',
  '「自动」选项：新增受管根目录时套用一个可选的默认模式；开启时，宿主每几秒检查一次 DSH 工作区注册表，任何工作区的新增/删除都会自动重写配置（新增的顶层工作区会按默认模式自动加为受管根；面板上可关掉，关掉后工作区变化不写盘，仍需点「重新生成」）。添加根目录也可以直接按工作区树勾选批量添加。',
  '面板有「重新生成」（重建映射，幂等，写前自动备份）与「重载」（重读配置并报告生效范围）。Hindsight 的 DSH 半体把「工作目录 → bank」缓存进程内且没有失效入口，因此已解析过的目录必须重启 DSH 宿主（systemctl restart dsh-web.service）才会换到新的记忆空间；未解析过的目录立即生效。重启会打断正在进行的回复，属于用户操作。',
  '用户提到「记忆模式 / 独立模式 / 共享模式 / 自动 / 记忆空间 / bank 路由 / 重新生成 / 重载」时即指本插件，请引导其打开该卡片操作，而不是直接手改 ~/.hindsight/coding-agent.json。',
].join('')

const TOOL_DESCRIPTION = [
  'Report how Hindsight memory is routed for the workspace directories the memory-mode panel manages.',
  'Returns each managed root with its configured mode (off/independent/shared), the mode the config file currently expresses, whether it drifts, the bank the root resolves to, its subdirectory count, and whether the running DSH process has already resolved that directory (an already-resolved directory keeps its old bank until the DSH host restarts; a directory never opened in this process picks up the file immediately).',
  'Read-only: it never writes the config and never restarts the host.',
].join(' ')

export function apply(ctx) {
  const host = createHost()
  const routes = makeRoutes(host)

  /** 记下某个 agent 的工作目录（Hindsight 的缓存 key 就是它）。 */
  const recordAgent = (agent) => {
    try {
      const cwd = agent?.session?.header?.cwd
      if (typeof cwd === 'string' && cwd !== '') host.remember(cwd, 'session')
    } catch {
      /* 记账失败不能影响会话 */
    }
  }

  // Hindsight 的宿主半体在挂载时就会解析 process.cwd() 并缓存结果，这里如实记账。
  host.remember(process.cwd(), 'host-cwd')
  ctx.on('agent/created', ({ agent }) => {
    recordAgent(agent)
    return undefined
  })
  // 插件可能在会话进行中才被挂上：进程内已存在的会话不会再有 agent/created，
  // 于是既在挂载时扫一遍存活 agent，也在每个 step 前补记一次。
  ctx.inject(['agents'], (agentsCtx) => {
    try {
      for (const agent of agentsCtx.agents.list()) recordAgent(agent)
    } catch {
      /* 列不出存活 agent 时只依赖事件 */
    }
  })
  ctx.on('agent/pre-step', ({ agent }, next) => {
    recordAgent(agent)
    return next()
  })

  ctx.inject(['workspaceRegistry'], (wsCtx) => {
    host.setWorkspaceRegistry(wsCtx.workspaceRegistry)
    // 「自动」监听：轮询工作区注册表（内存投影，无磁盘 IO）。开启时任何工作区增删
    // 都会自动重写配置；关闭时 tick 直接返回，不写任何东西。
    let timer
    if (AUTO_POLL_MS > 0) {
      timer = setInterval(() => {
        Promise.resolve(host.autoTick()).catch((error) => {
          console.warn(`[hindsight-config] auto tick failed: ${error?.message ?? error}`)
        })
      }, AUTO_POLL_MS)
      timer.unref?.()
    }
    return () => {
      host.setWorkspaceRegistry(undefined)
      if (timer !== undefined) clearInterval(timer)
    }
  })

  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => {
      const disposers = routes.map((route) => webCtx.webServer.register(route))
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* 释放失败不阻塞 */
          }
        }
      }
    }, 'hindsight-config: routes')
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(
      () => promptCtx.systemPrompt.section({ name: 'plugin:dsh-hindsight-config', order: 152, text: GUIDANCE }),
      'hindsight-config: announcement',
    )
  })

  ctx.inject(['tools'], (toolCtx) => {
    toolCtx.effect(
      () =>
        toolCtx.tools.register({
          name: 'hindsight_memory_mode',
          description: TOOL_DESCRIPTION,
          parameters: {
            type: 'object',
            properties: {
              path: {
                type: 'string',
                description: 'Absolute directory whose resolved bank to expand. Omit for a root-level summary with subdirectory counts.',
              },
            },
          },
          output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
          },
          async execute(args) {
            const result = host.view()
            const wanted = typeof args?.path === 'string' && args.path.trim() !== '' ? normalizeRoot(args.path) : undefined
            if (wanted === undefined) {
              const rows = result.roots.map((root) => ({
                path: root.path,
                mode: root.mode,
                fileMode: root.fileMode,
                drift: root.drift,
                exists: root.exists,
                error: root.error,
                subdirectories: root.subdirs.length,
                resolvedInProcess: root.resolvedInProcess,
              }))
              if (rows.length === 0) {
                return JSON.stringify(
                  {
                    managedRoots: [],
                    hint: 'No directory is managed yet. Open the "Hindsight memory mode" card in plugin settings, or add ~/.hindsight/coding-agent.json path keys as roots.',
                    configFile: result.configFile,
                  },
                  null,
                  2,
                )
              }
              return JSON.stringify({ configFile: result.configFile, managedRoots: rows }, null, 2)
            }
            const scan = scanRoot(wanted, result.filters ?? DEFAULT_FILTERS, DEFAULT_DEPTH)
            if (scan.error !== undefined) return JSON.stringify({ path: wanted, error: scan.error }, null, 2)
            const limit = 60
            const subdirs = scan.dirs.filter((dir) => dir.level === 1).map((dir) => ({ name: dir.name, bank: dir.projectName }))
            return JSON.stringify(
              {
                path: wanted,
                projectName: scan.projectName,
                subdirectories: subdirs.length,
                truncated: subdirs.length > limit,
                entries: subdirs.slice(0, limit),
              },
              null,
              2,
            )
          },
        }),
      'hindsight-config: tool',
    )
  })

  console.log(`[hindsight-config] mounted, config file: ${configFilePath()}, state file: ${stateFilePath()}`)
}
