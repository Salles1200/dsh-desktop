# dsh-desktop-shortcut

一个 DSH（DeepSeek Harness）profile bundle 插件：在 DSH 启动时，自动在 Windows 桌面上创建（并保持最新）一个 DSH 快捷方式。双击该快捷方式会用一个**原生 WebView2 窗口**（真正的 WinForms 宿主程序，而非浏览器）打开 DSH 的 Web 界面。窗口图标与任务栏图标都使用 `D:\AI\DeepSeek-Harness\deepseek-color.png`。

- 图标：`D:\AI\DeepSeek-Harness\deepseek-color.png`（插件自动转成 `.ico`，同时用于快捷方式图标、窗口图标和任务栏图标）
- 原生壳：`dsh-window.exe`（.NET Framework 4.x WinForms + Microsoft Edge WebView2 Runtime）
- **高 DPI 清晰渲染**：宿主以 PerMonitorV2 DPI 感知运行，在高分辨率/缩放显示器（如 2560×1600 @ 200%）上界面清晰锐利、不会发虚
- 非 Windows 平台：插件自动跳过，不会报错
- 任何失败都只记录 warning，**绝不会**导致 DSH 启动失败

## 工作方式

插件在 DSH host 启动时（`apply`）执行一次，幂等。它在 `$DSH_HOME/desktop-shortcut/` 下维护：

| 文件 | 作用 |
|---|---|
| `dsh-window.exe` | 原生 WebView2 宿主程序（PerMonitorV2 DPI 感知） |
| `dsh-window.exe.config` | 启用 WinForms 高 DPI（PerMonitorV2）的配置 |
| `Microsoft.Web.WebView2.Core.dll` / `Microsoft.Web.WebView2.WinForms.dll` | WebView2 的 .NET 封装 |
| `WebView2Loader.dll` | 定位已安装 WebView2 Runtime 的原生加载器 |
| `dsh.ico` | 由 PNG 包装成的 ICO 图标 |
| `dsh-webview2.conf` | 宿主程序启动时读取的行式配置 |
| `manifest.json` | 快捷方式输入的指纹（用于判断是否需要重建） |

宿主程序（`dsh-window.exe`）的行为：

1. 设置 PerMonitorV2 DPI 感知（应用内嵌 manifest + 程序化兜底），避免 Windows 位图拉伸导致的模糊；
2. 检查 `http://127.0.0.1:3080` 是否已响应；若没有，则以**隐藏控制台**启动 `dsh web --no-open`（不显示 Node.js/PowerShell 窗口，也不在任务栏占位；`--no-open` 阻止 DSH 再自动打开默认浏览器）；
3. 轮询等待服务就绪（最长 45 秒）；
4. 按屏幕物理工作区（92%）设定窗口大小，初始化 WebView2 并导航到 DSH 界面；
5. 在系统通知区域（托盘）显示 DSH 图标：**左键点击**显示/恢复 DSH 界面窗口，**右键点击**弹出「退出」菜单；关闭窗口会最小化到托盘，点击「退出」会结束 DSH 服务并退出宿主；
6. **单实例**：同一时间只运行一个 `dsh-window.exe`。再次双击快捷方式时，若已有实例在运行，则只把该实例的窗口显示/恢复到前台，然后立即退出（不会出现第二个窗口、托盘图标或服务进程）。

## 构建与安装

`bin/`（含原生宿主 `dsh-window.exe`）不随仓库分发，需要先构建：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
```

构建完成后安装：

```sh
dsh plugin --profile web add ./dsh-desktop-shortcut
```

（`dsh plugin` 会转发给 pnpm；也可以用 `file:` 或 `link:` 形式指向本目录。）

装好后，下次 `dsh web` 启动时插件会自动创建/刷新桌面快捷方式。

## 配置

在 profile 的 `cordis.patch.yml` 中可覆盖以下配置（均为可选项）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `shortcutName` | `DeepSeek Harness` | 快捷方式名称（也是窗口标题） |
| `url` | `http://127.0.0.1:3080` | DSH Web 界面地址 |
| `iconPath` | `D:\AI\DeepSeek-Harness\deepseek-color.png` | 图标 PNG 绝对路径 |
| `workingDir` | `D:\AI\DeepSeek-Harness` | DSH 启动时的工作目录（workspace 根） |
| `nodePath` | `process.execPath` | node.exe 路径（一般无需覆盖） |
| `dshEntry` | `process.argv[1]` | DSH 入口 `bin.js`（一般无需覆盖） |
| `desktopDir` | 系统桌面 | 桌面目录覆盖（测试用） |

## 依赖与要求

- Windows 10/11（已安装 **Microsoft Edge WebView2 Runtime**；随 Edge 自动分发）
- .NET Framework 4.x（Windows 自带）
- 插件本体无 npm 运行时依赖（仅使用 Node 内置模块与 Windows PowerShell 5.1）

## 构建原生宿主

宿主源码在 `host/Program.cs`。用 `build.ps1` 一键构建（首次会从 NuGet 拉取 WebView2 SDK 到 `.tools/`，不提交进仓库）：

```powershell
powershell -ExecutionPolicy Bypass -File build.ps1
# 或指定 SDK 版本：
powershell -ExecutionPolicy Bypass -File build.ps1 -WebView2Version 1.0.2365.46
```

产物：`bin/dsh-window.exe`、`bin/dsh-window.exe.config`、`bin/Microsoft.Web.WebView2.Core.dll`、`bin/Microsoft.Web.WebView2.WinForms.dll`、`bin/WebView2Loader.dll`。

## 许可证

[MIT](LICENSE) © 2026 Salles1200
