// dsh-desktop — a minimal native WebView2 shell for the DeepSeek Harness web UI.
//
// Built against .NET Framework 4.x (WinForms) and the Microsoft WebView2
// Evergreen Runtime. It reads a line-based config file `dsh-desktop.conf`
// from its own directory:
//
//   url=http://127.0.0.1:3080
//   icon=C:\path\to\dsh.ico
//   workingDir=D:\AI\DeepSeek-Harness
//   node=C:\path\to\node.exe
//   dsh=C:\path\to\dsh\lib\bin.js
//   title=DeepSeek Harness
//   userData=C:\path\to\webview2-data
//
// Behavior:
//   - starts `dsh web --no-open` with a HIDDEN console (no Node.js taskbar
//     icon) when the URL is not yet answering;
//   - shows the UI in a single native WebView2 window and a tray icon in the
//     notification area (left-click shows the window, right-click has "退出");
//   - "退出" kills the DSH server it started and exits this process.
//
// It is per-monitor DPI aware (via the embedded manifest and a programmatic
// fallback), so the WebView2 content renders sharply on high-DPI displays.
// Diagnostics are appended to `dsh-desktop.log` beside the exe.
// C# 5 compatible (no string interpolation, no `?.`).

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace DshDesktopShortcut
{
    internal sealed class Config
    {
        public string Url = "http://127.0.0.1:3080";
        public string Icon = "";
        public string WorkingDir = "";
        public string Node = "";
        public string Dsh = "";
        public string Title = "DeepSeek Harness";
        public string UserData = "";

        public static Config Load(string path)
        {
            Config config = new Config();
            if (!File.Exists(path)) return config;
            foreach (string raw in File.ReadAllLines(path))
            {
                if (raw == null) continue;
                string line = raw.Trim();
                if (line.Length == 0 || line[0] == '#') continue;
                int idx = line.IndexOf('=');
                if (idx < 0) continue;
                string key = line.Substring(0, idx).Trim();
                string value = line.Substring(idx + 1);
                switch (key)
                {
                    case "url": config.Url = value; break;
                    case "icon": config.Icon = value; break;
                    case "workingDir": config.WorkingDir = value; break;
                    case "node": config.Node = value; break;
                    case "dsh": config.Dsh = value; break;
                    case "title": config.Title = value; break;
                    case "userData": config.UserData = value; break;
                }
            }
            return config;
        }
    }

    internal static class Program
    {
        private const uint SPI_GETWORKAREA = 0x0030;

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        // The DSH server this process started (null when it was already running
        // before we launched, in which case we must NOT kill it on exit).
        private static Process startedDshProcess;
        private static bool exiting;
        private static NotifyIcon trayIcon;

        // Single-instance coordination: only one dsh-window process runs at a
        // time. A second launch signals the running instance to show its window
        // and then exits immediately.
        private const string MUTEX_NAME = "DeepSeekHarness.dsh-window.single-instance";
        private const string SHOW_EVENT_NAME = "DeepSeekHarness.dsh-window.show";
        private static Mutex singleInstanceMutex;
        private static EventWaitHandle showEvent;

        [STAThread]
        private static void Main(string[] args)
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string logPath = Path.Combine(baseDir, "dsh-desktop.log");
            string configPath = Path.Combine(baseDir, "dsh-desktop.conf");

            // Single instance: if another dsh-window is already running, ask it
            // to show its window and exit this process without creating a new
            // window, tray icon, or server.
            if (!IsFirstInstance())
            {
                Log(logPath, "second instance: signalling the running instance to show its window, then exiting");
                return;
            }

            string dpiStatus = EnablePerMonitorV2();

            Log(logPath, "start");
            Log(logPath, "dpi: " + dpiStatus);
            int processAwareness = -1;
            GetProcessDpiAwareness(IntPtr.Zero, out processAwareness);
            Log(logPath, "process dpi awareness: " + processAwareness + " (0=unaware,1=system,2=per-monitor)");
            Log(logPath, "system dpi: " + GetDpiForSystem());

            Config config = Config.Load(configPath);
            if (args.Length >= 1 && !string.IsNullOrEmpty(args[0])) config.Url = args[0];
            if (args.Length >= 2 && !string.IsNullOrEmpty(args[1])) config.Icon = args[1];

            EnsureServer(config, logPath);

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Form form = new Form();
            form.Text = config.Title;
            form.AutoScaleMode = AutoScaleMode.Dpi;

            // Size from the native primary work area (physical pixels once the
            // process is per-monitor DPI aware).
            RECT work = new RECT();
            SystemParametersInfo(SPI_GETWORKAREA, 0, ref work, 0);
            int workW = work.Right - work.Left;
            int workH = work.Bottom - work.Top;
            form.Width = (int)Math.Round(workW * 0.92);
            form.Height = (int)Math.Round(workH * 0.92);
            form.StartPosition = FormStartPosition.CenterScreen;
            Log(logPath, "native work area " + workW + "x" + workH + "; window " + form.Width + "x" + form.Height);

            if (!string.IsNullOrEmpty(config.Icon) && File.Exists(config.Icon))
            {
                try { form.Icon = new Icon(config.Icon); }
                catch (Exception ex) { Log(logPath, "icon load failed: " + ex.Message); }
            }

            WebView2 web = new WebView2();
            web.Dock = DockStyle.Fill;
            CoreWebView2CreationProperties creation = new CoreWebView2CreationProperties();
            if (!string.IsNullOrEmpty(config.UserData)) creation.UserDataFolder = config.UserData;
            web.CreationProperties = creation;
            form.Controls.Add(web);

            // Tray icon in the notification area.
            trayIcon = BuildTrayIcon(form, config, logPath);
            Log(logPath, "tray icon created");

            // Watch for a "show window" signal from a later launch attempt.
            StartShowEventWatcher(form);

            // Closing the window hides it to the tray; "退出" is the only way out.
            form.FormClosing += delegate(object s, FormClosingEventArgs e)
            {
                if (!exiting)
                {
                    e.Cancel = true;
                    form.Hide();
                }
            };

            form.Load += async (s, e) =>
            {
                Log(logPath, "window dpi: " + GetDpiForWindow(form.Handle));
                try
                {
                    Log(logPath, "WebView2 init start");
                    await web.EnsureCoreWebView2Async(null);
                    Log(logPath, "WebView2 init ok, runtime " + web.CoreWebView2.Environment.BrowserVersionString);
                    web.CoreWebView2.Navigate(config.Url);
                    Log(logPath, "navigate " + config.Url);
                }
                catch (Exception ex)
                {
                    Log(logPath, "WebView2 init FAILED: " + ex);
                    MessageBox.Show(
                        "WebView2 initialization failed: " + ex.Message + Environment.NewLine +
                        "Make sure the Microsoft Edge WebView2 Runtime is installed.",
                        config.Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            };

            Application.Run(form);
            Log(logPath, "exit");
        }

        /// <summary>
        /// Acquire the single-instance mutex. Returns true when this process is
        /// the first instance (and creates the show event); returns false when
        /// another instance is already running, after signalling it to show its
        /// window.
        /// </summary>
        private static bool IsFirstInstance()
        {
            singleInstanceMutex = new Mutex(false, MUTEX_NAME);
            bool isFirst;
            try
            {
                isFirst = singleInstanceMutex.WaitOne(0);
            }
            catch (AbandonedMutexException)
            {
                // A previous instance crashed without releasing; take over.
                isFirst = true;
            }
            if (!isFirst)
            {
                EventWaitHandle ev;
                if (EventWaitHandle.TryOpenExisting(SHOW_EVENT_NAME, out ev))
                {
                    try { ev.Set(); } catch { }
                    ev.Dispose();
                }
                return false;
            }
            showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, SHOW_EVENT_NAME);
            return true;
        }

        private static void StartShowEventWatcher(Form form)
        {
            Thread watcher = new Thread(delegate()
            {
                while (true)
                {
                    try { showEvent.WaitOne(); }
                    catch { break; }
                    try
                    {
                        form.BeginInvoke((Action)delegate { ShowMainWindow(form); });
                    }
                    catch { break; }
                }
            });
            watcher.IsBackground = true;
            watcher.Start();
        }

        private static NotifyIcon BuildTrayIcon(Form form, Config config, string logPath)
        {
            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem exit = new ToolStripMenuItem("退出");
            exit.Click += delegate { ExitApp(form, config, logPath); };
            menu.Items.Add(exit);

            NotifyIcon icon = new NotifyIcon();
            icon.Text = config.Title;
            if (form.Icon != null) icon.Icon = form.Icon;
            icon.ContextMenuStrip = menu;
            icon.Visible = true;
            icon.MouseClick += delegate(object s, MouseEventArgs e)
            {
                if (e.Button == MouseButtons.Left) ShowMainWindow(form);
            };
            return icon;
        }

        private static void ShowMainWindow(Form form)
        {
            form.Show();
            if (form.WindowState == FormWindowState.Minimized) form.WindowState = FormWindowState.Normal;
            form.Activate();
            form.BringToFront();
        }

        private static void ExitApp(Form form, Config config, string logPath)
        {
            exiting = true;

            // 1. Kill the server we started ourselves (fast path).
            try
            {
                if (startedDshProcess != null && !startedDshProcess.HasExited)
                {
                    Log(logPath, "killing dsh server pid " + startedDshProcess.Id + " (started by this host)");
                    startedDshProcess.Kill();
                    startedDshProcess.Dispose();
                }
            }
            catch { }
            startedDshProcess = null;

            // 2. Also stop any DSH server still listening on the UI port — e.g.
            //    an orphaned server left by an earlier host instance, or one
            //    started separately — so a fresh launch actually loads newly
            //    installed plugins instead of reconnecting to a stale server.
            int port = GetPortFromUrl(config.Url);
            if (port > 0) KillListenersOnPort(port, logPath);

            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
                trayIcon = null;
            }
            if (showEvent != null)
            {
                try { showEvent.Dispose(); } catch { }
                showEvent = null;
            }
            if (singleInstanceMutex != null)
            {
                try { singleInstanceMutex.ReleaseMutex(); } catch { }
                try { singleInstanceMutex.Dispose(); } catch { }
                singleInstanceMutex = null;
            }
            form.Close();
            Application.Exit();
        }

        private static int GetPortFromUrl(string url)
        {
            try
            {
                return new Uri(url).Port;
            }
            catch
            {
                return 0;
            }
        }

        /// <summary>
        /// Kill the node process(es) currently LISTENING on the given port
        /// (the DSH web server), regardless of which process started them.
        /// </summary>
        private static void KillListenersOnPort(int port, string logPath)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("netstat", "-ano");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.StandardOutputEncoding = System.Text.Encoding.ASCII;
                using (Process netstat = Process.Start(psi))
                {
                    string output = netstat.StandardOutput.ReadToEnd();
                    netstat.WaitForExit();
                    string needle = ":" + port.ToString();
                    foreach (string line in output.Split('\n'))
                    {
                        if (line.IndexOf(needle, StringComparison.OrdinalIgnoreCase) < 0) continue;
                        if (line.IndexOf("LISTENING", StringComparison.OrdinalIgnoreCase) < 0) continue;
                        string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                        int pid;
                        if (parts.Length >= 2 && int.TryParse(parts[parts.Length - 1], out pid))
                        {
                            try
                            {
                                Process proc = Process.GetProcessById(pid);
                                if (proc.ProcessName.ToLowerInvariant() == "node")
                                {
                                    Log(logPath, "killing node pid " + pid + " listening on :" + port);
                                    proc.Kill();
                                    proc.Dispose();
                                }
                            }
                            catch { }
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Log(logPath, "kill listeners failed: " + ex.Message);
            }
        }

        // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4 (user32, Win10 1703+).
        private static string EnablePerMonitorV2()
        {
            try
            {
                bool ok = SetProcessDpiAwarenessContext(new IntPtr(-4));
                if (ok) return "PerMonitorV2 set via context";
                return "already set (manifest or prior call)";
            }
            catch { }
            try
            {
                // PROCESS_PER_MONITOR_DPI_AWARE = 2 (shcore, Win8.1+).
                int hr = SetProcessDpiAwareness(2);
                return hr == 0 ? "PerMonitor set via shcore" : "shcore hr=0x" + hr.ToString("X");
            }
            catch
            {
                return "no DPI API available";
            }
        }

        [DllImport("user32.dll")]
        private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

        [DllImport("shcore.dll")]
        private static extern int SetProcessDpiAwareness(int value);

        [DllImport("shcore.dll")]
        private static extern int GetProcessDpiAwareness(IntPtr hprocess, out int value);

        [DllImport("user32.dll")]
        private static extern uint GetDpiForWindow(IntPtr hwnd);

        [DllImport("user32.dll")]
        private static extern uint GetDpiForSystem();

        [DllImport("user32.dll")]
        private static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref RECT pvParam, uint fWinIni);

        private static void Log(string path, string message)
        {
            try
            {
                File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "  " + message + Environment.NewLine);
            }
            catch
            {
                // logging must never crash the host
            }
        }

        private static void EnsureServer(Config config, string logPath)
        {
            if (IsUp(config.Url))
            {
                Log(logPath, "server already up: " + config.Url);
                startedDshProcess = null;
                return;
            }
            Log(logPath, "server not up; starting dsh (hidden)");
            if (!string.IsNullOrEmpty(config.Node) && !string.IsNullOrEmpty(config.Dsh))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = config.Node;
                    psi.Arguments = "\"" + config.Dsh + "\" web --no-open";
                    psi.WorkingDirectory = string.IsNullOrEmpty(config.WorkingDir)
                        ? AppDomain.CurrentDomain.BaseDirectory
                        : config.WorkingDir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;   // no console window, no taskbar icon
                    startedDshProcess = Process.Start(psi);
                    Log(logPath, "started dsh pid " + (startedDshProcess != null ? startedDshProcess.Id.ToString() : "?"));
                }
                catch (Exception ex)
                {
                    Log(logPath, "start dsh failed: " + ex.Message);
                    startedDshProcess = null;
                }
            }
            DateTime deadline = DateTime.UtcNow.AddSeconds(45);
            while (DateTime.UtcNow < deadline)
            {
                System.Threading.Thread.Sleep(500);
                if (IsUp(config.Url)) break;
            }
            Log(logPath, IsUp(config.Url) ? "server up after wait" : "server still down after wait");
        }

        private static bool IsUp(string url)
        {
            try
            {
                HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
                request.Timeout = 2000;
                request.Method = "GET";
                request.UserAgent = "dsh-window/1.0";
                using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
                {
                    return true;
                }
            }
            catch (WebException ex)
            {
                return ex.Response != null;
            }
            catch
            {
                return false;
            }
        }
    }
}
