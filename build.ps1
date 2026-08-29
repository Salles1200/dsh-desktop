# build.ps1 — build the native WebView2 host (bin/dsh-desktop.exe).
#
# Requirements:
#   - Windows (the host is WinForms + WebView2)
#   - .NET Framework 4.x (csc.exe ships with Windows)
#   - Network access to nuget.org on first run (to fetch the WebView2 SDK)
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

# 2. Fetch the WebView2 WinForms SDK from NuGet (a .nupkg is a zip).
$pkgName    = "microsoft.web.webview2.winforms"
$nugetUrl   = "https://api.nuget.org/v3-flatcontainer/$pkgName/$WebView2Version/$pkgName.$WebView2Version.nupkg"
$nupkg      = Join-Path $toolsDir "$pkgName.$WebView2Version.nupkg"
$extractDir = Join-Path $toolsDir "$pkgName.$WebView2Version"

if (-not (Test-Path $extractDir)) {
    New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null
    if (-not (Test-Path $nupkg)) {
        Write-Host "Downloading $nugetUrl"
        Invoke-WebRequest -Uri $nugetUrl -OutFile $nupkg -UseBasicParsing
    }
    $zip = "$nupkg.zip"
    Copy-Item $nupkg $zip -Force
    Expand-Archive -Path $zip -DestinationPath $extractDir -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
}

$core     = Get-ChildItem $extractDir -Recurse -Filter "Microsoft.Web.WebView2.Core.dll"     | Where-Object { $_.FullName -match "[\\/]lib[\\/]net4" } | Select-Object -First 1
$winforms = Get-ChildItem $extractDir -Recurse -Filter "Microsoft.Web.WebView2.WinForms.dll" | Where-Object { $_.FullName -match "[\\/]lib[\\/]net4" } | Select-Object -First 1
$loader   = Get-ChildItem $extractDir -Recurse -Filter "WebView2Loader.dll"                  | Where-Object { $_.FullName -match "x64" } | Select-Object -First 1
if (-not $loader) {
    $loader = Get-ChildItem $extractDir -Recurse -Filter "WebView2Loader.dll" | Select-Object -First 1
}
if (-not $core -or -not $winforms -or -not $loader) { throw "could not locate WebView2 assemblies in $extractDir" }

# 3. Compile the host.
New-Item -ItemType Directory -Force -Path $binDir | Out-Null
$fw = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
& $csc /nologo /target:winexe /platform:x64 /optimize+ `
    /win32manifest:"$hostDir\app.manifest" `
    /out:"$binDir\dsh-desktop.exe" `
    /r:"$fw\System.dll" /r:"$fw\System.Drawing.dll" /r:"$fw\System.Windows.Forms.dll" `
    /r:"$($core.FullName)" /r:"$($winforms.FullName)" `
    "$hostDir\Program.cs"
if ($LASTEXITCODE -ne 0) { throw "csc.exe failed with exit code $LASTEXITCODE" }

# 4. Copy the WebView2 assemblies and the app config beside the exe.
Copy-Item $core.FullName     "$binDir\Microsoft.Web.WebView2.Core.dll"     -Force
Copy-Item $winforms.FullName "$binDir\Microsoft.Web.WebView2.WinForms.dll" -Force
Copy-Item $loader.FullName   "$binDir\WebView2Loader.dll"                  -Force
Copy-Item "$hostDir\app.config" "$binDir\dsh-desktop.exe.config"           -Force

Write-Host ""
Write-Host "Built: $binDir\dsh-desktop.exe"
Write-Host "Now install with:  dsh plugin --profile web add ."
