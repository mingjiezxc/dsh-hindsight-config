# @major.chen/dsh-hindsight-config

DSH Web GUI 的 **Hindsight 记忆模式管理面板**：按工作区树生成并管理
`~/.hindsight/coding-agent.json` 的 bank 路由（`mapPathToBank` / `paths`），
提供三种模式 + 「自动」选项、按工作区树勾选批量添加目录、跟随 DSH 工作区注册表自动重写，以及重新生成与重载。

- 面板入口：**设置 → 插件 → Hindsight 记忆模式**（bundle 详情页内联）；
  同时注册 `plugins.row.config`（旧宿主/聚合安装回退）、`settings.kit.item`
  （设置 → 插件配置）、`settings.plugin.item`（DSH ≤0.1.5）。
- 宿主数据口：`/api/dsh-hindsight-config/*`（回环 + 同源围栏）。
- 只读工具：`hindsight_memory_mode`（写配置与重启**不**开放给 agent）。

## 三种模式

| 模式 | 写出的配置 | 含义 |
| --- | --- | --- |
| 关闭 | `paths["<根>"] = { disabled: true }`，并删掉该根及子树的 `mapPathToBank` 条目 | 该目录不产生记忆 |
| 独立 | `mapPathToBank["<根>"]` + 每个**直接子目录**一条 `mapPathToBank["<根>/<子目录>"]` | 根目录与每个直接子目录各自一个记忆空间 |
| 共享 | 只写 `mapPathToBank["<根>"]`，删掉该根**严格子树**的条目 | 整棵子树收敛到根目录的一个记忆空间 |

bank 名 = `bankIdTemplate`（默认 `coding-agent::{gitProject}`）替换后的值；
`{gitProject}` 取 `git rev-parse --git-common-dir` 的父目录名（linked worktree 收敛到主仓库），
非仓库目录取目录名。目录筛选：隐藏目录、`node_modules` 默认跳过；空目录与符号链接默认包含/不跟随。

**所有权契约**：受管根目录拥有 `mapPathToBank` 中等于它或以 `<根>/` 开头的所有键——
重新生成会先清空再按模式写回。受管前缀之外的键（例如 `/root/watsons-ai`）与
配置文件的其它字段（`serverMode`、`apiUrl`、`retainTags`、未受管 `paths` 节…）逐字保留。

## 「自动」选项与按工作区树添加

面板状态文件（`coding-agent.dsh.json`）多两个字段，与受管根一起保存：

| 字段 | 面板上的控件 | 缺省 | 含义 |
| --- | --- | --- | --- |
| `autoApply` | 「工作区或受管根目录变动后立即写入配置」 | **开** | ① 加/减受管根目录时自动「保存状态 → 重新生成」；② 宿主轮询 DSH 工作区注册表，任何工作区**新增/删除**都会自动重写配置（写前照常备份）。关掉后这些变化只改面板，仍需手点「重新生成」 |
| `autoMode` | 「新增根目录的默认模式」 | `independent` | 面板或自动监听新加的根套用哪个模式（关闭 / 独立 / 共享） |

### 自动监听的语义

宿主每 `HINDSIGHT_CONFIG_AUTO_POLL_MS`（默认 `5000` 毫秒）读一次
`ctx.workspaceRegistry.list()`（内存投影，无磁盘 IO），比较工作区路径签名：

- **首次观察**不新增受管根（避免把历史工作区一次性塞进配置），但对已有受管根做一次
  幂等重建，补上宿主停机期间新增的子目录（有变化才写）。
- **新增的工作区**：若它已被某个受管根覆盖（等于根或在根的子树内），只重新生成，
  不重复加根；若它是「顶层工作区」且不在任何受管根里，按 `autoMode` 自动加为受管根再写配置。
- **删除的工作区**：不会自动删除受管根（目录可能还在用），只重新生成；目录真的没了时
  该根的映射会按「目录不存在」的警告被清掉。
- 新工作区若**包住**一个已有受管根（例如已有 `/root/workspace`，又新增 `/root`），
  跳过自动加根，避免把整棵子树重新切分。
- 关掉 `autoApply` 时轮询仍在跑但立即返回，不写状态、不写配置；重新打开后下一次变化重新取基线。
- 自动处理结果（最近一次时间、新增根、是否改写、备份路径）通过 `GET /api/dsh-hindsight-config/state`
  的 `auto` 字段暴露，面板在「自动」一节显示。
- 设 `HINDSIGHT_CONFIG_AUTO_POLL_MS=0` 可完全关闭轮询。

**候选起点**：在「添加根目录」一节里，候选起点 = **顶层工作区**（工作区注册表里不被其它
工作区包含的那些，如 `/root/dev`、`/root/github`、`/root/watsons-ai`、`/root/workspace`）
中**还没加为受管根的**：已在列表里的不显示，磁盘上不存在的也不显示，所以已加 dev /
watsons-ai / workspace 时只剩 `github`。**点一下候选把路径填进下面的输入框，再点「添加」**
（新根套用「自动」里的默认模式）。树外目录仍可直接手输绝对路径。

宿主侧由 `GET /api/dsh-hindsight-config/candidates` 提供（读宿主的 `ctx.workspaceRegistry`）；
宿主还是旧版本（没有这条路由）时该行只显示「候选起点需要重启 DSH 加载宿主新版本后才会出现」，
不会报错。受管根行里原先的「查看子目录」清单已移除。

`autoApply` 不覆盖「改模式」：改某个根的模式（关闭 / 独立 / 共享）之后仍要点「重新生成」
或「重新生成此根」才落盘，此时该行会显示「文件与设置不一致，请重新生成」。

## 文件

| 文件 | 说明 |
| --- | --- |
| `~/.hindsight/coding-agent.json` | Hindsight 的配置（可用 `HINDSIGHT_CONFIG` 换路径）。面板只改 `mapPathToBank` 与 `paths` |
| `~/.hindsight/coding-agent.dsh.json` | 本面板的状态（受管根目录、模式、筛选、重启单元，0600）。删除后由配置文件形状重新派生 |
| `~/.hindsight/coding-agent.json.bak-<YYYYMMDD-HHmmss>` | 每次实际覆盖前自动备份，保留最近 10 份 |

写入是「同目录临时文件 + rename」原子写，且所有读改写操作在插件内串行化；
配置文件 JSON 损坏时**拒绝写入**，面板显示解析错误。

## 重新生成与重载

- **重新生成**：重扫磁盘树 → 重建映射 → （有变化时）备份 + 写配置。幂等：连续两次结果逐字节相同。
  单根「重新生成此根」只重建该根拥有的键。
- **重载**：重读配置文件并报告生效范围。
  Hindsight 的 DSH 半体把「工作目录 → bank」缓存在模块级 `Map` 里，
  **进程内没有失效入口**（未导出该 Map；loader 的 `import()` 不带 cache-bust；
  `dsh-hmr` 在此 profile 不监听 `node_modules`）。因此：
  - 本进程**没解析过**的工作目录：立即生效；
  - 本进程**已解析过**的工作目录：必须重启 DSH 宿主，`systemctl restart dsh-web.service`。
- **应用并重启**（二次确认）：面板从 `/proc/self/cgroup` 推断托管单元后
  `systemctl restart --no-block <unit>`；成功后页面自动重连。
  重启会打断当前正在进行的回复，因此这一步**只**由用户在面板上确认触发。

## 发布到 npm（公共 registry）

发布为 `@major.chen/dsh-hindsight-config`（`publishConfig` 已指向 npmjs、`access: public`）。重新发布：

1. 改版本号（`npm version patch|minor|major --no-git-tag-version`）。
2. 登录 npmjs：本机 `npm config get registry` 是 `https://registry.npmmirror.com`（只读镜像），
   发布必须显式指向官方 registry：
   `npm login --registry=https://registry.npmjs.org`，或写入 Automation token
   （`//registry.npmjs.org/:_authToken=...`）。
3. **校验内容**：`npm pack --dry-run`
   （若本机 npm cache 目录不可写，补 `--cache <可写目录>`）。
4. **发布**：`npm publish --registry=https://registry.npmjs.org`
   （`publishConfig.access=public` 已声明，无需再传 `--access`）。

改名（作用域/包名）要同步 `client.js` 的 `__ModuleLoader__` 模块 id 与 `BUNDLE`、
`cordis.patch.yml`、`package.json`、README 与 profile 里的安装引用。

## 安装 / 卸载

```bash
# 本地 link 安装（等价于 plugin_manager install_bundle，target = 本目录）
dsh plugin --profile <profile> add link:/path/to/dsh-hindsight-config

# 或从 npm 安装
dsh plugin --profile <profile> add @major.chen/dsh-hindsight-config
```

安装后**刷新页面**（新增 Client 插件不走免刷新 HMR）。
卸载用插件管理器的 remove，或从 profile 的 `package.json` 的 `dsh.profile.bundles` 里移除本包。

## 测试

```bash
node --test test/*.test.mjs
```

- `test/generate.test.mjs`：纯函数（树扫描 → 映射生成、幂等、保留未受管内容、筛选、模板替换、警告）。
- `test/routes.test.mjs`：宿主路由（状态派生、写盘/备份/幂等、dryRun、非法 JSON 拒绝、403/405/400、工具与系统提示段）
  与「自动」监听（基线、新增工作区加根并写盘、关闭时不写、嵌套工作区不重复加根）。
- `test/client.test.mjs`：浏览器半体的浅层渲染（模块 id、槽位注册与新旧宿主分支、文案本地化、渲染不抛错）。

## 已知限制

- 经 `192.168.188.101:3080`（LAN 地址）打开页面时，API 因 Host 不是回环地址返回 **403**；
  请用 `http://127.0.0.1:3080`。这与同族插件（`@hyzyn/dsh-env` 等）的围栏语义一致。
- 写配置会把文件规范化成 2 空格缩进 JSON（手工对齐等格式不会保留；键顺序保留），写前有备份。
- 「独立」模式默认只切分**一层**：更深层级归属其父目录的 bank。面板状态里的 `depth` 决定层数
  （`generate.js` 支持 `depth ≥ 2`，面板当前固定为 1）。
- 自动监听只在 DSH 宿主进程存活时运行；宿主挂了就不会有新的自动写入。
- 面板打开时不会实时轮询 `/state`：后台自动加的受管根要刷新页面（或重开面板）才显示；
  自动写入的配置文件本身已经落盘，不受影响。
- 首次观察工作区注册表不补历史根：插件安装/宿主重启前就已经存在的**顶层工作区**，
  需要手点一次「重新生成」或手动添加才会进入配置（受管根子树内的新目录会被首次重建补上）。
