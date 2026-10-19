/**
 * generate.js 的单测：树扫描 → 映射生成 → 幂等 → 保留未受管内容。
 * 运行：node --test test/generate.test.mjs
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, test } from 'node:test'

import {
  bankNameFor,
  deriveMode,
  deriveRoots,
  generateConfig,
  gitProjectName,
  normalizeRoot,
  parseConfig,
  resetProbeCaches,
  serializeConfig,
} from '../generate.js'

const created = []
function tempTree(spec) {
  const root = mkdtempSync(join(tmpdir(), 'hzc-test-'))
  created.push(root)
  for (const [rel, kind] of Object.entries(spec)) {
    const path = join(root, rel)
    if (kind === 'dir') mkdirSync(path, { recursive: true })
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, kind)
    }
  }
  return root
}
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

/** 默认模板下的 bank 名。 */
const bank = (name) => `coding-agent::${name}`

/** 测试用依赖：项目名 = 目录名，git 永远「可用」。 */
const deps = { projectName: (dir) => basename(dir), gitUnavailable: () => false }

const baseConfig = () => ({
  serverMode: 'self-hosted',
  apiUrl: 'http://192.168.188.103:18888',
  reflectTimeoutMs: 60000,
  mapPathToBank: {
    '/root/watsons-ai': 'coding-agent::watsons-ai',
    '/root/dev/ops': 'coding-agent::ops',
    [ROOT]: bank('workspace'),
  },
})

let ROOT = ''
function makeRoot() {
  ROOT = tempTree({
    'alpha/.git': 'dir',
    'alpha/keep.txt': 'x',
    'beta/nested/deep.txt': 'x',
    '.hidden/x.txt': 'x',
    'node_modules/x.txt': 'x',
    'empty': 'dir',
  })
  return ROOT
}

test('shared：只写根目录一条映射，删除子树条目', () => {
  const root = makeRoot()
  const config = { ...baseConfig(), mapPathToBank: { '/root/watsons-ai': 'coding-agent::watsons-ai', [root]: 'coding-agent::workspace', [`${root}/alpha`]: 'coding-agent::old-alpha' } }
  const { next, changed } = generateConfig({ config, roots: [{ path: root, mode: 'shared' }], deps })
  assert.equal(changed, true)
  assert.deepEqual(next.mapPathToBank, {
    '/root/watsons-ai': 'coding-agent::watsons-ai',
    [root]: bank(basename(root)),
  })
  assert.equal(next.serverMode, 'self-hosted')
  assert.equal(next.apiUrl, 'http://192.168.188.103:18888')
})

test('independent：根 + 每个直接子目录各一条，跳过隐藏/node_modules', () => {
  const root = makeRoot()
  const { next } = generateConfig({ config: baseConfig(), roots: [{ path: root, mode: 'independent' }], deps })
  const keys = Object.keys(next.mapPathToBank)
  assert.deepEqual(keys, [
    '/root/watsons-ai',
    '/root/dev/ops',
    root,
    `${root}/alpha`,
    `${root}/beta`,
    `${root}/empty`,
  ])
  assert.equal(next.mapPathToBank[`${root}/alpha`], bank('alpha'))
  assert.equal(next.mapPathToBank[`${root}/alpha/nested`], undefined)
})

test('depth=2：多带一层孙目录', () => {
  const root = makeRoot()
  const { next } = generateConfig({ config: {}, roots: [{ path: root, mode: 'independent', depth: 2 }], deps })
  assert.deepEqual(Object.keys(next.mapPathToBank).sort(), [root, `${root}/alpha`, `${root}/beta`, `${root}/beta/nested`, `${root}/empty`].sort())
})

test('off：清掉子树条目并写 paths.<root>.disabled', () => {
  const root = makeRoot()
  const { next } = generateConfig({ config: baseConfig(), roots: [{ path: root, mode: 'off' }], deps })
  assert.equal(next.mapPathToBank[root], undefined)
  assert.equal(next.mapPathToBank['/root/watsons-ai'], 'coding-agent::watsons-ai')
  assert.deepEqual(next.paths, { [root]: { disabled: true } })
})

test('off → shared：删掉 disabled，且保留 paths 节里的其它字段', () => {
  const root = makeRoot()
  const config = { mapPathToBank: {}, paths: { [root]: { disabled: true, apiToken: 'k' } } }
  const off = generateConfig({ config, roots: [{ path: root, mode: 'off' }], deps })
  assert.deepEqual(off.next.paths[root], { apiToken: 'k', disabled: true })
  const shared = generateConfig({ config: off.next, roots: [{ path: root, mode: 'shared' }], deps })
  assert.deepEqual(shared.next.paths[root], { apiToken: 'k' })
  assert.equal(shared.next.mapPathToBank[root], bank(basename(root)))
})

test('未受管内容逐字保留（顶层键顺序与未受管映射条目）', () => {
  const root = makeRoot()
  const config = {
    serverMode: 'self-hosted',
    apiUrl: 'u',
    mapPathToBank: { '/root/dev/ops': 'coding-agent::ops' },
    retainTags: ['project:{gitProject}'],
    paths: { '/root/dev/ops': { serverMode: 'daemon' } },
  }
  const { next } = generateConfig({ config, roots: [{ path: root, mode: 'shared' }], deps })
  assert.deepEqual(Object.keys(next), ['serverMode', 'apiUrl', 'mapPathToBank', 'retainTags', 'paths'])
  assert.equal(next.retainTags[0], 'project:{gitProject}')
  assert.deepEqual(next.paths['/root/dev/ops'], { serverMode: 'daemon' })
})

test('幂等：连续两次生成完全相同', () => {
  const root = makeRoot()
  const first = generateConfig({ config: baseConfig(), roots: [{ path: root, mode: 'independent' }], deps })
  const second = generateConfig({ config: first.next, roots: [{ path: root, mode: 'independent' }], deps })
  assert.equal(second.changed, false)
  assert.equal(serializeConfig(second.next), serializeConfig(first.next))
  assert.deepEqual(second.diff.mapPathToBank, { added: [], removed: [], changed: [] })
})

test('嵌套受管根：短者先清、长者后写', () => {
  const root = makeRoot()
  const inner = `${root}/beta`
  const { next } = generateConfig({
    config: { mapPathToBank: {} },
    roots: [
      { path: inner, mode: 'independent' },
      { path: root, mode: 'shared' },
    ],
    deps,
  })
  assert.deepEqual(Object.keys(next.mapPathToBank), [root, inner, `${inner}/nested`])
})

test('过滤开关：skipEmpty / includeSymlinks', () => {
  const root = makeRoot()
  const noEmpty = generateConfig({ config: {}, roots: [{ path: root, mode: 'independent' }], deps, filters: { skipEmpty: true } })
  assert.equal(noEmpty.next.mapPathToBank[`${root}/empty`], undefined)
  symlinkSync(join(root, 'alpha'), join(root, 'link-alpha'))
  const withLinks = generateConfig({ config: {}, roots: [{ path: root, mode: 'independent' }], deps, filters: { includeSymlinks: true } })
  // 链接按目标取名：与目标落到同一个 bank，并因此触发「同名 bank」提示。
  assert.equal(withLinks.next.mapPathToBank[`${root}/link-alpha`], bank('alpha'))
  assert.ok(withLinks.warnings.some((w) => w.includes('link-alpha') && w.includes('alpha')))
})

test('optInOnly 未覆盖该根时给警告', () => {
  const root = makeRoot()
  const { warnings } = generateConfig({
    config: { optInOnly: true, optInPaths: ['/root/other'], mapPathToBank: {} },
    roots: [{ path: root, mode: 'shared' }],
    deps,
  })
  assert.ok(warnings.some((w) => w.includes('optInOnly')))
})

test('bankIdTemplate 替换与未知占位符回落', () => {
  assert.deepEqual(bankNameFor('alpha', 'coding-agent::{gitProject}', {}), { value: 'coding-agent::alpha', unknown: [] })
  assert.deepEqual(bankNameFor('alpha', '{harness}-{project}', {}), { value: 'dsh-alpha', unknown: [] })
  const unknown = bankNameFor('alpha', 'x-{channel}-{gitProject}', {})
  assert.equal(unknown.value, 'x-{channel}-alpha')
  assert.deepEqual(unknown.unknown, ['channel'])
  const root = makeRoot()
  const { warnings } = generateConfig({ config: { bankIdTemplate: 'bank-{user}-{project}' }, roots: [{ path: root, mode: 'shared' }], deps: { ...deps, user: undefined } })
  assert.ok(warnings.some((w) => w.includes('{user}')))
})

test('目录不存在：警告但不阻断其它根', () => {
  const root = makeRoot()
  const { next, warnings } = generateConfig({
    config: { mapPathToBank: {} },
    roots: [
      { path: '/definitely/missing/dir', mode: 'shared' },
      { path: root, mode: 'off' },
    ],
    deps,
  })
  assert.equal(next.paths[root].disabled, true)
  assert.ok(warnings.some((w) => w.includes('/definitely/missing/dir')))
})

test('parseConfig 与 serializeConfig', () => {
  assert.deepEqual(parseConfig(''), { config: {} })
  assert.ok(parseConfig('{oops').error)
  assert.ok(parseConfig('[1,2]').error)
  assert.deepEqual(parseConfig('{"a":1}'), { config: { a: 1 } })
  assert.equal(serializeConfig({ a: 1 }), '{\n  "a": 1\n}\n')
})

test('deriveMode / deriveRoots 从文件形状反推', () => {
  const root = '/root/workspace'
  assert.equal(deriveMode({ mapPathToBank: { [root]: 'b' } }, root), 'shared')
  assert.equal(deriveMode({ mapPathToBank: { [root]: 'b', [`${root}/a`]: 'b2' } }, root), 'independent')
  assert.equal(deriveMode({ mapPathToBank: { [`${root}/a`]: 'b2' } }, root), 'independent')
  assert.equal(deriveMode({ paths: { [root]: { disabled: true } } }, root), 'off')
  assert.equal(deriveMode({}, root), 'unconfigured')
  const roots = deriveRoots({ mapPathToBank: { '/root/dev/ops': 'x', [root]: 'y' }, paths: { '/root/dev/ops': { disabled: true } } })
  assert.deepEqual(roots.map((r) => [r.path, r.mode]), [['/root/dev/ops', 'off'], [root, 'shared']])
})

test('normalizeRoot 处理尾斜杠与相对路径', () => {
  assert.equal(normalizeRoot('/a/b/'), '/a/b')
  assert.equal(normalizeRoot('/'), '/')
  assert.equal(normalizeRoot('  '), '')
  assert.equal(normalizeRoot('relative'), normalizeRoot(join(process.cwd(), 'relative')))
})

test('git 仓库名探测（无 git 或非仓库时回落目录名）', (t) => {
  const dir = tempTree({ 'repo/.keep': 'x' })
  const repo = join(dir, 'repo')
  const fallback = gitProjectName(repo)
  assert.equal(typeof fallback, 'string')
  assert.ok(fallback.length > 0)
  let gitOk = true
  try {
    execFileSync('git', ['init', '-q', repo], { stdio: 'ignore' })
  } catch {
    gitOk = false
  }
  if (!gitOk) {
    t.diagnostic('git 不可用，跳过仓库名断言')
    return
  }
  resetProbeCaches()
  assert.equal(gitProjectName(repo), 'repo')
  assert.ok(existsSync(join(repo, '.git')))
})
