/**
 * 浏览器半体的浅层渲染测试：用假 window.__ModuleLoader__ + 迷你 React 加载 client.js，
 * 驱动 apply() 的槽位注册，并把卡片渲染到「已加载数据」的分支。
 * 覆盖：模块 id、四个槽位 key、渲染不抛错、文案已本地化（没有漏出 i18n 键名）、
 * 候选起点的过滤与「点候选 → 填进输入框」的交互。
 * 运行：node --test test/client.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

let loaded

globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

/** 假 document：样式表注入只需要 getElementById / createElement / head.appendChild。 */
globalThis.document = {
  getElementById() {
    return null
  },
  createElement() {
    return { id: '', textContent: '', remove() {} }
  },
  head: { appendChild() {} },
}

await import('../client.js')

assert.ok(loaded, 'client.js 必须调用 window.__ModuleLoader__.load')
assert.equal(loaded.id, '@major.chen/dsh-hindsight-config')

function fakeJsxRuntime() {
  return {
    jsx: (type, props, key) => ({ type, props: props ?? {}, key }),
    jsxs: (type, props, key) => ({ type, props: props ?? {}, key }),
  }
}

/**
 * 迷你 React：useState 存进一个持久数组，重渲染读到最新值——测试因此能点按钮
 * （直接调 props.onClick）并断言状态变化。hook 顺序与组件里 useState 的调用顺序一致：
 *   0 open 1 snapshot 2 roots 3 filters 4 busy 5 error 6 ok 7 warnings 8 backup
 *   9 diff 10 effect 11 draftRoot 12 armed 13 autoMode 14 autoApply 15 candidates 16 candidatesNote
 * `states` 预填即等于初始状态。
 */
function createMount() {
  const states = []
  let index = 0
  const React = {
    useState: (initial) => {
      const at = index
      index += 1
      if (!(at in states)) states[at] = initial
      return [
        states[at],
        (next) => {
          states[at] = typeof next === 'function' ? next(states[at]) : next
        },
      ]
    },
    useEffect: () => {},
    useCallback: (fn) => fn,
  }
  const require_ = (name) => {
    if (name === 'react') return React
    if (name === 'react/jsx-runtime') return fakeJsxRuntime()
    throw new Error(`unexpected require: ${name}`)
  }
  const exports_ = loaded.factory(require_)
  const slots = fakeSlots()
  exports_.apply({
    inject: (services, callback) => (services.includes('locale') ? undefined : callback({ slots })),
    effect: (work) => work(),
    slots,
  })
  const component = slots.registrations.find((entry) => entry.options.name === 'plugins.bundle.config').component
  return {
    slots,
    states,
    render(props) {
      index = 0
      return component({ view: 'page', ...(props ?? {}) })
    },
    text(props) {
      return textOf(this.render(props)).join('\n')
    },
  }
}

/** 收集渲染树里的可读文本。 */
function textOf(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const item of node) textOf(item, out)
    return out
  }
  if (typeof node === 'object') {
    textOf(node.props?.children, out)
    if (typeof node.props?.placeholder === 'string') out.push(node.props.placeholder)
  }
  return out
}

/** 收集所有 className 命中的节点。 */
function findAllClass(node, className, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) findAllClass(item, className, out)
    return out
  }
  if (node.props?.className === className) out.push(node)
  findAllClass(node.props?.children, className, out)
  return out
}

function fakeSlots(declare) {
  const registrations = []
  return {
    registrations,
    inject(owner, callback) {
      // declare 用来模拟「旧宿主没有这个槽位」：注入回调不触发。
      if (declare !== undefined && declare(owner) !== true) return () => {}
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  }
}

function applyWith(slots) {
  const exports_ = loaded.factory(fakeJsxRuntimeRequire)
  const effects = []
  exports_.apply({
    inject(services, callback) {
      // locale 服务缺失时不该出事（老宿主路径）
      if (services.includes('locale')) return undefined
      return callback({ slots })
    },
    effect(work) {
      effects.push(work)
      return work()
    },
    slots,
  })
  return { exports_, effects }
}

function fakeJsxRuntimeRequire(name) {
  if (name === 'react') return { useState: (initial) => [initial, () => {}], useEffect: () => {}, useCallback: (fn) => fn }
  if (name === 'react/jsx-runtime') return fakeJsxRuntime()
  throw new Error(`unexpected require: ${name}`)
}

const FILTERS = { skipHidden: true, skipNodeModules: true, skipEmpty: false, includeSymlinks: false }

function rootRow(path, extra = {}) {
  return {
    path,
    mode: 'shared',
    depth: 1,
    configured: true,
    exists: true,
    projectName: path.split('/').pop(),
    isRepo: false,
    drift: false,
    resolvedInProcess: false,
    subdirs: [],
    ...extra,
  }
}

function snapshotFor(roots, extra = {}) {
  return {
    ok: true,
    configFile: '/root/.hindsight/coding-agent.json',
    configExists: true,
    stateFile: '/root/.hindsight/coding-agent.dsh.json',
    stateDerived: false,
    config: { mapPathToBank: {} },
    roots,
    filters: FILTERS,
    restartUnit: 'dsh-web.service',
    restartAfterGenerate: false,
    autoMode: 'independent',
    autoApply: true,
    resolvedElsewhere: [],
    detectedUnit: 'dsh-web.service',
    gitAvailable: true,
    ...extra,
  }
}

test('现代宿主：内联位优先，不再重复注册本包的 row 槽', () => {
  const slots = fakeSlots()
  const { exports_, effects } = applyWith(slots)
  assert.deepEqual(exports_.inject, ['slots'])
  assert.equal(typeof exports_.apply, 'function')
  assert.deepEqual(
    slots.registrations.map((entry) => entry.options.name).sort(),
    ['plugins.bundle.config', 'settings.kit.item', 'settings.plugin.item'],
  )
  const bundleConfig = slots.registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  assert.equal(bundleConfig.options.key, '@major.chen/dsh-hindsight-config')
  assert.equal(typeof bundleConfig.component, 'function')
  assert.equal(effects.length, 1)
})

test('旧宿主：bundle 内联位不存在时回退到 row 槽', () => {
  const slots = fakeSlots((owner) => owner === 'plugins.row.config')
  applyWith(slots)
  assert.deepEqual(slots.registrations.map((entry) => entry.options.name), ['plugins.row.config'])
  assert.equal(slots.registrations[0].options.key, '@major.chen/dsh-hindsight-config#hindsight-config')
})

test('页面视图渲染：不抛错、文案已本地化', () => {
  const text = createMount().text()
  assert.match(text, /记忆模式/)
  assert.match(text, /关闭/)
  assert.match(text, /独立/)
  assert.match(text, /共享/)
  assert.match(text, /重新生成/)
  assert.match(text, /重载/)
  assert.match(text, /应用并重启/)
  // 初始快照为 null，不能出现未替换的 i18n 键名
  const leaked = text.split('\n').filter((line) => /^[a-z][a-zA-Z]*\.[a-zA-Z.]+$/.test(line.trim()))
  assert.deepEqual(leaked, [])
})

test('有数据时渲染：根行、diff、备份、生效范围', () => {
  const mount = createMount()
  mount.states[1] = snapshotFor([
    rootRow('/root/workspace', {
      mode: 'independent',
      drift: true,
      resolvedInProcess: true,
      subdirs: [{ name: 'n8n', path: '/root/workspace/n8n', projectName: 'n8n' }],
    }),
  ])
  mount.states[2] = [{ path: '/root/workspace', mode: 'independent', depth: 1 }]
  mount.states[3] = FILTERS
  mount.states[7] = ['同名 bank 提示']
  mount.states[8] = '/root/.hindsight/coding-agent.json.bak-20261016-222216'
  mount.states[9] = {
    mapPathToBank: { added: [{ key: '/root/workspace/n8n', value: 'coding-agent::n8n' }], removed: [], changed: [] },
    paths: { added: [], removed: [], changed: [] },
  }
  mount.states[10] = {
    roots: [{ path: '/root/workspace', mode: 'independent', effective: 'restart-required', drift: false }],
    note: '需重启 DSH 宿主',
  }
  const text = mount.text()
  assert.match(text, /bank：workspace/)
  assert.match(text, /文件与设置不一致/)
  assert.match(text, /本次改动/)
  assert.match(text, /备份：\/root\/\.hindsight/)
  assert.match(text, /同名 bank 提示/)
  assert.match(text, /生效范围/)
  assert.match(text, /需重启才生效/)
  assert.match(text, /dsh-web\.service/)
  // 受管根行里不再有「查看子目录」清单
  assert.doesNotMatch(text, /查看子目录/)
})

test('候选起点：只显示未添加的顶层工作区，点一下把路径填进「添加根目录」的输入框', () => {
  const mount = createMount()
  mount.states[1] = snapshotFor([rootRow('/root/dev'), rootRow('/root/watsons-ai'), rootRow('/root/workspace')])
  mount.states[2] = [
    { path: '/root/dev', mode: 'shared', depth: 1 },
    { path: '/root/watsons-ai', mode: 'shared', depth: 1 },
    { path: '/root/workspace', mode: 'shared', depth: 1 },
  ]
  mount.states[3] = FILTERS
  // 宿主（/candidates）给出四个顶层工作区，其中三个已加
  mount.states[15] = [
    { path: '/root/dev', title: 'dev' },
    { path: '/root/github', title: 'github' },
    { path: '/root/watsons-ai', title: 'watsons-ai' },
    { path: '/root/workspace', title: 'workspace' },
  ]
  mount.states[16] = ''
  const tree = mount.render()
  const chips = findAllClass(tree, 'hzc_btnGhost').filter(
    (node) => typeof node.props.title === 'string' && node.props.title.startsWith('/root/'),
  )
  assert.deepEqual(chips.map((chip) => chip.props.children), ['github'])
  assert.equal(chips[0].props.title, '/root/github')
  assert.match(textOf(tree).join('\n'), /候选起点：/)

  // 点候选 → 只填进输入框，不直接添加
  chips[0].props.onClick()
  assert.equal(mount.states[11], '/root/github')
  const input = findAllClass(mount.render(), 'hzc_input').find((node) => node.props.placeholder === '/root/workspace')
  assert.equal(input.props.value, '/root/github')
})

test('候选起点：宿主还是旧版本（没有该路由）时只提示重启', () => {
  const mount = createMount()
  mount.states[1] = snapshotFor([rootRow('/root/dev')])
  mount.states[2] = [{ path: '/root/dev', mode: 'shared', depth: 1 }]
  mount.states[3] = FILTERS
  mount.states[15] = []
  mount.states[16] = '候选起点需要重启 DSH 加载宿主新版本后才会出现。'
  const text = mount.text()
  assert.match(text, /候选起点：/)
  assert.match(text, /需要重启 DSH/)
})

test('摘要视图只回描述', () => {
  const mount = createMount()
  const component = mount.slots.registrations.find((entry) => entry.options.name === 'plugins.bundle.config').component
  assert.match(String(component({ view: 'summary' })), /记忆路由/)
})

test('有数据时渲染：自动选项', () => {
  const mount = createMount()
  mount.states[1] = snapshotFor([rootRow('/root/workspace')], { autoMode: 'shared', autoApply: false })
  mount.states[2] = [{ path: '/root/workspace', mode: 'shared', depth: 1 }]
  mount.states[3] = FILTERS
  mount.states[13] = 'shared'
  mount.states[14] = false
  mount.states[15] = [{ path: '/root/github', title: 'github' }]
  const text = mount.text()
  assert.match(text, /自动/)
  assert.match(text, /工作区或受管根目录变动后立即写入配置/)
  assert.match(text, /新增根目录的默认模式/)
  assert.match(text, /添加根目录/)
  assert.match(text, /候选起点：/)
  assert.match(text, /github/)
})

test('有数据时渲染：自动监听的上次处理结果', () => {
  const mount = createMount()
  mount.states[1] = snapshotFor([rootRow('/root/workspace')], {
    auto: {
      enabled: true,
      watching: true,
      pollIntervalMs: 5000,
      lastRunAt: Date.now(),
      lastAdded: ['/root/fresh'],
      lastRemoved: [],
      lastChanged: true,
      lastWritten: true,
    },
  })
  mount.states[2] = [{ path: '/root/workspace', mode: 'shared', depth: 1 }]
  mount.states[3] = FILTERS
  mount.states[13] = 'independent'
  mount.states[14] = true
  mount.states[15] = []
  mount.states[16] = ''
  const text = mount.text()
  assert.match(text, /上次自动处理/)
  assert.match(text, /配置已改写/)
})
