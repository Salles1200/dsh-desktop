// dsh-desktop — a DeepSeek Harness (DSH) profile-bundle plugin.
//
// At DSH boot (host plane) it turns the DeepSeek Harness web UI into a native
// Windows desktop app: it creates and keeps up to date a desktop shortcut that
// launches a WebView2 host (a real WinForms window, not a browser) with a
// system-tray icon, single-instance behavior, and high-DPI rendering. The
// window and taskbar/tray icon all use the configured PNG (converted to .ico).
//
// It writes these artifacts under `$DSH_HOME/dsh-desktop`:
//
//   - dsh.ico                 shortcut + window + tray icon (PNG wrapped in ICO)
//   - dsh-desktop.exe         the native WebView2 host (copied from this
//                             package's bin/ directory)
//   - dsh-desktop.exe.config  WinForms high-DPI (PerMonitorV2) config
//   - Microsoft.Web.WebView2.*.dll + WebView2Loader.dll   host dependencies
//   - dsh-desktop.conf        line-based config the host reads at startup
//   - manifest.json           fingerprint of the shortcut inputs
//
// The host itself starts `dsh web --no-open` (with a hidden console) when the
// UI is not yet answering. It is a no-op on non-Windows platforms, and it
// never fails the boot: any problem is caught and logged as a warning instead
// of being re-thrown.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "dsh-desktop";

/** This package's root directory (real path, so it works through junctions). */
const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Full path of the always-present Windows PowerShell 5.1 host. */
const WINDOWS_POWERSHELL = join(
  process.env.SystemRoot ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

/** The harness home, resolved the same way dsh does: $DSH_HOME else ~/.dsh. */
function harnessHome(env = process.env) {
  return env.DSH_HOME || join(homedir(), ".dsh");
}

/** Quote a value as a PowerShell single-quoted string literal. */
function psSingleQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

/** Wrap a PNG buffer into a single-image ICO container. */
function pngToIco(png) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(png) || png.length < 24) throw new Error("icon is not a valid PNG image");
  for (let i = 0; i < 8; i++) if (png[i] !== signature[i]) throw new Error("icon is not a valid PNG image");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  // ICO stores dimensions in one byte; 0 means 256. Larger PNGs are still
  // rendered correctly because the PNG payload carries the real dimensions.
  const w = width >= 256 ? 0 : width;
  const h = height >= 256 ? 0 : height;
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);             // reserved
  header.writeUInt16LE(1, 2);             // type: 1 = icon
  header.writeUInt16LE(1, 4);             // number of images
  header.writeUInt8(w, 6);                // width
  header.writeUInt8(h, 7);                // height
  header.writeUInt8(0, 8);                // palette size
  header.writeUInt8(0, 9);                // reserved
  header.writeUInt16LE(1, 10);            // color planes
  header.writeUInt16LE(32, 12);           // bits per pixel
  header.writeUInt32LE(png.length, 14);   // bytes in image data
  header.writeUInt32LE(22, 18);           // offset of image data
  return Buffer.concat([header, png]);
}

/** Build the line-based config file the host reads at startup. */
function buildConfigFile({ url, icoPath, workingDir, nodePath, dshEntry, title, userData }) {
  return [
    "url=" + url,
    "icon=" + icoPath,
    "workingDir=" + workingDir,
    "node=" + nodePath,
    "dsh=" + dshEntry,
    "title=" + title,
    "userData=" + userData,
    "",
  ].join("\r\n");
}

/**
 * Resolve the icon PNG to use, in priority order: the explicit `iconPath`
 * config, an `icon.png` beside the workspace root, the bundled
 * `assets/icon.png`, then the bundled `assets/default-icon.png`. Returns null
 * when no icon is available (the shortcut and window then fall back to the
 * host's default icon).
 */
function resolveIconPath(config) {
  const candidates = [
    config.iconPath,
    join(process.cwd(), "icon.png"),
    join(packageDir, "assets", "icon.png"),
    join(packageDir, "assets", "default-icon.png"),
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return null;
}

/** Build the PowerShell snippet that writes the `.lnk` through WSH's COM API. */
function buildShortcutScript({ exePath, icoPath, shortcutName, workingDir, desktopDir }) {
  const lines = [];
  lines.push("$ErrorActionPreference = 'Stop'");
  lines.push("$desktop = [Environment]::GetFolderPath('Desktop')");
  if (desktopDir) lines.push("$desktop = " + psSingleQuote(desktopDir));
  lines.push("$lnk = Join-Path $desktop (" + psSingleQuote(shortcutName + ".lnk") + ")");
  lines.push("$ws = New-Object -ComObject WScript.Shell");
  lines.push("$sc = $ws.CreateShortcut($lnk)");
  lines.push("$sc.TargetPath = " + psSingleQuote(exePath));
  lines.push("$sc.Arguments = ''");
  lines.push("$sc.WorkingDirectory = " + psSingleQuote(workingDir));
  if (icoPath) lines.push("$sc.IconLocation = " + psSingleQuote(icoPath) + " + ',0'");
  lines.push("$sc.Description = " + psSingleQuote(shortcutName));
  lines.push("$sc.WindowStyle = 1");
  lines.push("$sc.Save()");
  return lines.join("\n");
}

/** Run a PowerShell script through Windows PowerShell, inheriting stdio. */
function runPowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = spawnSync(
    WINDOWS_POWERSHELL,
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
    { stdio: "inherit", windowsHide: true, shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`powershell exited with code ${String(result.status)}`);
}

/** Create the shortcut (and its support files); throws with a clear message on failure. */
function createShortcut(config) {
  const url = config.url ?? "http://127.0.0.1:3080";
  const shortcutName = config.shortcutName ?? "DeepSeek Harness";
  const workingDir = config.workingDir ?? process.cwd();
  const iconPath = resolveIconPath(config);
  const nodePath = config.nodePath ?? process.execPath;
  const dshEntry = config.dshEntry ?? process.argv[1];
  const desktopDir = config.desktopDir;

  if (!dshEntry) throw new Error("could not determine the dsh entry script (process.argv[1] is empty)");

  const dir = join(harnessHome(), "dsh-desktop");
  mkdirSync(dir, { recursive: true });

  const icoPath = iconPath ? join(dir, "dsh.ico") : null;
  const exePath = join(dir, "dsh-desktop.exe");
  const configPath = join(dir, "dsh-desktop.conf");
  const userData = join(dir, "webview2-data");

  // Icon (optional): explicit iconPath > <workspace>/icon.png > bundled
  // assets/icon.png > assets/default-icon.png. Without one, the shortcut and
  // window fall back to the host's default icon.
  if (iconPath) {
    writeFileSync(icoPath, pngToIco(readFileSync(iconPath)));
  } else {
    console.warn("dsh-desktop: no icon found; using the host's default icon (set iconPath, or place icon.png in the workspace)");
  }

  // Native host + its managed and native dependencies, always refreshed from
  // this package's bin/. The two Microsoft.Web.WebView2.* assemblies are the
  // .NET wrappers the compiled exe references at runtime; WebView2Loader.dll
  // is the native loader that locates the installed WebView2 Runtime; the
  // .config enables WinForms high-DPI (PerMonitorV2) so the UI is sharp.
  const hostFiles = [
    "dsh-desktop.exe",
    "dsh-desktop.exe.config",
    "Microsoft.Web.WebView2.Core.dll",
    "Microsoft.Web.WebView2.WinForms.dll",
    "WebView2Loader.dll",
  ];
  for (const file of hostFiles) {
    const source = join(packageDir, "bin", file);
    if (!existsSync(source)) throw new Error(`bundled host file missing at ${source}`);
    copyFileSync(source, join(dir, file));
  }

  // Config for the host.
  writeFileSync(configPath, buildConfigFile({ url, icoPath, workingDir, nodePath, dshEntry, title: shortcutName, userData }));

  // Recreate the .lnk only when its inputs change.
  const fingerprint = JSON.stringify({
    url,
    workingDir,
    nodePath,
    dshEntry,
    icoPath,
    exePath,
    shortcutName,
    desktopDir: desktopDir ?? null,
  });
  const manifestPath = join(dir, "manifest.json");
  let previous = "";
  try {
    previous = readFileSync(manifestPath, "utf8");
  } catch {
    // no manifest yet
  }

  if (previous !== fingerprint) {
    runPowerShell(buildShortcutScript({ exePath, icoPath, shortcutName, workingDir, desktopDir }));
    writeFileSync(manifestPath, fingerprint);
    console.log(`dsh-desktop: created the "${shortcutName}" desktop shortcut`);
  } else {
    console.log(`dsh-desktop: desktop shortcut "${shortcutName}" is already up to date`);
  }
}

/** Cordis plugin entry point. Never throws: failures are logged as warnings. */
export function apply(ctx, config) {
  if (process.platform !== "win32") return;
  try {
    createShortcut(config ?? {});
  } catch (error) {
    console.warn("dsh-desktop: " + (error && error.message ? error.message : String(error)));
  }
}
