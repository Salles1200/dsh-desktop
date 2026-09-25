# 更新日志

## 2.1.1

修掉两个"界面看起来没生效"的问题。

- 修复：快捷方式被删掉或指向别处后不会自动补回。原因是 `manifest.json` 里的指纹看不见 `.lnk` 本身，指纹没变就跳过重建。现在每次启动都读真实的 `.lnk`，比对 target / 工作目录 / 描述 / 图标路径，缺失或不一致才重建；`manifest.json` 降级为"上次成功写入的记录"，不再决定跳过
- 修复：换了 `assets/icon.png`（或 `iconPath`）之后桌面仍显示旧图标。原因是 Windows 按**图标文件路径**缓存位图，而文件名一直叫 `dsh.ico`。现在图标文件名带内容摘要（`dsh-<sha1 前 12 位>.ico`），图一变路径就变，缓存自然失效；同一次运行里会清理旧的 ico 文件
- 附带调整：PNG 读不出来时只记 warning 并继续（不再留下一个写着 `unavailable` 摘要的指纹），宿主与快捷方式照常刷新

## 2.1.0

卸载时自己收拾干净。

- 卸载插件时（`dsh plugin --profile web remove dsh-simple-desktop`，或在 Web「插件」页里取消这个组合包），插件在被卸载的那一刻删掉两样东西：它建的桌面快捷方式和 `$DSH_HOME/dsh-simple-desktop/` 状态目录
- 只删自己建的快捷方式：先读 `.lnk` 的目标，指向本插件宿主 exe 才删，否则原样保留，不会误删你自己做的快捷方式
- 区分"卸载"和"正常退出"：dispose 时读各 profile 的 `package.json`，如果 `dsh.profile.bundles` 里还有这个名字（普通关停、配置热重载），什么都不做；manifest 读不到时也按"还装着"处理，绝不误删
- 桌面窗口还开着时，宿主 exe 与 WebView2 文件被占用，状态目录删不掉：这时只记 warning，并提示"从托盘退出窗口后手动删除该目录"
- 已知边界：先在终端停掉 DSH、再执行 `dsh plugin remove`（进程里没有插件在跑）不会触发清理，这两处仍需手动删除

## 2.0.0

**重命名：`dsh-desktop` → `dsh-simple-desktop`**（破坏性变更：包名、Cordis 插件名、组合包行 id、`$DSH_HOME` 状态目录、宿主 exe/conf/日志名全部改名）。

- 运行期产物：`$DSH_HOME/dsh-simple-desktop/`、`dsh-simple-desktop.exe`、`dsh-simple-desktop.exe.config`、`dsh-simple-desktop.conf`、`dsh-simple-desktop.log`
- 组合包行（`cordis.patch.yml`）改为 `- id: dsh-simple-desktop / name: 'dsh-simple-desktop'`；单实例互斥体与显示事件改为 `DeepSeekHarness.dsh-simple-desktop.*`
- README 重写：把"极简"定位讲清楚（与 Electron/Tauri 类大型社区桌面端的对比表）、功能清单化（快捷方式 / 原生窗口 / 托盘 / 单实例 / 窗口自适应 / 高 DPI / 自动认证 / 自动拉起服务 / 零依赖 / 永不拖垮 DSH）、明确标注仅适配 Windows；DPI 与浏览器认证改为简要说明
- 迁移步骤见 README「从 dsh-desktop（1.x）迁移」：移除旧依赖、按新名重新 link、把 profile 补丁里的行 id 改成 `dsh-simple-desktop`；旧的 `$DSH_HOME/dsh-desktop/` 可删除
- 修复：快捷方式指纹加入**图标内容摘要**（`icoDigest`），换掉 `assets/icon.png` 或改 `iconPath` 之后会重建 `.lnk`，桌面图标不再停在旧图上
- 修复：图标写入改为"内容相同就跳过 + 单独兜底"，`dsh.ico` 被占用或 PNG 损坏时只记 warning，不再中断宿主文件刷新、conf 写入与快捷方式重建
- 除上述两项修复外，行为与 1.1.0 一致（0.1.7-rc.2 适配内容不变）

## 1.1.0

适配 DSH **0.1.7-rc.2**（同时兼容 0.1.5-rc.3）；运行时代码无需改动——401 握手所用的
`connection.authenticatedUrl()` / `?token=` 交换会话 Cookie 在 0.1.7-rc.2 上逐字未变，
已在真实环境端到端验证（`303` → `200`）。

- **展示元数据**：新增顶层 `icon` 与 `locale/en.json` / `locale/zh.json`，Web 侧边栏「插件」页
  会据此显示本组合包的图标、标题与说明（0.1.7 约定：`exports` 暴露 `./locale/*`，
  JSON 形如 `{ "meta": { "title": ..., "description": ... } }`）。已用 0.1.7 的
  `readPluginMeta()` 实测：标题/说明中英双份、图标解析为 data URL。
- **仍不导出 `Config` schema（保持零依赖）**：实测 profile 局部插件无法 bare-import 安装目录里的
  `@deepseek-ai/schemastery`（插件真实路径在仓库中、其上游没有 `node_modules`），
  一旦导入该行会变成 `failed to import`、插件完全不激活。因此配置项继续由插件自行读取并记录在
  README；若将来要接入新插件页的配置编辑，需要把 schemastery 声明成依赖（会引入第二份副本）。
- **版本声明**：`package.json` 增加 `engines.dsh` / `engines.node`（声明性，DSH 当前不强制）。
  本插件**故意不声明** `@deepseek-ai/dsh*` 的 `peerDependencies`：0.1.7 会强制检查它，
  而 semver 的预发布规则会让 `0.1.7-rc.2` 这类版本难以被普通范围覆盖，一旦不满足组合包会被启动跳过。
- **文档**：README 新增「DSH 版本兼容性」章节：0.1.7 的组合包解析/启动审计/插件页/HMR 变化、
  `patchReload` 字段退役、被跳过组合包与 `allow-version` 豁免、`$DSH_HOME/logs/` 启动诊断。

> 插件仍通过 `dsh plugin --profile web add .` 安装；升级到 1.1.0 后无需改 profile 配置。

## 1.0.1

修复桌面窗口始终显示 `dsh web authentication required; reopen the URL printed by dsh web.` 的问题。

DSH 的 Web 服务只把页面发给完成过握手的浏览器：先用带一次性令牌的地址
`http://127.0.0.1:<port>/?token=...` 换到签名会话 Cookie，之后才能访问 `/`；直接打开裸地址只会得到 401。
宿主原先用隐藏控制台启动 `dsh web --no-open` 后直接导航到裸地址，而 WebView2 又有自己独立的用户数据目录，
拿不到浏览器里已有的 Cookie，于是必然落到 401 页面。

- 插件在 Web 服务开始监听后，把本进程的认证 URL 与发布它的 dsh 进程号写入 `dsh-desktop.conf`
  （`authUrl=` / `pid=`）；令牌随进程变化，所以每次启动都会重新发布。
- 宿主优先导航到该认证 URL，从而在 WebView2 自己的配置目录里完成握手并长期保存会话 Cookie；
  仅当发布者进程仍在运行时才采信，避免使用已退出进程留下的失效令牌（此时回退到普通 URL）。
- 顶层文档若仍返回 401，宿主会重新解析认证 URL 并最多重试 3 次；`dsh-desktop.log` 记录
  `navigate target ...` 与 `document response 303` / `document response 200`，便于确认。
- 宿主文件改为按内容比较、逐个容错复制：窗口运行时不再刷屏告警；确实被占用而无法升级时会明确提示
  「关闭正在运行的桌面窗口后重启 DSH」。
- `build.ps1`：NuGet 拉取失败时复用 `bin/` 中已有的 WebView2 程序集，支持离线重建。
- `bin/dsh-desktop.exe` 已按新源码重新编译；README 增加「浏览器认证」与「故障排查」章节。

> 升级顺序：先右键托盘「退出」关闭窗口，再在终端运行 `dsh web`（此时插件才能覆盖被占用的宿主文件），
> 之后照常双击桌面快捷方式。

## 1.0.0

首个版本：DSH profile bundle 插件，用原生 WebView2 窗口（系统托盘、单实例、高 DPI、桌面快捷方式）
承载 DeepSeek Harness 的 Web 界面。
