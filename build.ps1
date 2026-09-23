# build.ps1 — build the native WebView2 host (bin/dsh-desktop.exe).
#
# Requirements:
#   - Windows (the host is WinForms + WebView2)
#   - .NET Framework 4.x (csc.exe ships with Windows)
#   - Network access to nuget.org on first run (to fetch the WebView2 SDK);
#     when the SDK cannot be fetched, the assemblies already shipped in bin/
#     are reused, so a rebuild also works offline.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File build.ps1
#
# The WebView2 .NET assemblies are downloaded from NuGet into .tools/ and are
# NOT committed to the repository.

param(
    [string]$WebView2Version = "1.0.2365.46"
)

$ErrorActionPreference = "Stop"

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$hostDir  = Join-Path $root "host"
$binDir   = Join-Path $root "bin"
$toolsDir = Join-Path $root ".tools"

# 1. Locate the .NET Framework C# compiler.
$csc = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { throw "csc.exe not found at $csc (install .NET Framework 4.x)" }

# 2. Locate the WebView2 assemblies: a fetched .tools extraction first, the
#    NuGet download second, and the copies already in bin/ as the offline
#    fallback.
$pkgName    = "microsoft.web.webview2.winforms"
$nugetUrl   = "https://api.nuget.org/v3-flatcontainer/$pkgName/$WebView2Version/$pkgName.$WebView2Version.nupkg"
$nupkg      = Join-Path $toolsDir "$pkgName.$WebView2Version.nupkg"
$extractDir = Join-Path $toolsDir "$pkgName.$WebView2Version"

function Find-WebView2Assemblies([string]$dir) {
    if (-not (Test-Path $dir)) { return $null }
    $core     = Get-ChildItem $dir -Recurse -Filter "Microsoft.Web.WebView2.Core.dll"     | Where-Object { $_.FullName -match "[\\/]lib[\\/]net4" } | Select-Object -First 1
    $winforms = Get-ChildItem $dir -Recurse -Filter "Microsoft.Web.WebView2.WinForms.dll" | Where-Object { $_.FullName -match "[\\/]lib[\\/]net4" } | Select-Object -First 1
    $loader   = Get-ChildItem $dir -Recurse -Filter "WebView2Loader.dll"                  | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
    if (-not $loader) {
        $loader = Get-ChildItem $dir -Recurse -Filter "WebView2Loader.dll" | Select-Object -First 1
    }
    if (-not $core -or -not $winforms -or -not $loader) { return $null }
    return @{ Core = $core; WinForms = $winforms; Loader = $loader }
}

$sdk = Find-WebView2Assemblies $extractDir
if (-not $sdk) {
    try {
        # Windows PowerShell 5.1 still defaults to older TLS in some images.
        try { [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }
        New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
        if (-not (Test-Path $nupkg)) {
            Write-Host "Downloading $nugetUrl"
            Invoke-WebRequest -Uri $nugetUrl -OutFile $nupkg -UseBasicParsing
        }
        $zip = "$nupkg.zip"
        Copy-Item $nupkg $zip -Force
        Expand-Archive -Path $zip -DestinationPath $extractDir -Force
        Remove-Item $zip -Force -ErrorAction SilentlyContinue
        $sdk = Find-WebView2Assemblies $extractDir
    } catch {
        Write-Host "WebView2 SDK fetch failed: $($_.Exception.Message)"
    }
}
if (-not $sdk) {
    # Offline rebuild: the WebView2 assemblies ship in bin/ already.
    $binCore     = Join-Path $binDir "Microsoft.Web.WebView2.Core.dll"
    $binWinForms = Join-Path $binDir "Microsoft.Web.WebView2.WinForms.dll"
    $binLoader   = Join-Path $binDir "WebView2Loader.dll"
    if ((Test-Path $binCore) -and (Test-Path $binWinForms) -and (Test-Path $binLoader)) {
        Write-Host "Reusing the WebView2 assemblies already present in bin/"
        $sdk = @{
            Core     = Get-Item $binCore
            WinForms = Get-Item $binWinForms
            Loader   = Get-Item $binLoader
        }
    }
}
if (-not $sdk) { throw "could not locate the WebView2 assemblies (no .tools cache, no download, none in bin/)" }

# 3. Compile the host.
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32manifest:"$hostDir\app.manifest" `
    /out:"$binDir\dsh-desktop.exe" `
    /r:"$fw\System.dll" /r:"$fw\System.Drawing.dll" /r:"$fw\System.Windows.Forms.dll" `
    /r:"$($sdk.Core.FullName)" /r:"$($sdk.WinForms.FullName)" `
    "$hostDir\Program.cs"
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }

# 4. Copy the WebView2 assemblies and the app config beside the exe (skipping
#    copies that would be a file onto itself when the bin/ fallback was used).
$copies = @(
    @{ From = $sdk.Core.FullName;     To = "$binDir\Microsoft.Web.WebView2.Core.dll" },
    @{ From = $sdk.WinForms.FullName; To = "$binDir\Microsoft.Web.WebView2.WinForms.dll" },
    @{ From = $sdk.Loader.FullName;   To = "$binDir\WebView2Loader.dll" },
    @{ From = "$hostDir\app.config";  To = "$binDir\dsh-desktop.exe.config" }
)
foreach ($copy in $copies) {
    if ([System.IO.Path]::GetFullPath($copy.From) -eq [System.IO.Path]::GetFullPath($copy.To)) { continue }
    Copy-Item $copy.From $copy.To -Force
}

Write-Host ""
Write-Host "Built: $binDir\dsh-desktop.exe"
Write-Host "Now install with:  dsh plugin --profile web add ."
