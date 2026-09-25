# dsh-simple-desktop

DeepSeek Harness 的 Windows 桌面端外壳。

**只支持 Windows 10/11。** 其它平台上跳过该插件。

## 那么多桌面端，你这个能干啥

**省流：桌面快捷方式 + 托盘图标 + 独立窗口**

社区常见 DSH 桌面端会自带一些设置面板、主题、多窗口等，本插件不实现额外功能，仅仅是给 Web UI 套个壳，实现最简洁的界面。

## 功能

- 安装插件后，首次通过命令行启动 DSH 会自动创建/更新桌面快捷方式。图标使用配置的 PNG，也可使用工作区里的 `icon.png`。窗口、任务栏和托盘共用图标。
- 后续通过双击快捷方式可启动独立 DSH 窗口( WebView2 )，关闭窗口后不会结束服务。
- 左键托盘图标呼出界面，右键托盘图标点击「退出」可退出界面并结束服务，保持单实例。
- 按主显示器工作区的 92% 计算大小并居中；换显示器或改缩放后重开窗口按新工作区计算。兼容高 DPI。
- 非 Windows 端跳过该插件。仍使用 Web UI。

**如需要更丰富的功能，建议选择其他桌面端插件。**

## 工作方式

插件在 DSH 启动时执行一次，幂等。它在 `$DSH_HOME/dsh-simple-desktop/` ( 默认为 `C:\Users\<UserName>\.dsh\dsh-simple-desktop` ) 下产生以下文件：

| 文件 | 作用 |
|---|---|
| `dsh-simple-desktop.exe` | 原生 WebView2 宿主 |
| `dsh-simple-desktop.exe.config` | WinForms 高 DPI 配置 |
| `Microsoft.Web.WebView2.Core.dll` / `Microsoft.Web.WebView2.WinForms.dll` | WebView2 的 .NET 封装 |
| `WebView2Loader.dll` | 定位已安装 WebView2 Runtime 的原生加载器 |
| `dsh.ico` | 由 PNG 包成的 ICO，快捷方式、窗口、托盘共用 |
| `dsh-simple-desktop.conf` | 宿主启动时读的行式配置（含插件发布的认证 URL） |
| `manifest.json` | 快捷方式输入的指纹，用来判断要不要重建 |
| `webview2-data/` | WebView2 用户数据目录，Cookie 存这里 |

宿主启动流程：读同目录的 conf，看 `http://127.0.0.1:3080` 有没有响应；没有就用隐藏控制台启动 `dsh web --no-open` 并等它起来，然后拿插件发布的认证 URL 打开窗口、建托盘图标。诊断写在同目录的 `dsh-simple-desktop.log`。

## 浏览器认证

DSH 的 Web 服务要求浏览器使用一次性的 `http://127.0.0.1:<port>/?token=…` 更换签名 Cookie，之后访问 `/` 才算通过，直接打开裸地址会拿到 401。插件在服务起来后把这个 URL（连同发布它的 dsh 进程号）写进 conf，宿主优先使用它导航，Cookie 存在 WebView2 自己的用户目录里。所以窗口不会停在认证提示页。

## 安装

`bin/` 里带了预编译的宿主和 WebView2 依赖，无需自己构建。

```sh
git clone https://github.com/Salles1200/dsh-simple-desktop.git
cd dsh-simple-desktop
dsh plugin --profile web add .
```

`dsh plugin` 会把参数转给 pnpm，可以使用 `file:`、`link:` 指向本目录。

安装完成后，下次 `dsh web` 启动时会自动建好桌面快捷方式。

### 从 dsh-desktop 1.x 迁移

2.0.0 把包名从 `dsh-desktop` 改成 `dsh-simple-desktop`，profile 里的行 id、`$DSH_HOME` 下的状态目录、宿主的 exe / conf / 日志名也跟着改了。

```sh
dsh plugin --profile web remove dsh-desktop
dsh plugin --profile web add /path/to/dsh-simple-desktop
```

需手动修改 profile 下的 `cordis.patch.yml`：将 `- id: dsh-desktop` 改成 `- id: dsh-simple-desktop`（连带它下面的 `config`）。旧 `$DSH_HOME/dsh-desktop/` 目录可直接删除；新的 `$DSH_HOME/dsh-simple-desktop/` 会在启动时自行创建，桌面快捷方式会随之更新。

## DSH 版本

| 版本 | 情况 |
|---|---|
| 0.1.7-rc.2 | 验证过：组合包解析、`dsh web --no-open`、token 握手（303 → 200）、宿主复制、配置热重载都正常 |
| 0.1.5-rc.3 | 兼容，1.0.x 是在这个版本上做的 |

0.1.7 里和这个插件有关的变化：

- 组合包接口没变。`package.json` 里的 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`、profile 的 `dsh.profile.bundles` 顺序叠加、`link:` 安装都和以前一样
- 新增了版本预检，会强制检查插件声明的 `@deepseek-ai/dsh*` peerDependencies。这里故意不声明这类 peer：semver 对预发布版本的处理会让 `0.1.7-rc.2` 这类版本很难落进普通范围，一旦对不上，组合包启动时会被跳过。兼容范围改用声明性的 `engines.dsh` 表达，DSH 目前不强制
- 被跳过的组合包会在启动输出里点名，出现 `skipped bundle: dsh-simple-desktop …` 就是没加载。版本对不上可以豁免：`dsh plugin --profile web allow-version dsh-simple-desktop@<版本> --dsh-version <运行时版本> --accept-risk`，结果写进 profile 的 `compatibility.json`
- profile manifest 里不再有 `patchReload` 字段。热重载现在由 base 组合包的 `hmr` 行（`@deepseek-ai/dsh-hmr`）负责，旧的 `patchReload: "live"` 会被忽略，不会导致启动失败
- 启动期出错时，诊断会写到 `$DSH_HOME/logs/startup-*.log`。这个插件不抛错（失败只记 warning），一般不会有这类文件
- Web 侧边栏的「插件」页会列出这个组合包，标题、图标、说明来自 `package.json` 的 `icon` 和 `locale/*.json`，可以在那里启用或停用。插件自己的配置还是写在 profile 补丁里
- 想在改 `lib/index.js` 之后自动重载，可以在 profile 补丁里给 `hmr` 行加上本仓库路径：

  ```yaml
  - id: hmr
    config:
      root: ['.', '/path/to/dsh-simple-desktop']
  ```

## 配置

可以不修改。插件启动时从运行时环境推导默认值。如需覆盖，在 profile 的 `cordis.patch.yml` 里为 `dsh-simple-desktop` 一行添加 `config`：

| 键 | 默认值 | 说明 |
|---|---|---|
| `shortcutName` | `DeepSeek Harness` | 快捷方式名称，也是窗口标题 |
| `url` | `http://127.0.0.1:3080` | DSH Web 界面地址 |
| `iconPath` | `<workspace>/icon.png`，否则用插件内置的 `assets/icon.png` | 图标 PNG 路径。内置两张：默认黑色 `assets/icon.png`，另有蓝色 `assets/icon_blue.png` 可换用 |
| `workingDir` | `process.cwd()` | DSH 启动时的工作目录，也决定新会话的默认工作区 |
| `nodePath` | `process.execPath` | node.exe 路径，一般不用改 |
| `dshEntry` | `process.argv[1]` | DSH 入口 `lib/bin.js`，一般不用改 |
| `desktopDir` | 系统桌面 | 桌面目录覆盖，测试用 |

**`dsh-simple-desktop.conf` 里的 `authUrl` 和 `pid` 由插件自己写和维护，不是配置项。**

插件没有导出 `Config` schema：profile 里的插件 import 不到安装目录中的 `@deepseek-ai/schemastery`，加上那行 import 整个插件会 `failed to import`（详见 CHANGELOG 2.0.0）。配置由插件自己读，键名写错会被忽略。

示例：

```yaml
# 你的 profile 的 cordis.patch.yml
- id: dsh-simple-desktop
  config:
    iconPath: 'C:\Users\me\my-dsh\icon.png'
    workingDir: 'C:\Users\me\my-dsh'
```

## 依赖

- Windows 10/11，需 Microsoft Edge WebView2 Runtime ( Edge 自带 )
- .NET Framework 4.x ( Windows 自带 )
- DSH 0.1.5-rc.3 或 0.1.7-rc.2，Node 22 以上
- 插件不需要额外装 npm 包

## 构建宿主

宿主是 `host/Program.cs`，用 `build.ps1` 构建。第一次会从 NuGet 拉 WebView2 SDK 到 `.tools/`（不提交进仓库）；拉不到会复用 `bin/` 里已有的程序集，所以离线也能重建。

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
# 也可指定 SDK 版本
powershell -ExecutionPolicy Bypass -File build.ps1 -WebView2Version 1.0.2365.46
```

产物在 `bin/`：`dsh-simple-desktop.exe`、`dsh-simple-desktop.exe.config`、两个 WebView2 程序集和 `WebView2Loader.dll`。

升级宿主时注意顺序。宿主在运行时 `dsh-simple-desktop.exe` 是被占用的，插件覆盖不了：

1. 托盘右键「退出」，关掉正在运行的窗口（它启动的 dsh 服务也会一起结束）
2. 在终端中运行 `dsh web`，插件会把 `bin/` 里的新宿主复制到 `$DSH_HOME/dsh-simple-desktop/`，并发布认证 URL
3. 之后照常双击快捷方式

若顺序不对，日志里会有 `could not refresh … — close the running desktop window and reboot DSH to retry`。

## 常见问题

| 现象 | 处理 |
|---|---|
| 窗口显示 `dsh web authentication required; reopen the URL printed by dsh web.` | 宿主导航到了没有 token 的裸地址。确认插件已经升到带 `authUrl` 的那版，并且先关掉正在运行的窗口再重启 `dsh web`。看 `$DSH_HOME/dsh-simple-desktop/dsh-simple-desktop.log`：正常应该有 `authenticated url published by dsh pid ... is ready`，接着 `navigate target ...?token=...`，然后是 `document response 303` 和 `document response 200` |
| 启动输出有 `skipped bundle: dsh-simple-desktop …` | 组合包没加载，按原因处理；版本对不上就用前面那条 `allow-version` |
| 日志里 `no live authenticated url published; falling back to the plain url` | 当前服务进程没发布认证 URL，一般是这个进程启动时插件还是旧版本。重启 `dsh web` 即可 |
| 快捷方式或图标不对 | 删掉 `$DSH_HOME/dsh-simple-desktop/manifest.json` 再重启 DSH，会重建 |
| 换了图标但桌面图标没变 | 图标内容已计入快捷方式指纹，插件重跑时会重建 `.lnk`；若仍是旧图，属 Windows 图标缓存，按 F5 刷新桌面，或删掉 `manifest.json` 再重启 DSH 强制重建一次 |
| 换仓库或目录之后插件不生效 | 检查 profile 的 `dsh.profile.bundles` 和依赖名是不是 `dsh-simple-desktop`，按上面「从 dsh-desktop 1.x 迁移」重新 link |

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。
