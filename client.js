/* eslint-disable */
/**
 * @major.chen/dsh-hindsight-config —— 浏览器半体：「Hindsight 记忆模式」管理面板。
 *
 * 同一份代码注册四个插槽以跨版本兼容（与 @hyzyn/dsh-env 同款策略）：
 *   - DSH ≥0.2.0-rc.1 的 `plugins.bundle.config`（插件详情页「说明」下方内联，仅 view='page'）；
 *   - `plugins.row.config`（`<bundle 包名>#<行 id>`，聚合安装或旧宿主时的入口）；
 *   - `settings.kit.item`（设置 → 插件配置页，由 @hyzyn/dsh-kit-settings 声明）；
 *   - DSH ≤0.1.5 的 `settings.plugin.item`。
 * 纯前端 React 卡片，宿主经 client-modules 按 boot graph 下发；数据走宿主 /api/dsh-hindsight-config/*。
 */
window.__ModuleLoader__.load({
  id: '@major.chen/dsh-hindsight-config',
  factory: (require) => {
    const exports = {}

    const React = require('react')
    const { jsx, jsxs } = require('react/jsx-runtime')

    const BUNDLE = '@major.chen/dsh-hindsight-config'
    const ROW_ID = 'hindsight-config'
    const API = '/api/dsh-hindsight-config'
    const MODES = ['off', 'independent', 'shared']
    /** 「自动」选项的默认值；缺省与旧行为一致（新增根按「独立」）。 */
    const DEFAULT_AUTO_MODE = 'independent'

    /* ================================ CSS ================================ */

    const CSS = [
      '.hzc_pageHost{display:block}',
      '.hzc_card{list-style:none;border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-xl);transition:border-color .16s,background .16s}',
      '.hzc_card:hover{border-color:var(--dsw-alias-label-dimmed)}',
      '.hzc_cardOpen{background:var(--dsw-alias-bg-layer-1);border-color:var(--dsw-alias-label-dimmed)}',
      '.hzc_cardHeader{appearance:none;width:100%;color:inherit;font:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:var(--dsw-radius-xl);display:flex;align-items:center;gap:12px;padding:14px 16px}',
      '.hzc_cardHeader:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}',
      '.hzc_cardHeadText{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}',
      '.hzc_cardName{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}',
      '.hzc_cardDescription{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.hzc_badge{flex:none;margin-left:auto;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600;line-height:16px;letter-spacing:.02em;color:var(--dsw-alias-label-dimmed);background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1)}',
      '.hzc_chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .16s}',
      '.hzc_cardOpen .hzc_chevron{transform:rotate(180deg)}',
      '.hzc_cardBody{padding:2px 16px 16px}',
      '.hzc_panel{display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);box-sizing:border-box}',
      '.hzc_head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.hzc_title{margin:0;font-size:15px;font-weight:500;line-height:22px;flex:1;white-space:nowrap}',
      '.hzc_mono{font-family:var(--ds-font-family-code);font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}',
      '.hzc_toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.hzc_spacer{flex:1}',
      '.hzc_btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:none;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);font-family:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}',
      '.hzc_btn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}',
      '.hzc_btn:disabled{opacity:.4;cursor:not-allowed}',
      '.hzc_btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.hzc_btnGhost{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}',
      '.hzc_btnGhost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.hzc_btnGhost:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}',
      '.hzc_btnGhost:disabled{opacity:.4;cursor:not-allowed}',
      '.hzc_btnGhost:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}',
      '.hzc_btnDanger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}',
      '.hzc_btnDanger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent)}',
      '.hzc_btnDangerSolid{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground)}',
      '.hzc_section{display:flex;flex-direction:column;gap:8px}',
      '.hzc_sectionTitle{margin:0;font-size:13px;font-weight:500;line-height:20px;color:var(--dsw-alias-label-primary)}',
      '.hzc_hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}',
      '.hzc_list{display:flex;flex-direction:column;gap:8px;max-height:520px;overflow-y:auto}',
      '.hzc_row{display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-2);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);padding:10px 12px}',
      '.hzc_rowHead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.hzc_path{font-family:var(--ds-font-family-code);font-size:12.5px;line-height:18px;color:var(--dsw-alias-label-primary);word-break:break-all;flex:1;min-width:180px}',
      '.hzc_rowMeta{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.hzc_modes{display:flex;align-items:center;gap:14px;flex-wrap:wrap}',
      '.hzc_radio{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.hzc_radio input[type=radio]{width:15px;height:15px;margin:0;flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}',
      '.hzc_radio input[type=radio]:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.hzc_check{display:inline-flex;align-items:center;gap:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.hzc_check input[type=checkbox]{width:16px;height:16px;margin:0;flex:none;cursor:pointer;accent-color:var(--dsw-alias-brand-primary)}',
      '.hzc_check input[type=checkbox]:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}',
      '.hzc_input{box-sizing:border-box;width:100%;height:34px;padding:0 12px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);outline:none;font-family:var(--ds-font-family-code);font-size:13px;line-height:1.5}',
      '.hzc_input:focus{border-color:var(--dsw-alias-state-business-primary)}',
      '.hzc_input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.hzc_pre{margin:0;padding:8px 10px;max-height:200px;overflow:auto;background:var(--dsw-alias-bg-layer-3);border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);font-family:var(--ds-font-family-code);font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-all}',
      '.hzc_addRow{display:grid;grid-template-columns:minmax(200px,1fr) auto;gap:8px;align-items:center}',
      '.hzc_error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin:0;white-space:pre-wrap}',
      '.hzc_ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px;margin:0}',
      '.hzc_warn{color:var(--dsw-alias-state-warning-primary,#b7791f);font-size:12px;line-height:18px;margin:0;white-space:pre-wrap}',
      '.hzc_empty{text-align:center;color:var(--dsw-alias-label-tertiary);padding:18px 12px;font-size:12.5px;line-height:18px}',
      '.hzc_loading{color:var(--dsw-alias-label-tertiary);font-size:12.5px;line-height:18px}',
      '.hzc_danger{border:.5px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 6%,transparent);border-radius:var(--dsw-radius-md);padding:10px 12px;display:flex;flex-direction:column;gap:8px}',
    ].join('\n')

    let styleEl
    function ensureStyle() {
      if (document.getElementById('dsh-hindsight-config-style')) return
      styleEl = document.createElement('style')
      styleEl.id = 'dsh-hindsight-config-style'
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
    }

    /* ================================ 国际化 ================================ */

    const I18N_NS = 'hindsight-config'
    const I18N_ZH = {
      'card.name': 'Hindsight 记忆模式',
      'card.desc': '按工作区树管理 ~/.hindsight/coding-agent.json 的记忆路由：关闭 / 独立 / 共享 + 自动；「自动」会跟着 DSH 工作区注册表的变化重写配置，也支持按树勾选添加、重新生成与重载。',
      'panel.title': '记忆模式',
      'panel.file': '配置文件',
      'panel.stateFile': '面板状态',
      'modes.title': '模式说明',
      'roots.title': '受管根目录',
      'roots.empty': '还没有受管根目录，在下面添加一个绝对路径。',
      'roots.subdirs': '{count} 个子目录',
      'roots.bank': 'bank：{bank}',
      'roots.missing': '目录不可访问：{error}',
      'roots.resolveNow': '立即生效',
      'roots.resolveRestart': '需重启才生效',
      'roots.drift': '文件与设置不一致，请重新生成',
      'mode.off': '关闭',
      'mode.independent': '独立',
      'mode.shared': '共享',
      'mode.off.hint': '该目录不产生记忆（写 paths.<根>.disabled）。',
      'mode.independent.hint': '根目录及其每个直接子目录各自一个记忆空间。',
      'mode.shared.hint': '整棵子树收敛到根目录的一个记忆空间。',
      'filters.title': '目录筛选',
      'filter.skipHidden': '跳过隐藏目录（. 开头）',
      'filter.skipNodeModules': '跳过 node_modules',
      'filter.skipEmpty': '跳过空目录',
      'filter.includeSymlinks': '跟随符号链接',
      'add.title': '添加根目录',
      'add.placeholder': '/root/workspace',
      'auto.title': '自动',
      'auto.apply': '工作区或受管根目录变动后立即写入配置',
      'auto.mode': '新增根目录的默认模式',
      'auto.hint': '关掉上面这项时，工作区或受管根的增删只改面板，仍需点「重新生成」才落盘。',
      'auto.watching': '宿主每 {seconds} 秒检查一次 DSH 工作区注册表：新增/删除工作区后自动重写配置（写前备份）。',
      'auto.last': '宿主每 {seconds} 秒检查一次工作区注册表。上次自动处理：{time}，新增 {added} 个根，{changed}。',
      'auto.changedYes': '配置已改写',
      'auto.changedNo': '配置无变化',
      'auto.off': '「自动」已关闭：工作区变化不会写盘，需手点「重新生成」。',
      'auto.noRegistry': '宿主还没有工作区注册表，暂时无法监听工作区变化。',
      'pick.bank': 'bank：{bank}',
      'pick.bases': '候选起点：',
      'pick.fill': '点候选起点会把路径填进上面的输入框，再点「添加」；新根使用「自动」里设定的默认模式。',
      'pick.needRestart': '候选起点需要重启 DSH 加载宿主新版本后才会出现。',
      'pick.managed': '已在列表中',
      'msg.added': '已添加 {count} 个根目录并写入配置',
      'msg.removed': '已移除该根目录并写入配置',
      'msg.pending': '改动只在面板里，记得点「重新生成」写入配置',
      'file.title': '文件当前内容',
      'file.maps': 'mapPathToBank（{count} 条）',
      'file.paths': 'paths（{count} 条）',
      'btn.save': '保存设置',
      'btn.saving': '保存中…',
      'btn.generate': '重新生成',
      'btn.generating': '生成中…',
      'btn.generateOne': '重新生成此根',
      'btn.reload': '重载',
      'btn.reloading': '重载中…',
      'btn.add': '添加',
      'btn.remove': '移除',
      'btn.cancel': '取消',
      'btn.restart': '应用并重启 DSH Web 服务',
      'btn.restartConfirm': '确认重启（会打断当前回复）',
      'restart.title': '应用变更',
      'restart.desc': 'Hindsight 把「工作目录 → 记忆空间」缓存在 DSH 进程内，且没有进程内失效入口：已解析过的目录必须重启 DSH 宿主才会换到新的记忆空间（未解析过的目录立即生效）。',
      'restart.unit': '托管单元：{unit}',
      'restart.note': '重启由 systemd 拉起，页面会在数秒后自动重连。',
      'effect.title': '生效范围（重载结果）',
      'effect.live': '立即生效',
      'effect.restart': '需重启才生效',
      'effect.others': '本进程已解析的其它目录：{list}',
      'effect.caveat': '「已解析」清单来自本插件的记账：插件挂载前就已存在的会话可能漏记。不确定时，重启一次即可确保全量生效。',
      'msg.saved': '设置已保存',
      'msg.generated': '已重新生成并写入配置文件（写入前已备份）',
      'msg.unchanged': '已是最新，无需写入',
      'msg.reloaded': '已重读配置文件',
      'msg.restarting': '重启已排队，页面稍后自动重连',
      'diff.title': '本次改动',
      'diff.added': '+{count}',
      'diff.removed': '-{count}',
      'diff.changed': '~{count}',
      'backup.title': '备份：{path}',
      'warn.title': '提示',
      'status.ready': '就绪',
      'status.missing': '文件不存在（首次生成会创建）',
      'status.broken': '配置文件无法解析',
      'status.derived': '面板状态由配置派生',
      'loading': '加载中…',
      'error.load': '加载失败',
    }
    const I18N_EN = {
      'card.name': 'Hindsight memory mode',
      'card.desc': 'Manage the memory routing in ~/.hindsight/coding-agent.json from the workspace tree: off / independent / shared + automatic; the automatic option rewrites the config whenever the DSH workspace registry changes, with tree picking, regenerate and reload.',
      'panel.title': 'Memory mode',
      'panel.file': 'Config file',
      'panel.stateFile': 'Panel state',
      'modes.title': 'Modes',
      'roots.title': 'Managed roots',
      'roots.empty': 'No managed root yet — add an absolute path below.',
      'roots.subdirs': '{count} subdirectories',
      'roots.bank': 'bank: {bank}',
      'roots.missing': 'Directory unavailable: {error}',
      'roots.resolveNow': 'live',
      'roots.resolveRestart': 'needs restart',
      'roots.drift': 'File and settings differ — regenerate',
      'mode.off': 'Off',
      'mode.independent': 'Independent',
      'mode.shared': 'Shared',
      'mode.off.hint': 'No memory for this directory (writes paths.<root>.disabled).',
      'mode.independent.hint': 'The root and each direct subdirectory get their own memory space.',
      'mode.shared.hint': 'The whole subtree collapses into one memory space for the root.',
      'filters.title': 'Directory filters',
      'filter.skipHidden': 'Skip hidden directories (dot-prefixed)',
      'filter.skipNodeModules': 'Skip node_modules',
      'filter.skipEmpty': 'Skip empty directories',
      'filter.includeSymlinks': 'Follow symlinks',
      'add.title': 'Add a root',
      'add.placeholder': '/root/workspace',
      'auto.title': 'Automatic',
      'auto.apply': 'Write the config as soon as a workspace or managed root changes',
      'auto.mode': 'Default mode for newly added roots',
      'auto.hint': 'With the switch above off, workspace or managed-root changes only touch the panel — click Regenerate to write the file.',
      'auto.watching': 'The host checks the DSH workspace registry every {seconds}s and rewrites the config (backed up first) when a workspace is added or removed.',
      'auto.last': 'The host checks the workspace registry every {seconds}s. Last automatic run: {time}, {added} root(s) added, {changed}.',
      'auto.changedYes': 'config rewritten',
      'auto.changedNo': 'config unchanged',
      'auto.off': 'Automatic is off: workspace changes are not written — click Regenerate.',
      'auto.noRegistry': 'The host has no workspace registry yet, so workspace changes cannot be watched.',
      'pick.bank': 'bank: {bank}',
      'pick.bases': 'Candidate roots: ',
      'pick.fill': 'Clicking a candidate fills the path into the input above; then press Add. New roots use the default mode set under Automatic.',
      'pick.needRestart': 'Candidate roots appear after a DSH restart loads the new host revision.',
      'pick.managed': 'already managed',
      'msg.added': 'Added {count} root(s) and wrote the config',
      'msg.removed': 'Removed the root and wrote the config',
      'msg.pending': 'Panel only — click Regenerate to write the config file',
      'file.title': 'Current file content',
      'file.maps': 'mapPathToBank ({count} entries)',
      'file.paths': 'paths ({count} entries)',
      'btn.save': 'Save settings',
      'btn.saving': 'Saving…',
      'btn.generate': 'Regenerate',
      'btn.generating': 'Generating…',
      'btn.generateOne': 'Regenerate this root',
      'btn.reload': 'Reload',
      'btn.reloading': 'Reloading…',
      'btn.add': 'Add',
      'btn.remove': 'Remove',
      'btn.cancel': 'Cancel',
      'btn.restart': 'Apply and restart the DSH web service',
      'btn.restartConfirm': 'Confirm restart (interrupts the running reply)',
      'restart.title': 'Apply changes',
      'restart.desc': 'Hindsight caches "working directory → memory space" inside the DSH process and has no in-process invalidation: a directory this process already resolved keeps its old memory space until the DSH host restarts (never-resolved directories pick the file up immediately).',
      'restart.unit': 'Supervised by unit: {unit}',
      'restart.note': 'systemd brings it back; this page reconnects within seconds.',
      'effect.title': 'Effective scope (reload result)',
      'effect.live': 'live',
      'effect.restart': 'needs restart',
      'effect.others': 'Other directories this process resolved: {list}',
      'effect.caveat': '"Resolved" comes from this plugin\'s own bookkeeping: a session that already existed when the plugin mounted can be missing from it. When in doubt, one restart guarantees the whole host picks the file up.',
      'msg.saved': 'Settings saved',
      'msg.generated': 'Regenerated and written to the config file (backed up first)',
      'msg.unchanged': 'Already up to date — nothing written',
      'msg.reloaded': 'Config file re-read',
      'msg.restarting': 'Restart queued; this page reconnects shortly',
      'diff.title': 'Changes',
      'diff.added': '+{count}',
      'diff.removed': '-{count}',
      'diff.changed': '~{count}',
      'backup.title': 'Backup: {path}',
      'warn.title': 'Notes',
      'status.ready': 'Ready',
      'status.missing': 'No file yet (the first generate creates it)',
      'status.broken': 'Config file cannot be parsed',
      'status.derived': 'Panel state derived from the config',
      'loading': 'Loading…',
      'error.load': 'Failed to load',
    }

    function i18nFormat(text, params) {
      if (params === undefined) return text
      return String(text).replace(/\{(\w+)\}/g, (_match, name) => (params[name] === undefined ? '' : String(params[name])))
    }
    function i18nFallback(key, params) {
      return i18nFormat(I18N_ZH[key] !== undefined ? I18N_ZH[key] : key, params)
    }
    let t = i18nFallback

    function installI18n(ctx) {
      ctx.inject(['locale'], (i18nCtx) => {
        const disposeZh = i18nCtx.locale.register(I18N_NS, 'zh', I18N_ZH)
        const disposeEn = i18nCtx.locale.register(I18N_NS, 'en', I18N_EN)
        t = i18nCtx.locale.bind(I18N_NS)
        return () => {
          disposeEn()
          disposeZh()
          t = i18nFallback
        }
      })
    }

    /* ================================ API ================================ */

    async function api(path, options) {
      const response = await fetch(path, options)
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      return data
    }

    const post = (path, body) =>
      api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

    const modeLabel = (mode) =>
      mode === 'off' || mode === 'independent' || mode === 'shared' ? t(`mode.${mode}`) : mode

    function diffSummary(diff) {
      const out = { added: 0, removed: 0, changed: 0, lines: [] }
      if (diff === undefined || diff === null) return out
      for (const key of ['mapPathToBank', 'paths']) {
        const part = diff[key]
        if (part === undefined) continue
        out.added += part.added.length
        out.removed += part.removed.length
        out.changed += part.changed.length
        for (const item of part.added) out.lines.push(`+ ${item.key} = ${JSON.stringify(item.value)}`)
        for (const item of part.removed) out.lines.push(`- ${item.key}`)
        for (const item of part.changed) out.lines.push(`~ ${item.key}: ${JSON.stringify(item.from)} → ${JSON.stringify(item.to)}`)
      }
      return out
    }

    /* ================================ 面板 ================================ */

    const CHEVRON_PATH =
      'M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 9.13382 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z'

    function HindsightConfigCard(props) {
      const view = props && props.view
      const pageView = view === 'page'
      const [open, setOpen] = React.useState(pageView)
      const [snapshot, setSnapshot] = React.useState(null)
      const [roots, setRoots] = React.useState([])
      const [filters, setFilters] = React.useState(null)
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [ok, setOk] = React.useState('')
      const [warnings, setWarnings] = React.useState([])
      const [backup, setBackup] = React.useState('')
      const [diff, setDiff] = React.useState(null)
      const [effect, setEffect] = React.useState(null)
      const [draftRoot, setDraftRoot] = React.useState('')
      const [armed, setArmed] = React.useState(false)
      // 新增 hook 一律追加在最后：test/client.test.mjs 按 useState 的调用顺序喂值。
      const [autoMode, setAutoMode] = React.useState(DEFAULT_AUTO_MODE)
      const [autoApply, setAutoApply] = React.useState(true)
      const [candidates, setCandidates] = React.useState([])
      const [candidatesNote, setCandidatesNote] = React.useState('')

      /** 候选起点：宿主按工作区注册表算出的「顶层工作区 − 已受管根」。 */
      const refreshCandidates = React.useCallback(async () => {
        try {
          const data = await api(`${API}/candidates`)
          setCandidates(Array.isArray(data.candidates) ? data.candidates : [])
          setCandidatesNote('')
        } catch {
          // 宿主还是旧版本（没有这条路由）时不报错，只提示要重启。
          setCandidates([])
          setCandidatesNote(t('pick.needRestart'))
        }
      }, [])

      const adopt = React.useCallback((data) => {
        setSnapshot(data)
        setRoots(
          (Array.isArray(data.roots) ? data.roots : []).map((row) => ({
            path: row.path,
            mode: row.mode,
            depth: row.depth,
            resolvedInProcess: row.resolvedInProcess,
          })),
        )
        setFilters(data.filters ?? null)
        setAutoMode(MODES.includes(data.autoMode) ? data.autoMode : DEFAULT_AUTO_MODE)
        setAutoApply(data.autoApply !== false)
      }, [])

      const load = React.useCallback(async () => {
        setBusy('load')
        setError('')
        try {
          adopt(await api(`${API}/state`))
          void refreshCandidates()
        } catch (err) {
          setError(`${t('error.load')}：${err.message}`)
        } finally {
          setBusy('')
        }
      }, [adopt, refreshCandidates])

      React.useEffect(() => {
        if (open) load()
      }, [open, load])

      const clearMessages = () => {
        setError('')
        setOk('')
        setWarnings([])
        setBackup('')
        setDiff(null)
      }

      const normalizeRoots = (list) =>
        (list ?? []).map((row) => ({ path: row.path, mode: row.mode, depth: row.depth ?? 1 }))
      const dirty =
        snapshot !== null &&
        (JSON.stringify(normalizeRoots(roots)) !== JSON.stringify(normalizeRoots(snapshot.roots)) ||
          JSON.stringify(filters ?? {}) !== JSON.stringify(snapshot.filters ?? {}) ||
          autoMode !== (snapshot.autoMode ?? DEFAULT_AUTO_MODE) ||
          autoApply !== (snapshot.autoApply !== false))

      const setMode = (path, mode) => {
        setRoots((current) => current.map((row) => (row.path === path ? { ...row, mode } : row)))
      }
      const removeRoot = (path) => {
        const list = roots.filter((row) => row.path !== path)
        setRoots(list)
        setSnapshot((current) =>
          current === null ? current : { ...current, roots: (current.roots ?? []).filter((row) => row.path !== path) },
        )
        if (autoApply) void generate(undefined, list, t('msg.removed'))
        else {
          clearMessages()
          setOk(t('msg.pending'))
        }
        void refreshCandidates()
      }
      const setFilter = (key, value) => {
        setFilters((current) => ({ ...(current ?? {}), [key]: value }))
      }

      const save = async () => {
        setBusy('save')
        clearMessages()
        try {
          await post(`${API}/roots`, { roots, filters, autoMode, autoApply })
          setOk(t('msg.saved'))
          await load()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const generate = async (rootPath, overrideRoots, okMessage) => {
        // overrideRoots 供「变动即写配置」用：那一刻 setRoots 还没提交，闭包里的 roots 是旧值。
        const list = Array.isArray(overrideRoots) ? overrideRoots : roots
        setBusy('generate')
        clearMessages()
        try {
          // 先把面板上的模式/筛选落成状态，再生成：否则「选完模式直接点重新生成」会拿旧状态生成。
          await post(`${API}/roots`, { roots: list, filters, autoMode, autoApply })
          const data = await post(`${API}/generate`, rootPath === undefined ? {} : { rootPath })
          setDiff(data.diff ?? null)
          setWarnings(Array.isArray(data.warnings) ? data.warnings : [])
          setBackup(typeof data.backup === 'string' ? data.backup : '')
          setOk(typeof okMessage === 'string' ? okMessage : data.changed ? t('msg.generated') : t('msg.unchanged'))
          await load()
        } catch (err) {
          setError(err.message)
          // 自动写入失败时把面板拉回宿主里的真实状态，避免留下一个没落盘的幻影根。
          await load()
        } finally {
          setBusy('')
        }
      }

      const reload = async () => {
        setBusy('reload')
        clearMessages()
        try {
          const data = await post(`${API}/reload`, {})
          setEffect(data)
          setOk(t('msg.reloaded'))
          await load()
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      const restart = async () => {
        if (!armed) {
          setArmed(true)
          return
        }
        setBusy('restart')
        clearMessages()
        setArmed(false)
        try {
          const data = await post(`${API}/restart`, { confirm: true })
          setOk(`${t('msg.restarting')}${typeof data.command === 'string' ? `（${data.command}）` : ''}`)
        } catch (err) {
          setError(err.message)
        } finally {
          setBusy('')
        }
      }

      /**
       * 把一批目录加为受管根：模式取「自动」选项里的默认模式；开启「立即写入」时
       * 顺手把配置落盘（POST /roots + /generate），否则只改面板。entries: [{ path, subdirs? }]
       * @returns {number} 实际新增的个数
       */
      const addRoots = (entries) => {
        const fresh = (Array.isArray(entries) ? entries : []).filter(
          (entry) =>
            typeof entry?.path === 'string' && entry.path !== '' && !roots.some((row) => row.path === entry.path),
        )
        if (fresh.length === 0) return 0
        const list = [...roots, ...fresh.map((entry) => ({ path: entry.path, mode: autoMode, depth: 1 }))]
        setRoots(list)
        setSnapshot((current) =>
          current === null
            ? current
            : {
                ...current,
                roots: [
                  ...(current.roots ?? []),
                  ...fresh.map((entry) => ({
                    path: entry.path,
                    mode: autoMode,
                    depth: 1,
                    exists: true,
                    subdirs: entry.subdirs ?? [],
                  })),
                ],
              },
        )
        if (autoApply) void generate(undefined, list, t('msg.added', { count: fresh.length }))
        else {
          clearMessages()
          setOk(t('msg.pending'))
        }
        void refreshCandidates()
        return fresh.length
      }

      /** 手输绝对路径添加（原有入口，模式改用「自动」的默认模式）。 */
      const addRoot = async () => {
        const path = draftRoot.trim()
        if (path === '') return
        clearMessages()
        try {
          const probe = await api(`${API}/tree?path=${encodeURIComponent(path)}`)
          if (probe.error !== undefined) {
            setError(probe.error)
            return
          }
          if (roots.some((row) => row.path === probe.path)) {
            setError(t('pick.managed'))
            return
          }
          setDraftRoot('')
          addRoots([{ path: probe.path, subdirs: probe.subdirs ?? [] }])
        } catch (err) {
          setError(err.message)
        }
      }

      /** 已受管的不再作为候选显示（本地受管列表优先，未保存的增删也立即生效）。 */
      const visibleCandidates = candidates.filter((candidate) => !roots.some((row) => row.path === candidate.path))

      /** 「自动」监听状态文案：优先显示上次自动处理的结果。 */
      const autoStateText = () => {
        const info = snapshot?.auto
        if (info === undefined) return ''
        if (info.enabled !== true) return t('auto.off')
        if (info.watching !== true) return t('auto.noRegistry')
        const seconds = Math.max(1, Math.round(Number(info.pollIntervalMs ?? 5000) / 1000))
        if (info.lastRunAt) {
          return t('auto.last', {
            seconds,
            time: new Date(info.lastRunAt).toLocaleTimeString(),
            added: (Array.isArray(info.lastAdded) ? info.lastAdded : []).length,
            changed: info.lastChanged === true ? t('auto.changedYes') : t('auto.changedNo'),
          })
        }
        return t('auto.watching', { seconds })
      }

      if (view === 'summary') return t('card.desc')

      const file = snapshot?.configFile ?? ''
      const configError = snapshot?.configError
      const status = configError !== undefined ? t('status.broken') : snapshot?.configExists === false ? t('status.missing') : t('status.ready')
      const summary = diffSummary(diff)
      const maps = Object.entries(snapshot?.config?.mapPathToBank ?? {})
      const pathSections = Object.entries(snapshot?.config?.paths ?? {})

      const rootRows = roots.map((row) => {
        const known = (snapshot?.roots ?? []).find((entry) => entry.path === row.path)
        return jsxs('div', {
          className: 'hzc_row',
          children: [
            jsxs('div', {
              className: 'hzc_rowHead',
              children: [
                jsx('span', { className: 'hzc_path', children: row.path }),
                known?.exists === false
                  ? jsx('span', { className: 'hzc_rowMeta', children: t('roots.missing', { error: known.error ?? '' }) })
                  : jsx('span', {
                      className: 'hzc_rowMeta',
                      children: `${t('roots.subdirs', { count: (known?.subdirs ?? []).length })}${known?.projectName ? ` · ${t('roots.bank', { bank: known.projectName })}` : ''}`,
                    }),
                known?.drift === true ? jsx('span', { className: 'hzc_rowMeta', children: t('roots.drift') }) : null,
                known === undefined
                  ? null
                  : jsx('span', {
                      className: 'hzc_rowMeta',
                      children: known.resolvedInProcess ? t('roots.resolveRestart') : t('roots.resolveNow'),
                    }),
                jsx('div', { className: 'hzc_spacer' }),
                jsx('button', {
                  type: 'button',
                  className: 'hzc_btnGhost',
                  disabled: busy !== '',
                  onClick: () => generate(row.path),
                  children: t('btn.generateOne'),
                }),
                jsx('button', {
                  type: 'button',
                  className: 'hzc_btnGhost',
                  onClick: () => removeRoot(row.path),
                  children: t('btn.remove'),
                }),
              ],
            }),
            jsxs('div', {
              className: 'hzc_modes',
              children: MODES.map((mode) =>
                jsxs(
                  'label',
                  {
                    className: 'hzc_radio',
                    title: t(`mode.${mode}.hint`),
                    children: [
                      jsx('input', {
                        type: 'radio',
                        name: `hzc-mode-${row.path}`,
                        checked: row.mode === mode,
                        onChange: () => setMode(row.path, mode),
                      }),
                      modeLabel(mode),
                    ],
                  },
                  `mode-${row.path}-${mode}`,
                ),
              ),
            }),
          ],
        }, `root-${row.path}`)
      })

      return jsxs(pageView ? 'div' : 'li', {
        className: pageView ? 'hzc_pageHost' : open ? 'hzc_card hzc_cardOpen' : 'hzc_card',
        children: [
          pageView
            ? null
            : jsxs('button', {
                type: 'button',
                className: 'hzc_cardHeader',
                'aria-expanded': open,
                onClick: () => setOpen((current) => !current),
                children: [
                  jsxs('span', {
                    className: 'hzc_cardHeadText',
                    children: [
                      jsx('span', { className: 'hzc_cardName', children: t('card.name') }),
                      jsx('span', { className: 'hzc_cardDescription', children: t('card.desc') }),
                    ],
                  }),
                  jsx('span', { className: 'hzc_badge', children: 'Local' }),
                  jsx('svg', {
                    width: '14',
                    height: '14',
                    viewBox: '0 0 14 14',
                    fill: 'none',
                    xmlns: 'http://www.w3.org/2000/svg',
                    className: 'hzc_chevron',
                    children: jsx('path', { d: CHEVRON_PATH, fill: 'currentColor' }),
                  }),
                ],
              }),
          pageView || open
            ? jsx('div', {
                className: 'hzc_cardBody',
                children: jsxs('div', {
                  className: 'hzc_panel',
                  children: [
                    jsxs('div', {
                      className: 'hzc_head',
                      children: [
                        jsx('h3', { className: 'hzc_title', children: t('panel.title') }),
                        jsx('span', { className: 'hzc_badge', children: status }),
                        jsxs('div', {
                          className: 'hzc_toolbar',
                          children: [
                            jsx('button', {
                              type: 'button',
                              className: 'hzc_btnGhost',
                              disabled: busy !== '' || !dirty,
                              onClick: save,
                              children: busy === 'save' ? t('btn.saving') : t('btn.save'),
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'hzc_btn',
                              disabled: busy !== '',
                              onClick: () => generate(),
                              children: busy === 'generate' ? t('btn.generating') : t('btn.generate'),
                            }),
                            jsx('button', {
                              type: 'button',
                              className: 'hzc_btnGhost',
                              disabled: busy !== '',
                              onClick: reload,
                              children: busy === 'reload' ? t('btn.reloading') : t('btn.reload'),
                            }),
                          ],
                        }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_toolbar',
                      children: [
                        jsx('span', { className: 'hzc_mono', children: `${t('panel.file')}：${file}` }),
                        jsx('span', { className: 'hzc_mono', children: `${t('panel.stateFile')}：${snapshot?.stateFile ?? ''}` }),
                      ],
                    }),
                    snapshot?.stateDerived === true ? jsx('p', { className: 'hzc_hint', children: t('status.derived') }) : null,
                    configError !== undefined ? jsx('p', { className: 'hzc_error', children: `${t('status.broken')}：${configError}` }) : null,
                    busy === 'load' && snapshot === null ? jsx('div', { className: 'hzc_loading', children: t('loading') }) : null,
                    error ? jsx('p', { className: 'hzc_error', children: error }) : null,
                    ok ? jsx('p', { className: 'hzc_ok', children: ok }) : null,
                    warnings.length > 0
                      ? jsxs('div', {
                          className: 'hzc_section',
                          children: [
                            jsx('h4', { className: 'hzc_sectionTitle', children: t('warn.title') }),
                            jsx('p', { className: 'hzc_warn', children: warnings.join('\n') }),
                          ],
                        })
                      : null,
                    diff !== null && (summary.added > 0 || summary.removed > 0 || summary.changed > 0)
                      ? jsxs('div', {
                          className: 'hzc_section',
                          children: [
                            jsx('h4', {
                              className: 'hzc_sectionTitle',
                              children: `${t('diff.title')}　${t('diff.added', { count: summary.added })} ${t('diff.removed', { count: summary.removed })} ${t('diff.changed', { count: summary.changed })}`,
                            }),
                            jsx('pre', { className: 'hzc_pre', children: summary.lines.slice(0, 40).join('\n') }),
                          ],
                        })
                      : null,
                    backup !== ''
                      ? jsx('p', { className: 'hzc_hint', children: t('backup.title', { path: backup }) })
                      : null,
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('modes.title') }),
                        ...MODES.map((mode) =>
                          jsx(
                            'p',
                            { className: 'hzc_hint', children: `${modeLabel(mode)}：${t(`mode.${mode}.hint`)}` },
                            `legend-${mode}`,
                          ),
                        ),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('roots.title') }),
                        roots.length === 0 ? jsx('div', { className: 'hzc_empty', children: t('roots.empty') }) : jsxs('div', { className: 'hzc_list', children: rootRows }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('add.title') }),
                        visibleCandidates.length > 0 || candidatesNote !== ''
                          ? jsxs('div', {
                              className: 'hzc_toolbar',
                              children: [
                                jsx('span', { className: 'hzc_hint', children: t('pick.bases') }),
                                ...visibleCandidates.map((candidate) =>
                                  jsx(
                                    'button',
                                    {
                                      type: 'button',
                                      className: 'hzc_btnGhost',
                                      title: candidate.path,
                                      onClick: () => setDraftRoot(candidate.path),
                                      children: candidate.title ?? candidate.path,
                                    },
                                    `candidate-${candidate.path}`,
                                  ),
                                ),
                                candidatesNote !== '' ? jsx('span', { className: 'hzc_hint', children: candidatesNote }) : null,
                              ],
                            })
                          : null,
                        jsxs('div', {
                          className: 'hzc_addRow',
                          children: [
                            jsx('input', {
                              className: 'hzc_input',
                              placeholder: t('add.placeholder'),
                              value: draftRoot,
                              onChange: (event) => setDraftRoot(event.target.value),
                            }),
                            jsx('button', { type: 'button', className: 'hzc_btnGhost', onClick: addRoot, children: t('btn.add') }),
                          ],
                        }),
                        jsx('p', { className: 'hzc_hint', children: t('pick.fill') }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('auto.title') }),
                        jsxs('div', {
                          className: 'hzc_modes',
                          children: [
                            jsxs(
                              'label',
                              {
                                className: 'hzc_check',
                                children: [
                                  jsx('input', {
                                    type: 'checkbox',
                                    checked: autoApply,
                                    onChange: (event) => setAutoApply(event.target.checked),
                                  }),
                                  t('auto.apply'),
                                ],
                              },
                              'auto-apply',
                            ),
                            jsx('span', { className: 'hzc_hint', children: t('auto.mode') }),
                            ...MODES.map((mode) =>
                              jsxs(
                                'label',
                                {
                                  className: 'hzc_radio',
                                  title: t(`mode.${mode}.hint`),
                                  children: [
                                    jsx('input', {
                                      type: 'radio',
                                      name: 'hzc-auto-mode',
                                      checked: autoMode === mode,
                                      onChange: () => setAutoMode(mode),
                                    }),
                                    modeLabel(mode),
                                  ],
                                },
                                `auto-${mode}`,
                              ),
                            ),
                          ],
                        }),
                        jsx('p', { className: 'hzc_hint', children: t('auto.hint') }),
                        autoStateText() === '' ? null : jsx('p', { className: 'hzc_hint', children: autoStateText() }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('filters.title') }),
                        jsxs('div', {
                          className: 'hzc_modes',
                          children: [
                            ['skipHidden', 'filter.skipHidden'],
                            ['skipNodeModules', 'filter.skipNodeModules'],
                            ['skipEmpty', 'filter.skipEmpty'],
                            ['includeSymlinks', 'filter.includeSymlinks'],
                          ].map(([key, label]) =>
                            jsxs(
                              'label',
                              {
                                className: 'hzc_check',
                                children: [
                                  jsx('input', {
                                    type: 'checkbox',
                                    checked: filters?.[key] === true,
                                    onChange: (event) => setFilter(key, event.target.checked),
                                  }),
                                  t(label),
                                ],
                              },
                              `filter-${key}`,
                            ),
                          ),
                        }),
                      ],
                    }),
                    effect !== null
                      ? jsxs('div', {
                          className: 'hzc_section',
                          children: [
                            jsx('h4', { className: 'hzc_sectionTitle', children: t('effect.title') }),
                            jsx('pre', {
                              className: 'hzc_pre',
                              children: [
                                ...(effect.roots ?? []).map(
                                  (row) => `${row.path}\n  ${modeLabel(row.mode)} · ${row.effective === 'live' ? t('effect.live') : t('effect.restart')}${row.drift ? ` · ${t('roots.drift')}` : ''}`,
                                ),
                                effect.note ?? '',
                              ].join('\n'),
                            }),
                          ],
                        })
                      : null,
                    (snapshot?.resolvedElsewhere ?? []).length > 0
                      ? jsx('p', {
                          className: 'hzc_hint',
                          children: t('effect.others', { list: snapshot.resolvedElsewhere.map((row) => row.path).join('、') }),
                        })
                      : null,
                    jsx('p', { className: 'hzc_hint', children: t('effect.caveat') }),
                    jsxs('div', {
                      className: 'hzc_danger',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('restart.title') }),
                        jsx('p', { className: 'hzc_hint', children: t('restart.desc') }),
                        jsx('p', { className: 'hzc_hint', children: t('restart.unit', { unit: snapshot?.detectedUnit ?? snapshot?.restartUnit ?? '' }) }),
                        jsx('p', { className: 'hzc_hint', children: t('restart.note') }),
                        jsxs('div', {
                          className: 'hzc_toolbar',
                          children: [
                            jsx('button', {
                              type: 'button',
                              className: armed ? 'hzc_btn hzc_btnDangerSolid' : 'hzc_btnGhost hzc_btnDanger',
                              disabled: busy !== '',
                              onClick: restart,
                              children: armed ? t('btn.restartConfirm') : t('btn.restart'),
                            }),
                            armed
                              ? jsx('button', {
                                  type: 'button',
                                  className: 'hzc_btnGhost',
                                  onClick: () => setArmed(false),
                                  children: t('btn.cancel'),
                                })
                              : null,
                          ],
                        }),
                      ],
                    }),
                    jsxs('div', {
                      className: 'hzc_section',
                      children: [
                        jsx('h4', { className: 'hzc_sectionTitle', children: t('file.title') }),
                        jsx('p', { className: 'hzc_hint', children: t('file.maps', { count: maps.length }) }),
                        jsx('pre', {
                          className: 'hzc_pre',
                          children: maps.length === 0 ? '—' : maps.map(([key, bank]) => `${key} = ${bank}`).join('\n'),
                        }),
                        pathSections.length > 0
                          ? jsxs('div', {
                              children: [
                                jsx('p', { className: 'hzc_hint', children: t('file.paths', { count: pathSections.length }) }),
                                jsx('pre', {
                                  className: 'hzc_pre',
                                  children: pathSections.map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join('\n'),
                                }),
                              ],
                            })
                          : null,
                      ],
                    }),
                  ],
                }),
              })
            : null,
        ],
      })
    }

    /* ================================ 插件入口 ================================ */

    exports.inject = ['slots']

    /**
     * 行配置 key 的两半：`<bundle 包名>#<行 id>`。聚合安装（@hyzyn/dsh-all 之类的合集）
     * 只注册自己的 bundle 名，未命中的注册只是躺在 ledger 里，不会渲染。
     */
    const ROW_CONFIG_KEYS = [`${BUNDLE}#${ROW_ID}`]

    exports.apply = (ctx) => {
      installI18n(ctx)
      ctx.effect(() => {
        ensureStyle()
        return () => {
          styleEl?.remove()
          styleEl = undefined
        }
      })
      /*
       * `plugins.bundle.config` 是共享命名空间（同 key 只能有一个注册者），key 是 bundle 包名；
       * 内联位可用时不重复注册本包自己的 row 槽（一份表单两个入口会让人以为有两套设置）。
       */
      let bundleConfigLive = false
      const disposeOwnRowConfigs = []
      ctx.slots.inject('plugins.bundle.config', () => {
        bundleConfigLive = true
        while (disposeOwnRowConfigs.length > 0) {
          const disposeRow = disposeOwnRowConfigs.pop()
          if (typeof disposeRow === 'function') disposeRow()
        }
        return ctx.slots.register({ name: 'plugins.bundle.config', key: BUNDLE }, HindsightConfigCard)
      })
      for (const key of ROW_CONFIG_KEYS) {
        ctx.slots.inject('plugins.row.config', () => {
          if (bundleConfigLive) return undefined
          const disposeRow = ctx.slots.register({ name: 'plugins.row.config', key }, HindsightConfigCard)
          disposeOwnRowConfigs.push(disposeRow)
          return disposeRow
        })
      }
      ctx.slots.inject('settings.kit.item', () =>
        ctx.slots.register(
          { name: 'settings.kit.item', id: ROW_ID, order: 12, label: () => t('card.name') },
          HindsightConfigCard,
        ),
      )
      ctx.slots.inject('settings.plugin.item', () =>
        ctx.slots.register({ name: 'settings.plugin.item', key: ROW_ID, order: 96 }, HindsightConfigCard),
      )
    }

    return exports
  },
})
