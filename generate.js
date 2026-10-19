/**
 * 纯函数层：把「工作区树 + 模式」翻译成 ~/.hindsight/coding-agent.json 的 bank 路由。
 *
 * 它只依赖 Node 内置模块，且把「git 探测」与「目录列举」做成可注入的依赖，
 * 这样单测不需要真实仓库、也不需要 git 可执行文件。
 *
 * 生成契约（与 Hindsight 上游的解析规则对齐）：
 *   - mapPathToBank 最长前缀优先，覆盖 bankId；
 *   - paths.<prefix> 在 bank 解析之后生效，其中 disabled 不在排除名单内，可整棵子树关闭；
 *   - 默认 bankIdTemplate = "coding-agent::{gitProject}"，{gitProject} = git-common-dir 的父目录名
 *     （linked worktree 因此收敛到主仓库名），非仓库目录回落目录 basename。
 *
 * 所有权契约：受管根目录「拥有」mapPathToBank 中等于它或以 `<root>/` 开头的所有键。
 * 重建时这些键先全部丢弃再按模式写回；受管前缀之外的键逐字保留。
 */
import { spawnSync } from 'node:child_process'
import { readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, resolve } from 'node:path'

/** 三种模式；`unconfigured` 不是模式，只用于描述「文件里没有本插件写的形状」。 */
export const MODES = ['off', 'independent', 'shared']
/** 与上游一致的默认模板。 */
export const DEFAULT_TEMPLATE = 'coding-agent::{gitProject}'
/** 目录筛选默认值。 */
export const DEFAULT_FILTERS = {
  skipHidden: true,
  skipNodeModules: true,
  skipEmpty: false,
  includeSymlinks: false,
}
/** 受管根的深度默认值：根目录 + 直接子目录。 */
export const DEFAULT_DEPTH = 1

const SEP = '/'

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 归一化绝对路径（去尾斜杠）；空串表示无效。 */
export function normalizeRoot(value) {
  const raw = String(value ?? '').trim()
  if (raw === '') return ''
  const abs = resolve(raw)
  return abs.length > 1 ? abs.replace(/\/+$/, '') : abs
}

/** 该键是否归属于某个受管根（等于它，或在其子树内）。 */
export function isOwnedBy(path, root) {
  return path === root || path.startsWith(root + SEP)
}

/** 该键是否严格位于某根之下。 */
export function isUnder(path, root) {
  return path !== root && path.startsWith(root + SEP)
}

/* ------------------------------------------------------------------ *
 * 目录与项目名探测
 * ------------------------------------------------------------------ */

let gitMissing = false
const projectNameCache = new Map()

/** 清空进程内缓存（每次「重新生成」前调用，使磁盘状态变化可见）。 */
export function resetProbeCaches() {
  projectNameCache.clear()
  gitMissing = false
}

/** git 是否可用（由最近一次探测记录）。 */
export function gitUnavailable() {
  return gitMissing
}

/**
 * 目录的项目名：仓库目录取 git-common-dir 的父目录名（worktree 收敛到主仓库），
 * 否则取目录 basename。探测失败不抛错，静默回落。
 */
export function gitProjectName(dir) {
  if (projectNameCache.has(dir)) return projectNameCache.get(dir)
  let name = null
  try {
    const out = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
      encoding: 'utf8',
      timeout: 3000,
    })
    if (out.error?.code === 'ENOENT') gitMissing = true
    if (!out.error && out.status === 0) {
      const common = String(out.stdout ?? '').trim()
      if (common !== '') {
        const abs = isAbsolute(common) ? common : resolve(dir, common)
        const candidate = basename(dirname(abs))
        if (candidate !== '' && candidate !== '.' && candidate !== SEP) name = candidate
      }
    }
  } catch {
    name = null
  }
  const resolved = name ?? basename(dir)
  projectNameCache.set(dir, resolved)
  return resolved
}

/** 列举一层子目录（默认跳过符号链接、隐藏目录、node_modules）。 */
export function listSubdirs(dir, filters = {}) {
  const f = { ...DEFAULT_FILTERS, ...filters }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const out = []
  const seen = new Set()
  for (const entry of entries) {
    const path = dir + SEP + entry.name
    let realPath
    if (entry.isSymbolicLink()) {
      if (!f.includeSymlinks) continue
      try {
        realPath = realpathSync(path)
        if (!statSync(realPath).isDirectory()) continue
      } catch {
        continue
      }
      if (seen.has(realPath)) continue
      seen.add(realPath)
    } else if (!entry.isDirectory()) {
      continue
    }
    if (f.skipHidden && entry.name.startsWith('.')) continue
    if (f.skipNodeModules && entry.name === 'node_modules') continue
    if (f.skipEmpty) {
      try {
        if (readdirSync(path).length === 0) continue
      } catch {
        continue
      }
    }
    out.push(realPath === undefined ? { name: entry.name, path } : { name: entry.name, path, realPath })
  }
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return out
}

/** 按深度收集目录：返回 [{ path, level }]，level 从 1 开始。 */
export function collectDirs(root, filters, depth, deps = {}) {
  const list = deps.listSubdirs ?? listSubdirs
  const max = Number.isSafeInteger(depth) && depth > 0 ? depth : DEFAULT_DEPTH
  const out = []
  let level = [{ name: basename(root), path: root }]
  for (let d = 1; d <= max; d += 1) {
    const next = []
    for (const dir of level) {
      for (const sub of list(dir.path, filters)) {
        out.push({ ...sub, level: d })
        next.push(sub)
      }
    }
    level = next
    if (level.length === 0) break
  }
  return out
}

/**
 * 扫描一个受管根：项目名 + 子目录（含各自项目名）。
 * 失败时返回 `{ error }`，调用方不应因此阻断其它根。
 */
export function scanRoot(rootPath, filters = {}, depth = DEFAULT_DEPTH, deps = {}) {
  const root = normalizeRoot(rootPath)
  const projectName = deps.projectName ?? gitProjectName
  const result = { path: root, projectName: '', dirs: [], error: undefined }
  if (root === '') {
    result.error = '路径为空'
    return result
  }
  try {
    if (!statSync(root).isDirectory()) {
      result.error = '不是目录'
      return result
    }
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? '目录不存在' : `无法访问：${error?.code ?? error}`
    return result
  }
  result.projectName = projectName(root)
  for (const dir of collectDirs(root, filters, depth, deps)) {
    // 符号链接按目标探测仓库名：链接与目标必须落到同一个 bank，否则「同一份代码两个记忆空间」。
    result.dirs.push({ ...dir, projectName: projectName(dir.realPath ?? dir.path) })
  }
  return result
}

/* ------------------------------------------------------------------ *
 * bank 命名
 * ------------------------------------------------------------------ */

/** 用 bankIdTemplate 生成 bank id；未知占位符原样保留并回报。 */
export function bankNameFor(projectName, template, env = {}) {
  const tpl = typeof template === 'string' && template.trim() !== '' ? template : DEFAULT_TEMPLATE
  const name = typeof projectName === 'string' && projectName.trim() !== '' ? projectName.trim() : 'unknown'
  const vars = {
    gitProject: name,
    project: name,
    harness: env.harness ?? 'dsh',
    channel: env.channel,
    user: env.user,
  }
  const unknown = []
  const value = tpl.replace(/\{(\w+)\}/g, (match, key) => {
    const resolved = vars[key]
    if (typeof resolved === 'string' && resolved !== '') return resolved
    if (!unknown.includes(key)) unknown.push(key)
    return match
  })
  return { value, unknown }
}

/* ------------------------------------------------------------------ *
 * 从既有配置推断模式
 * ------------------------------------------------------------------ */

/** 在 paths 里找与该根等价的节（容忍尾斜杠）。 */
function findPathSection(paths, root) {
  if (!isPlainObject(paths)) return undefined
  for (const key of Object.keys(paths)) {
    if (normalizeRoot(key) === root) return { key, value: paths[key] }
  }
  return undefined
}

/** 从配置文件的形状推断某个根当前的模式。 */
export function deriveMode(config, rootPath) {
  const root = normalizeRoot(rootPath)
  if (root === '' || !isPlainObject(config)) return 'unconfigured'
  const section = findPathSection(config.paths, root)
  if (isPlainObject(section?.value) && section.value.disabled === true) return 'off'
  const map = isPlainObject(config.mapPathToBank) ? config.mapPathToBank : {}
  const keys = Object.keys(map)
  const hasRoot = keys.some((key) => normalizeRoot(key) === root)
  const hasChildren = keys.some((key) => isUnder(normalizeRoot(key), root))
  if (hasRoot) return hasChildren ? 'independent' : 'shared'
  if (hasChildren) return 'independent'
  return 'unconfigured'
}

/** 从配置文件派生根列表（mapPathToBank + paths 的精确路径键）。 */
export function deriveRoots(config) {
  const out = []
  const seen = new Set()
  const push = (path) => {
    const root = normalizeRoot(path)
    if (root === '' || seen.has(root)) return
    seen.add(root)
    out.push({ path: root, mode: deriveMode(config, root), depth: DEFAULT_DEPTH })
  }
  if (isPlainObject(config?.mapPathToBank)) for (const key of Object.keys(config.mapPathToBank)) push(key)
  if (isPlainObject(config?.paths)) for (const key of Object.keys(config.paths)) push(key)
  return out
}

/* ------------------------------------------------------------------ *
 * 主生成器
 * ------------------------------------------------------------------ */

function expandHome(value) {
  const raw = String(value ?? '')
  if (raw === '~') return process.env.HOME ?? raw
  if (raw.startsWith('~/')) return `${process.env.HOME ?? '~'}${raw.slice(1)}`
  return raw
}

function isOptedIn(config, root) {
  const list = Array.isArray(config?.optInPaths) ? config.optInPaths : []
  return list.some((entry) => isOwnedBy(root, normalizeRoot(expandHome(entry))))
}

/**
 * 生成下一版配置。
 *
 * @returns {{ next: object, warnings: string[], scans: object[], diff: object, changed: boolean }}
 */
export function generateConfig({ config, roots, filters = {}, deps = {} } = {}) {
  const existing = isPlainObject(config) ? config : {}
  const template = typeof existing.bankIdTemplate === 'string' && existing.bankIdTemplate.trim() !== ''
    ? existing.bankIdTemplate
    : DEFAULT_TEMPLATE
  const env = {
    harness: deps.harness ?? 'dsh',
    channel: deps.channel ?? process.env.HINDSIGHT_CHANNEL_ID,
    user: deps.user ?? process.env.HINDSIGHT_USER_ID,
  }
  const warnings = []
  const scans = []

  // 1. 归一化受管根：只接管有明确模式的根；短路径先处理，便于嵌套根「先清后写」。
  const managed = []
  const seenRoots = new Set()
  for (const entry of Array.isArray(roots) ? roots : []) {
    const path = normalizeRoot(entry?.path)
    if (path === '' || seenRoots.has(path)) continue
    if (!MODES.includes(entry?.mode)) continue
    seenRoots.add(path)
    const depth = Number.isSafeInteger(entry?.depth) && entry.depth > 0 ? entry.depth : DEFAULT_DEPTH
    managed.push({ path, mode: entry.mode, depth })
  }
  managed.sort((a, b) => a.path.length - b.path.length || (a.path < b.path ? -1 : 1))

  const existingMap = isPlainObject(existing.mapPathToBank) ? existing.mapPathToBank : {}
  const existingPaths = isPlainObject(existing.paths) ? existing.paths : {}

  // 2. 未受管键逐字保留（顺序即原顺序）。
  const untouched = {}
  for (const [key, value] of Object.entries(existingMap)) {
    if (!managed.some((m) => isOwnedBy(normalizeRoot(key), m.path))) untouched[key] = value
  }
  const nextPaths = {}
  for (const [key, value] of Object.entries(existingPaths)) nextPaths[key] = value

  // 3. 按模式写回受管部分。
  const generated = new Map()
  for (const m of managed) {
    const section = findPathSection(nextPaths, m.path)
    if (m.mode === 'off') {
      const base = isPlainObject(section?.value) ? section.value : {}
      nextPaths[section?.key ?? m.path] = { ...base, disabled: true }
      continue
    }
    if (section !== undefined) {
      const { disabled: _disabled, ...rest } = isPlainObject(section.value) ? section.value : {}
      if (Object.keys(rest).length === 0) delete nextPaths[section.key]
      else nextPaths[section.key] = rest
    }

    const scan = scanRoot(m.path, filters, m.depth, deps)
    if (scan.error !== undefined) {
      warnings.push(`${m.path}：${scan.error}（该根未生成映射）`)
      continue
    }
    scans.push(scan)
    const rootBank = bankNameFor(scan.projectName, template, env)
    if (rootBank.unknown.length > 0) {
      warnings.push(`${m.path}：bankIdTemplate 含未知占位符 ${rootBank.unknown.map((k) => `{${k}}`).join(' ')}，已原样保留`)
    }
    generated.set(m.path, rootBank.value)
    if (m.mode === 'independent') {
      for (const dir of scan.dirs) {
        const bank = bankNameFor(dir.projectName, template, env)
        generated.set(dir.path, bank.value)
      }
    }
    if (existing.optInOnly === true && !isOptedIn(existing, m.path)) {
      warnings.push(`${m.path}：optInOnly 已开启且该根不在 optInPaths 内，三种模式都不会产生记忆`)
    }
  }

  // 4. 组装：未受管键保持原位置，生成的键按路径升序追加。
  const finalMap = { ...untouched }
  for (const key of [...generated.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    finalMap[key] = generated.get(key)
  }

  // 5. 冲突提示：独立模式下两个目录落到同一个 bank 说明名字撞了。
  if (generated.size > 1) {
    const byBank = new Map()
    for (const [path, bank] of generated) {
      if (!byBank.has(bank)) byBank.set(bank, [])
      byBank.get(bank).push(path)
    }
    for (const [bank, paths] of byBank) {
      if (paths.length > 1) warnings.push(`多个目录解析到同一个 bank ${bank}：${paths.join('、')}`)
    }
  }
  if (existing.dynamicBankId === false && typeof existing.bankId === 'string' && existing.bankId !== '' && generated.size > 0) {
    warnings.push(`配置文件里有静态 bankId=${existing.bankId}，但 mapPathToBank 会覆盖它；此提示仅作知悉`)
  }
  if (deps.gitUnavailable?.() === true) {
    warnings.push('未检测到 git：非仓库目录按目录名取名，仓库内目录可能拿到不同的 bank 名')
  }

  const next = {}
  const written = new Set()
  for (const key of Object.keys(existing)) {
    if (key === 'mapPathToBank') {
      if (Object.keys(finalMap).length > 0) {
        next[key] = finalMap
        written.add(key)
      }
      continue
    }
    if (key === 'paths') {
      if (Object.keys(nextPaths).length > 0) {
        next[key] = nextPaths
        written.add(key)
      }
      continue
    }
    next[key] = existing[key]
  }
  if (!written.has('mapPathToBank') && Object.keys(finalMap).length > 0) next.mapPathToBank = finalMap
  if (!written.has('paths') && Object.keys(nextPaths).length > 0) next.paths = nextPaths

  return {
    next,
    warnings,
    scans,
    diff: diffConfig(existing, next),
    changed: JSON.stringify(existing) !== JSON.stringify(next),
  }
}

/** 只比较本插件负责的两个键。 */
export function diffConfig(before, after) {
  const diff = { mapPathToBank: { added: [], removed: [], changed: [] }, paths: { added: [], removed: [], changed: [] } }
  for (const key of ['mapPathToBank', 'paths']) {
    const a = isPlainObject(before?.[key]) ? before[key] : {}
    const b = isPlainObject(after?.[key]) ? after[key] : {}
    for (const name of Object.keys(b)) {
      if (!(name in a)) diff[key].added.push({ key: name, value: b[name] })
      else if (JSON.stringify(a[name]) !== JSON.stringify(b[name])) diff[key].changed.push({ key: name, from: a[name], to: b[name] })
    }
    for (const name of Object.keys(a)) if (!(name in b)) diff[key].removed.push({ key: name, value: a[name] })
  }
  return diff
}

/** 解析配置文件文本；返回 `{ config }` 或 `{ error }`。 */
export function parseConfig(text) {
  if (typeof text !== 'string' || text.trim() === '') return { config: {} }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return { error: `JSON 解析失败：${error?.message ?? error}` }
  }
  if (!isPlainObject(parsed)) return { error: '顶层不是 JSON 对象' }
  return { config: parsed }
}

/** 序列化：2 空格缩进 + 结尾换行，顶层键顺序照 next 的插入顺序。 */
export function serializeConfig(config) {
  return `${JSON.stringify(isPlainObject(config) ? config : {}, null, 2)}\n`
}
