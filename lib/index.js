// dsh-desktop-shortcut — a DeepSeek Harness (DSH) profile-bundle plugin.
//
// At DSH boot (host plane) it creates and keeps up to date a Windows desktop
// shortcut that launches the DeepSeek Harness web UI inside a native WebView2
// window (a real WinForms host, not a browser). The window and taskbar icon
// both use the configured PNG (converted to an .ico).
//
// It writes these artifacts under `$DSH_HOME/desktop-shortcut`:
//
//   - dsh.ico                 shortcut + window icon (the PNG wrapped in an
//                             ICO container)
//   - dsh-webview2.exe        the native WebView2 host (copied from this
//                             package's bin/ directory)
//   - WebView2Loader.dll      the native loader beside the host
//   - dsh-webview2.conf       line-based config the host reads at startup
//   - manifest.json           fingerprint of the shortcut inputs
//
// The host itself starts `dsh web --no-open` when the UI is not yet answering,
// so the shortcut points straight at the exe (no PowerShell wrapper, a clean
// taskbar icon). It is a no-op on non-Windows platforms, and it never fails
// the boot: any problem is caught and logged as a warning instead of being
// re-thrown.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const name = "desktop-shortcut";

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

/** Build the line-based config file the WebView2 host reads at startup. */
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
  lines.push("$sc.IconLocation = " + psSingleQuote(icoPath) + " + ',0'");
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
  const iconPath = config.iconPath ?? join(process.cwd(), "deepseek-color.png");
  const nodePath = config.nodePath ?? process.execPath;
  const dshEntry = config.dshEntry ?? process.argv[1];
  const desktopDir = config.desktopDir;

  if (!dshEntry) throw new Error("could not determine the dsh entry script (process.argv[1] is empty)");
  if (!existsSync(iconPath)) throw new Error(`icon file not found at ${iconPath}`);

  const dir = join(harnessHome(), "desktop-shortcut");
  mkdirSync(dir, { recursive: true });

  const icoPath = join(dir, "dsh.ico");
  const exePath = join(dir, "dsh-window.exe");
  const configPath = join(dir, "dsh-webview2.conf");
  const userData = join(dir, "webview2-data");

  // Icon.
  writeFileSync(icoPath, pngToIco(readFileSync(iconPath)));

  // Native host + its managed and native dependencies, always refreshed from
  // this package's bin/. The two Microsoft.Web.WebView2.* assemblies are the
  // .NET wrappers the compiled exe references at runtime; WebView2Loader.dll
  // is the native loader that locates the installed WebView2 Runtime; the
  // .config enables WinForms high-DPI (PerMonitorV2) so the UI is sharp.
  const hostFiles = [
    "dsh-window.exe",
    "dsh-window.exe.config",
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
    console.log(`desktop-shortcut: created the "${shortcutName}" desktop shortcut`);
  } else {
    console.log(`desktop-shortcut: desktop shortcut "${shortcutName}" is already up to date`);
  }
}

/** Cordis plugin entry point. Never throws: failures are logged as warnings. */
export function apply(ctx, config) {
  if (process.platform !== "win32") return;
  try {
    createShortcut(config ?? {});
  } catch (error) {
    console.warn("desktop-shortcut: " + (error && error.message ? error.message : String(error)));
  }
}
