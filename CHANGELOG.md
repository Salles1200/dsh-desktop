# 更新日志

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
