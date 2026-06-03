$ErrorActionPreference = "Stop"
$DebugLogPath = "g:\gitee\ai_ui_recorder\.cursor\debug.log"
$DebugLogDir = Split-Path -Parent $DebugLogPath

if (-not (Test-Path $DebugLogDir)) {
  New-Item -ItemType Directory -Path $DebugLogDir -Force | Out-Null
}

#region agent log
function Write-AgentDebugLog {
  param(
    [string]$HypothesisId,
    [string]$Location,
    [string]$Message,
    [hashtable]$Data
  )
  try {
    $payload = @{
      runId        = "build-trial"
      hypothesisId = $HypothesisId
      location     = $Location
      message      = $Message
      data         = $Data
      timestamp    = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
    Add-Content -Path $DebugLogPath -Value $payload -ErrorAction Stop
  } catch {
    Write-Host "[agent-log] failed to write debug log: $($_.Exception.Message)" -ForegroundColor DarkYellow
  }
}
#endregion

Write-Host "[1/3] Clean old artifacts..." -ForegroundColor Cyan
if (Test-Path "dist") { Remove-Item "dist" -Recurse -Force }
if (Test-Path "release") { Remove-Item "release" -Recurse -Force }
New-Item -ItemType Directory -Path "release" | Out-Null

#region agent log
Write-AgentDebugLog "H3" "scripts/build-trial.ps1:27" "before build:bundle" @{
  hasDist = (Test-Path "dist")
  hasRelease = (Test-Path "release")
}
#endregion

Write-Host "[2/3] Build bundle..." -ForegroundColor Cyan
npm run build:bundle
$bundleExitCode = $LASTEXITCODE

#region agent log
Write-AgentDebugLog "H3" "scripts/build-trial.ps1:37" "after build:bundle" @{
  exitCode = $bundleExitCode
  hasBundle = (Test-Path "dist/app.bundle.cjs")
}
#endregion

if ($bundleExitCode -ne 0 -or -not (Test-Path "dist/app.bundle.cjs")) {
  Write-Host "Build bundle failed, abort packaging." -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] Pack single EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"

#region agent log
Write-AgentDebugLog "H5" "scripts/build-trial.ps1:45" "pkg target selected" @{
  target = $pkgTarget
}
#endregion

# 用 Node 18 运行 pkg CLI，规避 Node 24 + pkg-fetch 的兼容问题
#region agent log
Write-AgentDebugLog "H7" "scripts/build-trial.ps1:53" "pkg runner selected" @{
  hostNodeVersion = (node -v)
  runner = "npx -y node@18 node_modules/pkg/lib-es5/bin.js"
}
#endregion

$pkgOutput = & npx -y node@18 node_modules/pkg/lib-es5/bin.js "dist/app.bundle.cjs" --target $pkgTarget --output "release/ai-ui-recorder-trial.exe" 2>&1
$pkgExitCode = $LASTEXITCODE

if ($pkgOutput) {
  $pkgOutputText = ($pkgOutput | ForEach-Object { $_.ToString() }) -join "`n"
  #region agent log
  Write-AgentDebugLog "H5" "scripts/build-trial.ps1:48" "pkg command output" @{
    outputHead = if ($pkgOutputText.Length -gt 1200) { $pkgOutputText.Substring(0, 1200) } else { $pkgOutputText }
  }
  #endregion
  $pkgOutput | ForEach-Object { Write-Host $_ }
}

#region agent log
Write-AgentDebugLog "H4" "scripts/build-trial.ps1:47" "after pkg" @{
  exitCode = $pkgExitCode
  hasExe = (Test-Path "release/ai-ui-recorder-trial.exe")
}
#endregion

if ($pkgExitCode -ne 0 -or -not (Test-Path "release/ai-ui-recorder-trial.exe")) {
  Write-Host "Pack EXE failed." -ForegroundColor Red
  exit 1
}

Write-Host "[4/5] Prepare offline Chromium runtime..." -ForegroundColor Cyan
$localChromeZipPath = if ($env:LOCAL_CHROME_ZIP) { $env:LOCAL_CHROME_ZIP } else { "D:\chrome_download\chrome-win64.zip" }
$usingLocalChromeZip = $false

if (Test-Path $localChromeZipPath) {
  Write-Host "Use local Chromium zip: $localChromeZipPath" -ForegroundColor Green
  Expand-Archive -Path $localChromeZipPath -DestinationPath "release" -Force
  $localChromeExe = "release/chrome-win64/chrome.exe"
  if (-not (Test-Path $localChromeExe)) {
    Write-Host "Local Chromium zip is invalid: chrome.exe not found." -ForegroundColor Red
    exit 1
  }
  $usingLocalChromeZip = $true
} else {
  Write-Host "Local Chromium zip not found, fallback to playwright download..." -ForegroundColor Yellow
  New-Item -ItemType Directory -Path "release/ms-playwright" -Force | Out-Null
  $playwrightRuntimePath = (Resolve-Path "release/ms-playwright").Path
  $env:PLAYWRIGHT_BROWSERS_PATH = $playwrightRuntimePath
  npx playwright install chromium
  $installExitCode = $LASTEXITCODE

  if ($installExitCode -ne 0) {
    Write-Host "Install Chromium runtime failed." -ForegroundColor Red
    exit 1
  }
}

Write-Host "[5/5] Copy static + config template..." -ForegroundColor Cyan
Copy-Item -Path "src/dashboard/static" -Destination "release/static" -Recurse -Force
Copy-Item -Path "src/case_translate/prompts/md" -Destination "release/prompts/md" -Recurse -Force
Copy-Item -Path "src/case_translate/prompts/schema" -Destination "release/prompts/schema" -Recurse -Force
Copy-Item -Path "src/case_translate/prompts/README.md" -Destination "release/prompts/README.md" -Force
New-Item -ItemType Directory -Path "release/config" -Force | Out-Null
$defaultAiConfigJson = @'
{
  "baseUrl": "http://10.30.70.77:8787/v1",
  "apiKey": "trial_demo_key_001",
  "model": "Qwen/Qwen3-VL-235B-A22B-Instruct"
}
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path (Get-Location) "release/config/ai.local.json"), $defaultAiConfigJson, $utf8NoBom)

Write-Host "Build done: release/ai-ui-recorder-trial.exe" -ForegroundColor Green
if ($usingLocalChromeZip) {
  Write-Host "Offline package: release/ai-ui-recorder-trial.exe + release/chrome-win64/" -ForegroundColor Yellow
} else {
  Write-Host "Offline package: release/ai-ui-recorder-trial.exe + release/ms-playwright/" -ForegroundColor Yellow
}
Write-Host "Generated release/config/ai.local.json (trial default)." -ForegroundColor Yellow

