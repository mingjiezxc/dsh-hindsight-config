/**
 * 宿主半体的路由级测试：用假 ctx / 假 req / 假 res 直接驱动 apply() 注册的路由，
 * 覆盖正常路径与 403 / 405 / 400 失败路径。不依赖浏览器，也不触碰真实配置。
 * 运行：node --test test/routes.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'

import { apply, createHost } from '../index.js'

const created = []
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hzc-routes-'))
  created.push(dir)
  return dir
}
after(() => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true })
})

function fakeHost({ liveSessions = [], workspaces } = {}) {
  const routes = []
  const sections = []
  const tools = []
  const listeners = new Map()
  const ctx = {
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(listener)
      return () => {}
    },
    inject(services, callback) {
      const sub = {}
      sub.effect = (work) => work()
      for (const service of services) {
        if (service === 'webServer') {
          sub.webServer = {
            register(route) {
              routes.push(route)
              return () => {}
            },
          }
        } else if (service === 'systemPrompt') {
          sub.systemPrompt = {
            section(spec) {
              sections.push(spec)
              return () => {}
            },
          }
        } else if (service === 'tools') {
          sub.tools = {
            register(definition) {
              tools.push(definition)
              return () => {}
            },
          }
        } else if (service === 'agents') {
          sub.agents = { list: () => liveSessions.map((cwd) => ({ session: { header: { cwd } } })) }
        } else if (service === 'workspaceRegistry' && workspaces !== undefined) {
          sub.workspaceRegistry = { list: () => workspaces.map((path) => ({ workspaceId: path, path, title: path })) }
        }
      }
      callback(sub)
    },
  }
  apply(ctx)
  const find = (path) => {
    const route = routes.find((candidate) => candidate.path === path)
    assert.ok(route, `route not registered: ${path}`)
    return route
  }
  return { routes, sections, tools, listeners, find }
}

function fakeReq({ method = 'GET', url = '/', headers = {}, body, address = '127.0.0.1' } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]
  const request = {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...headers },
    socket: { remoteAddress: address },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  return request
}

function fakeRes() {
  const res = {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      res.status = status
      res.headers = headers ?? {}
    },
    end(text) {
      res.body = text ?? ''
    },
  }
  return res
}

async function call(route, options) {
  const res = fakeRes()
  await route.handler(fakeReq(options), res)
  let json
  try {
    json = JSON.parse(res.body)
  } catch {
    json = undefined
  }
  return { status: res.status, body: json, raw: res.body, headers: res.headers }
}

let dir
let configFile
beforeEach(() => {
  dir = tempDir()
  configFile = join(dir, 'coding-agent.json')
  process.env.HINDSIGHT_CONFIG = configFile
})

const baseConfig = (root) => ({
  serverMode: 'self-hosted',
  apiUrl: 'http://192.168.188.103:18888',
  reflectTimeoutMs: 60000,
  mapPathToBank: {
    '/root/watsons-ai': 'coding-agent::watsons-ai',
    [root]: 'coding-agent::workspace',
  },
})

test('GET /state：从配置文件派生根列表', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(res.status, 200)
  assert.equal(res.body.configExists, true)
  assert.deepEqual(
    res.body.roots.map((row) => [row.path, row.mode, row.fileMode]),
    [
      ['/root/watsons-ai', 'shared', 'shared'],
      [root, 'shared', 'shared'],
    ],
  )
  assert.equal(res.body.config.apiUrl, 'http://192.168.188.103:18888')
  assert.match(res.body.detectedUnit, /\.service$/)
})

test('POST /roots + /generate：独立模式写盘、备份、幂等', async () => {
  const root = tempDir()
  for (const name of ['alpha', 'beta']) mkdirSync(join(root, name), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()

  const saved = await call(find('/api/dsh-hindsight-config/roots'), {
    method: 'POST',
    body: { roots: [{ path: root, mode: 'independent', depth: 1 }] },
  })
  assert.equal(saved.status, 200)
  assert.deepEqual(saved.body.roots, [{ path: root, mode: 'independent', depth: 1 }])

  const first = await call(find('/api/dsh-hindsight-config/generate'), { method: 'POST', body: {} })
  assert.equal(first.status, 200)
  assert.equal(first.body.written, true)
  assert.ok(typeof first.body.backup === 'string' && existsSync(first.body.backup), '覆盖已有文件前必须备份')
  const written = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(written.mapPathToBank['/root/watsons-ai'], 'coding-agent::watsons-ai')
  assert.equal(written.mapPathToBank[root], `coding-agent::${root.split('/').pop()}`)
  assert.equal(typeof written.mapPathToBank[join(root, 'alpha')], 'string')
  assert.equal(written.serverMode, 'self-hosted')

  const second = await call(find('/api/dsh-hindsight-config/generate'), { method: 'POST', body: {} })
  assert.equal(second.body.changed, false)
  assert.equal(second.body.written, false)
  assert.ok(readdirSync(dir).some((name) => name.startsWith('coding-agent.json.bak-')))
})

test('POST /generate：off 模式写 paths.disabled 并清掉子树映射', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()
  await call(find('/api/dsh-hindsight-config/roots'), { method: 'POST', body: { roots: [{ path: root, mode: 'off' }] } })
  const res = await call(find('/api/dsh-hindsight-config/generate'), { method: 'POST', body: {} })
  assert.equal(res.status, 200)
  const written = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(written.mapPathToBank[root], undefined)
  assert.deepEqual(written.paths, { [root]: { disabled: true } })
})

test('POST /generate：dryRun 不写盘；非法 JSON 拒绝写入', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()
  const before = readFileSync(configFile, 'utf8')
  const dry = await call(find('/api/dsh-hindsight-config/generate'), { method: 'POST', body: { roots: [{ path: root, mode: 'off' }], dryRun: true } })
  assert.equal(dry.status, 200)
  assert.equal(dry.body.written, false)
  assert.equal(readFileSync(configFile, 'utf8'), before)

  writeFileSync(configFile, '{ broken')
  const broken = await call(find('/api/dsh-hindsight-config/generate'), { method: 'POST', body: {} })
  assert.equal(broken.status, 400)
  assert.match(broken.body.error, /JSON/)
  assert.equal(readFileSync(configFile, 'utf8'), '{ broken')
})

test('POST /reload：报告已解析目录需要重启', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify({ mapPathToBank: { [root]: 'b' } }, null, 2)}\n`)
  const { find, listeners } = fakeHost()
  // 模拟一个会话在 root 下创建（Hindsight 半体会在那里缓存 bank）。
  const agentCreated = listeners.get('agent/created')?.[0]
  assert.equal(typeof agentCreated, 'function')
  agentCreated({ agent: { session: { header: { cwd: root } } } })
  const res = await call(find('/api/dsh-hindsight-config/reload'), { method: 'POST', body: {} })
  assert.equal(res.status, 200)
  const row = res.body.roots.find((entry) => entry.path === root)
  assert.equal(row.resolvedInProcess, true)
  assert.equal(row.effective, 'restart-required')
  assert.match(res.body.note, /重启/)
})

test('挂载时已存在的存活会话也算「本进程已解析」', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify({ mapPathToBank: { [root]: 'b' } }, null, 2)}\n`)
  const { find } = fakeHost({ liveSessions: [root, '/root/dev'] })
  const res = await call(find('/api/dsh-hindsight-config/state'))
  const row = res.body.roots.find((entry) => entry.path === root)
  assert.equal(row.resolvedInProcess, true)
  const reload = await call(find('/api/dsh-hindsight-config/reload'), { method: 'POST', body: {} })
  assert.equal(reload.body.roots.find((entry) => entry.path === root).effective, 'restart-required')
})

test('agent/pre-step 是穿透型监听（返回 next() 的结果）', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify({ mapPathToBank: { [root]: 'b' } }, null, 2)}\n`)
  const { listeners } = fakeHost()
  const preStep = listeners.get('agent/pre-step')?.[0]
  assert.equal(typeof preStep, 'function')
  const decision = { kind: 'enter' }
  assert.deepEqual(await preStep({ agent: { session: { header: { cwd: root } } } }, () => Promise.resolve(decision)), decision)
})

test('围栏：非回环 403、跨站 403、方法不符 405、坏 body 400', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find, routes } = fakeHost()
  assert.deepEqual(routes.map((route) => route.path).sort(), [
    '/api/dsh-hindsight-config/candidates',
    '/api/dsh-hindsight-config/generate',
    '/api/dsh-hindsight-config/reload',
    '/api/dsh-hindsight-config/restart',
    '/api/dsh-hindsight-config/roots',
    '/api/dsh-hindsight-config/state',
    '/api/dsh-hindsight-config/tree',
  ])

  const remote = await call(find('/api/dsh-hindsight-config/state'), { address: '192.168.188.50' })
  assert.equal(remote.status, 403)
  assert.match(remote.body.error, /loopback-only/)

  const crossSite = await call(find('/api/dsh-hindsight-config/state'), { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(crossSite.status, 403)

  const lanHost = await call(find('/api/dsh-hindsight-config/state'), { headers: { host: '192.168.188.101:3080' } })
  assert.equal(lanHost.status, 403)

  const wrongMethod = await call(find('/api/dsh-hindsight-config/state'), { method: 'POST' })
  assert.equal(wrongMethod.status, 405)

  const badBody = await call(find('/api/dsh-hindsight-config/roots'), { method: 'POST', body: '{ nope' })
  assert.equal(badBody.status, 400)
  assert.match(badBody.body.error, /invalid JSON body/)
})

test('GET /tree：列举子目录并标注仓库名', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  mkdirSync(join(root, '.hidden'), { recursive: true })
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/tree'), { url: `/api/dsh-hindsight-config/tree?path=${encodeURIComponent(root)}` })
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.subdirs.map((entry) => entry.name), ['alpha'])
  const missing = await call(find('/api/dsh-hindsight-config/tree'), { url: '/api/dsh-hindsight-config/tree?path=/no/such/dir' })
  assert.equal(missing.status, 400)
})

test('GET /candidates：顶层工作区里未加为受管根的那些', async () => {
  const root = tempDir()
  // 顶层 4 个 + 其下的嵌套工作区；已受管根 /root/dev、/root/watsons-ai
  const workspaces = [
    '/root/dev',
    '/root/dev/ops',
    '/root/dev/repo-review-graph',
    '/root/watsons-ai',
    '/root/watsons-ai/watsonsbot',
    '/root/workspace',
    '/root/github',
    '/root/github/registries-mirrors',
  ]
  // 只有真实存在的目录才会成为候选：临时目录里造 workspace / github / watsons-ai
  for (const name of ['workspace', 'github', 'watsons-ai']) mkdirSync(join(dir, name), { recursive: true })
  writeFileSync(
    configFile,
    `${JSON.stringify({ mapPathToBank: { [join(dir, 'dev')]: 'b' } }, null, 2)}\n`,
  )
  writeFileSync(
    join(dir, 'coding-agent.dsh.json'),
    `${JSON.stringify({
      version: 1,
      roots: [
        { path: join(dir, 'dev'), mode: 'shared', depth: 1 },
        { path: join(dir, 'watsons-ai'), mode: 'shared', depth: 1 },
      ],
      filters: { skipHidden: true, skipNodeModules: true, skipEmpty: false, includeSymlinks: false },
      restartUnit: 'dsh-web.service',
    }, null, 2)}\n`,
  )
  const { find } = fakeHost({ workspaces: workspaces.map((path) => path.replace('/root', dir)) })
  const res = await call(find('/api/dsh-hindsight-config/candidates'))
  assert.equal(res.status, 200)
  // 顶层 = dev / watsons-ai / workspace / github；dev、watsons-ai 已受管 → 只剩 workspace、github
  assert.deepEqual(res.body.candidates.map((row) => row.path), [join(dir, 'github'), join(dir, 'workspace')])
  assert.deepEqual(res.body.candidates.map((row) => row.title), ['github', 'workspace'])
  assert.equal(res.body.topLevel, 4)
})

test('GET /candidates：没有工作区注册表服务时安全返回空', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify({ mapPathToBank: { [root]: 'b' } }, null, 2)}\n`)
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/candidates'))
  assert.equal(res.status, 200)
  assert.deepEqual(res.body.candidates, [])
  assert.equal(res.body.reason, 'no-workspace-registry')
})

test('POST /restart：缺 confirm 时 400', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/restart'), { method: 'POST', body: {} })
  assert.equal(res.status, 400)
  assert.match(res.body.error, /confirm/)
})

test('系统提示段与只读工具都已注册', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { sections, tools } = fakeHost()
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'plugin:dsh-hindsight-config')
  assert.match(sections[0].text, /独立/)
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'hindsight_memory_mode')
  const summary = JSON.parse(await tools[0].execute({}))
  assert.ok(Array.isArray(summary.managedRoots))
  assert.ok(summary.managedRoots.some((row) => row.path === root))
  const detail = JSON.parse(await tools[0].execute({ path: root }))
  assert.deepEqual(detail.entries.map((entry) => entry.name), ['alpha'])
  const missing = JSON.parse(await tools[0].execute({ path: '/no/such/dir' }))
  assert.match(missing.error, /不存在/)
})

test('状态文件原子写：坏状态文件回落到派生', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  writeFileSync(join(dir, 'coding-agent.dsh.json'), '{ not json')
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(res.status, 200)
  assert.equal(res.body.stateDerived, true)
  assert.ok(res.body.roots.some((row) => row.path === root))
  assert.ok(existsSync(join(dir, 'coding-agent.dsh.json')))
})

test('「自动」选项：/state 缺省值、/roots 可写、落进状态文件', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()

  const initial = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(initial.status, 200)
  assert.equal(initial.body.autoMode, 'independent')
  assert.equal(initial.body.autoApply, true)

  const saved = await call(find('/api/dsh-hindsight-config/roots'), {
    method: 'POST',
    body: { roots: [{ path: root, mode: 'independent', depth: 1 }], autoMode: 'shared', autoApply: false },
  })
  assert.equal(saved.status, 200)

  const after = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(after.body.autoMode, 'shared')
  assert.equal(after.body.autoApply, false)
  const stateFile = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.equal(stateFile.autoMode, 'shared')
  assert.equal(stateFile.autoApply, false)
})

test('「自动」选项：非法 autoMode 回落独立，autoApply 只认真 false', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  writeFileSync(
    join(dir, 'coding-agent.dsh.json'),
    JSON.stringify({ roots: [{ path: root, mode: 'off' }], autoMode: 'nope', autoApply: 1 }),
  )
  const { find } = fakeHost()
  const res = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(res.body.autoMode, 'independent')
  assert.equal(res.body.autoApply, true)
})

test('「自动」选项：autoApply=false 时仍能保存根目录，状态文件不再回落缺省', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost()
  await call(find('/api/dsh-hindsight-config/roots'), {
    method: 'POST',
    body: { roots: [{ path: root, mode: 'off', depth: 1 }] },
  })
  const stateFile = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.equal(stateFile.autoApply, true, '未显式传 autoApply 时保持当前状态（缺省开）')
  assert.equal(stateFile.autoMode, 'independent')

  await call(find('/api/dsh-hindsight-config/roots'), {
    method: 'POST',
    body: { roots: [{ path: root, mode: 'off', depth: 1 }], autoApply: false },
  })
  const off = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.equal(off.autoApply, false, 'body.autoApply=false 不能被 ?? 吞掉')
})

/* ------------------------------------------------------------------ *
 * 「自动」监听：跟随 DSH 工作区注册表的变化
 * ------------------------------------------------------------------ */

const fakeRegistry = (rows) => ({
  list: () => rows.map((path) => ({ workspaceId: path, path, title: path })),
})

test('自动监听：首次检查不新增根但重建已有根，工作区新增后按默认模式加根并写配置', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  writeFileSync(
    join(dir, 'coding-agent.dsh.json'),
    JSON.stringify({ roots: [{ path: root, mode: 'independent', depth: 1 }], autoMode: 'shared', autoApply: true }),
  )
  const host = createHost()
  const rows = [root]
  host.setWorkspaceRegistry(fakeRegistry(rows))

  const baseline = await host.autoTick()
  assert.equal(baseline.baseline, true)
  assert.equal(baseline.written, true)
  const afterBaseline = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(typeof afterBaseline.mapPathToBank[join(root, 'alpha')], 'string', '首次检查重建已有受管根')
  assert.equal(afterBaseline.mapPathToBank[join(dir, 'fresh')], undefined, '首次检查不新增受管根')

  mkdirSync(join(dir, 'fresh'), { recursive: true })
  rows.push(join(dir, 'fresh'))
  const tick = await host.autoTick()
  assert.equal(tick.ok, true)
  assert.deepEqual(tick.added, [join(dir, 'fresh')])
  assert.equal(tick.written, true)
  assert.ok(typeof tick.backup === 'string' && existsSync(tick.backup))

  const written = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(written.mapPathToBank[join(dir, 'fresh')], 'coding-agent::fresh')
  const state = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.ok(state.roots.some((row) => row.path === join(dir, 'fresh') && row.mode === 'shared'))

  const again = await host.autoTick()
  assert.equal(again.unchanged, true)
})

test('自动监听：autoApply 关闭时不写盘、不加根', async () => {
  const root = tempDir()
  mkdirSync(join(root, 'alpha'), { recursive: true })
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  writeFileSync(
    join(dir, 'coding-agent.dsh.json'),
    JSON.stringify({ roots: [{ path: root, mode: 'independent', depth: 1 }], autoApply: false }),
  )
  const host = createHost()
  const rows = [root]
  host.setWorkspaceRegistry(fakeRegistry(rows))
  await host.autoTick()
  const before = readFileSync(configFile, 'utf8')
  mkdirSync(join(dir, 'fresh'), { recursive: true })
  rows.push(join(dir, 'fresh'))
  const tick = await host.autoTick()
  assert.equal(tick.skipped, 'auto-apply-off')
  assert.equal(readFileSync(configFile, 'utf8'), before)
  const state = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.equal(state.roots.length, 1)
})

test('自动监听：受管根下的新工作区不重复加根，但会写进映射', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  writeFileSync(
    join(dir, 'coding-agent.dsh.json'),
    JSON.stringify({ roots: [{ path: root, mode: 'independent', depth: 1 }], autoMode: 'independent', autoApply: true }),
  )
  const host = createHost()
  const rows = [root]
  host.setWorkspaceRegistry(fakeRegistry(rows))
  await host.autoTick()

  const nested = join(root, 'project-x')
  mkdirSync(nested, { recursive: true })
  rows.push(nested)
  const tick = await host.autoTick()
  assert.deepEqual(tick.added, [])
  assert.equal(tick.written, true)
  const written = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(written.mapPathToBank[nested], 'coding-agent::project-x')
  const state = JSON.parse(readFileSync(join(dir, 'coding-agent.dsh.json'), 'utf8'))
  assert.equal(state.roots.length, 1)
})

test('GET /state：暴露「自动」监听状态', async () => {
  const root = tempDir()
  writeFileSync(configFile, `${JSON.stringify(baseConfig(root), null, 2)}\n`)
  const { find } = fakeHost({ workspaces: [root] })
  const res = await call(find('/api/dsh-hindsight-config/state'))
  assert.equal(res.body.auto.enabled, true)
  assert.equal(res.body.auto.watching, true)
  assert.ok(res.body.auto.pollIntervalMs >= 0)
})

