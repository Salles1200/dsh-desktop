# dsh-desktop

一个 DSH（DeepSeek Harness）profile bundle 插件：把 DSH 的 Web 界面变成一个 **Windows 桌面应用**——在 DSH 启动时自动在桌面创建（并保持最新）快捷方式，双击后用一个**原生 WebView2 窗口**（真正的 WinForms 宿主，而非浏览器）打开，并带**系统托盘图标**、**单实例**与**高 DPI 清晰渲染**。窗口、任务栏和托盘图标都使用配置的 PNG（自动转成 `.ico`）。

- 图标：默认使用插件内置的 `assets/icon.png`；也可在 workspace 放一个 `icon.png`，或通过 `iconPath` 指定（详见下文「配置」）
- 原生壳：`dsh-desktop.exe`（.NET Framework 4.x WinForms + Microsoft Edge WebView2 Runtime）
- **托盘**：左键显示/恢复窗口，右键「退出」（结束 DSH 服务并退出）
- **单实例**：重复启动只把已运行窗口调到前台，不会多开
- **高 DPI**：宿主以 PerMonitorV2 DPI 感知运行，在 2560×1600 @ 200% 等高分屏上清晰锐利
- **自动完成浏览器认证**：窗口先换取 DSH 的会话 Cookie，不会停在 `dsh web authentication required` 的 401 页面（见下文「浏览器认证」）
- 非 Windows 平台：插件自动跳过，不会报错
- 任何失败都只记录 warning，**绝不会**导致 DSH 启动失败

## 工作方式

插件在 DSH host 启动时（`apply`）执行一次，幂等。它在 `$DSH_HOME/dsh-desktop/` 下维护：

| 文件 | 作用 |
|---|---|
| `dsh-desktop.exe` | 原生 WebView2 宿主程序（PerMonitorV2 DPI 感知） |
| `dsh-desktop.exe.config` | 启用 WinForms 高 DPI（PerMonitorV2）的配置 |
| `Microsoft.Web.WebView2.Core.dll` / `Microsoft.Web.WebView2.WinForms.dll` | WebView2 的 .NET 封装 |
| `WebView2Loader.dll` | 定位已安装 WebView2 Runtime 的原生加载器 |
| `dsh.ico` | 由 PNG 包装成的 ICO 图标 |
| `dsh-desktop.conf` | 宿主程序启动时读取的行式配置（含插件发布的认证 URL） |
| `manifest.json` | 快捷方式输入的指纹（用于判断是否需要重建） |

宿主程序（`dsh-desktop.exe`）的行为：

1. 设置 PerMonitorV2 DPI 感知（应用内嵌 manifest + 程序化兜底），避免 Windows 位图拉伸导致的模糊；
2. 检查 `http://127.0.0.1:3080` 是否已响应；若没有，则以**隐藏控制台**启动 `dsh web --no-open`（不显示 Node.js/PowerShell 窗口，也不在任务栏占位；`--no-open` 阻止 DSH 再自动打开默认浏览器）；
3. 轮询等待服务就绪（最长 45 秒），并读取插件写入的 **认证 URL**（见下节）；
4. 按屏幕物理工作区（92%）设定窗口大小，初始化 WebView2 并导航到认证 URL；
5. 在系统通知区域（托盘）显示 DSH 图标：**左键点击**显示/恢复 DSH 界面窗口，**右键点击**弹出「退出」菜单；关闭窗口会最小化到托盘，点击「退出」会结束 DSH 服务并退出宿主；
6. **单实例**：同一时间只运行一个 `dsh-desktop.exe`。再次双击快捷方式时，若已有实例在运行，则只把该实例的窗口显示/恢复到前台，然后立即退出（不会出现第二个窗口、托盘图标或服务进程）。

## 浏览器认证（为什么需要 authUrl）

DSH 的 Web 服务不给「裸地址」发页面：浏览器必须先用带**一次性令牌**的地址

```
http://127.0.0.1:3080/?token=<每个 dsh 进程随机生成>
```

交换到一枚签名的会话 Cookie，之后才能访问 `/`。直接打开 `http://127.0.0.1:3080` 只会得到一行 401：

```
dsh web authentication required; reopen the URL printed by dsh web.
```

`dsh web` 会把这条带令牌的地址打印到终端，但桌面宿主是用**隐藏控制台**启动 `dsh web --no-open` 的，读不到那行输出；而 WebView2 使用自己独立的用户数据目录，也拿不到你浏览器里的 Cookie —— 所以早期版本一打开就是上面这条 401 提示。

现在插件在 Web 服务开始监听后，会把该进程的认证 URL 和发布它的 `dsh` 进程号写进 `dsh-desktop.conf`：

```
url=http://127.0.0.1:3080
authUrl=http://127.0.0.1:3080/?token=...
pid=12345
```

宿主启动时优先导航到 `authUrl`（令牌随进程变化，所以每次启动都会重新发布；只有发布者仍在运行时才采信，避免使用已退出进程留下的失效令牌）。这样 WebView2 会在自己的配置目录里完成握手并长期保存 Cookie，之后再打开裸地址也不会再出现 401。宿主日志（`dsh-desktop.log`）会记录 `navigate target ...` 以及顶层文档的响应码（正常为 `303` 后 `200`），便于确认。


## 安装（开箱即用）

`bin/`（含原生宿主 `dsh-desktop.exe` 与 WebView2 依赖）已**预构建并随仓库分发**，无需自行构建。

克隆后直接安装：

```sh
git clone https://github.com/Salles1200/dsh-desktop.git
cd dsh-desktop
dsh plugin --profile web add .
```

（`dsh plugin` 会转发给 pnpm；也可以用 `file:` 或 `link:` 形式指向本目录。）

装好后，下次 `dsh web` 启动时插件会自动创建/刷新桌面快捷方式。

> 想自己从源码重建宿主？见下文「构建原生宿主」。

## 配置

所有配置都是**可选**的，且默认值与工作区无关——插件在 DSH host 启动时自动从运行时环境推导，因此**不同用户、不同 workspace 都能开箱即用**。如需覆盖，在你的 profile 的 `cordis.patch.yml` 里对 `dsh-desktop` 这一行加 `config` 即可：

| 键 | 默认值 | 说明 |
|---|---|---|
| `shortcutName` | `DeepSeek Harness` | 快捷方式名称（也是窗口标题） |
| `url` | `http://127.0.0.1:3080` | DSH Web 界面地址 |
| `iconPath` | `<workspace>/icon.png`，否则用插件内置 `assets/icon.png` | 图标 PNG 路径（可选） |
| `workingDir` | `process.cwd()`（你的 DSH workspace 根） | DSH 启动时的工作目录 |
| `nodePath` | `process.execPath` | node.exe 路径（一般无需覆盖） |
| `dshEntry` | `process.argv[1]` | DSH 入口 `bin.js`（一般无需覆盖） |
| `desktopDir` | 系统桌面 | 桌面目录覆盖（测试用） |

（`dsh-desktop.conf` 里的 `authUrl` / `pid` 由插件自动写入与维护，不是可配置项。）

示例（覆盖图标和工作目录）：

```yaml
# 你的 profile 的 cordis.patch.yml
- id: dsh-desktop
  config:
    iconPath: 'C:\Users\me\my-dsh\icon.png'
    workingDir: 'C:\Users\me\my-dsh'
```

## 依赖与要求

- Windows 10/11（已安装 **Microsoft Edge WebView2 Runtime**；随 Edge 自动分发）
- .NET Framework 4.x（Windows 自带）
- 插件本体无 npm 运行时依赖（仅使用 Node 内置模块与 Windows PowerShell 5.1）

## 构建原生宿主

宿主源码在 `host/Program.cs`。用 `build.ps1` 一键构建（首次会从 NuGet 拉取 WebView2 SDK 到 `.tools/`，不提交进仓库；若拉取失败则自动复用 `bin/` 里已有的 WebView2 程序集，因此**离线也能重建**）：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
# 或指定 SDK 版本：
powershell -ExecutionPolicy Bypass -File build.ps1 -WebView2Version 1.0.2365.46
```

产物：`bin/dsh-desktop.exe`、`bin/dsh-desktop.exe.config`、`bin/Microsoft.Web.WebView2.Core.dll`、`bin/Microsoft.Web.WebView2.WinForms.dll`、`bin/WebView2Loader.dll`。

> **升级到新宿主的正确顺序**（宿主运行时 `dsh-desktop.exe` 被占用，插件无法覆盖它）：
> 1. 右键托盘图标 →「退出」，关闭正在运行的桌面窗口（它启动的 dsh 服务也会一起结束）；
> 2. 在终端里启动 `dsh web`（此时没有宿主占用文件，插件会把 `bin/` 里的新宿主复制到 `$DSH_HOME/dsh-desktop/` 并发布认证 URL）；
> 3. 之后照常双击桌面快捷方式即可连上已在运行的服务；也可以关掉终端服务，直接双击快捷方式让宿主自己拉起服务（此时用的已是新宿主）。
>
> 若顺序不对（仍显示旧界面），日志里会出现 `could not refresh ... — close the running desktop window and reboot DSH to retry`。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 窗口显示 `dsh web authentication required; reopen the URL printed by dsh web.` | 宿主导航到了没有令牌的裸地址。确认插件已升级到带 `authUrl` 发布的版本，并**先关闭正在运行的桌面窗口**再重启 `dsh web`（旧宿主 EXE 无法被覆盖，插件会提示这一点）。查看 `$DSH_HOME/dsh-desktop/dsh-desktop.log`：应有 `authenticated url published by dsh pid ... is ready` / `navigate target http://127.0.0.1:<port>/?token=...`，随后是 `document response 303` 与 `document response 200`。 |
| 日志里 `no live authenticated url published; falling back to the plain url` | 当前服务进程没有发布认证 URL——通常是该进程启动时插件还是旧版本。重启 `dsh web` 即可。 |
| 桌面快捷方式/图标不对 | 删除 `$DSH_HOME/dsh-desktop/manifest.json` 后重启 DSH，插件会重建快捷方式。 |

## 更新日志

见 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](LICENSE) © 2026 Salles1200
