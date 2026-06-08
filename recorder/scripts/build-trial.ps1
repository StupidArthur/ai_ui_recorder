$ErrorActionPreference = "Stop"
$DebugLogPath = "g:\gitee\ai_ui_recorder\.cursor\debug.log"
$DebugLogDir = Split-Path -Parent $DebugLogPath

# 工程根目录 = scripts/ 上一级 = recorder/
$ProjectRoot = Split-Path $PSScriptRoot -Parent

# release 输出根(为与 release/translate/ (Python 翻译 EXE) 对齐,本 Node EXE 输出到 release/recorder/)
$ReleaseDir = Join-Path $ProjectRoot "release/recorder"

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
if (Test-Path "$ProjectRoot/dist") { Remove-Item "$ProjectRoot/dist" -Recurse -Force }
if (Test-Path "$ProjectRoot/release") { Remove-Item "$ProjectRoot/release" -Recurse -Force }
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

#region agent log
Write-AgentDebugLog "H3" "recorder/scripts/build-trial.ps1:42" "before build:bundle" @{
  hasDist = (Test-Path "$ProjectRoot/dist")
  hasRelease = (Test-Path "$ProjectRoot/release")
}
#endregion

Write-Host "[2/3] Build bundle..." -ForegroundColor Cyan
npm run build:bundle
$bundleExitCode = $LASTEXITCODE

#region agent log
Write-AgentDebugLog "H3" "recorder/scripts/build-trial.ps1:54" "after build:bundle" @{
  exitCode = $bundleExitCode
  hasBundle = (Test-Path "$ProjectRoot/dist/app.bundle.cjs")
}
#endregion

if ($bundleExitCode -ne 0 -or -not (Test-Path "$ProjectRoot/dist/app.bundle.cjs")) {
  Write-Host "Build bundle failed, abort packaging." -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] Pack single EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"

#region agent log
Write-AgentDebugLog "H5" "recorder/scripts/build-trial.ps1:70" "pkg target selected" @{
  target = $pkgTarget
}
#endregion

# 用 Node 18 运行 pkg CLI，规避 Node 24 + pkg-fetch 的兼容问题
#region agent log
Write-AgentDebugLog "H7" "recorder/scripts/build-trial.ps1:78" "pkg runner selected" @{
  hostNodeVersion = (node -v)
  runner = "npx -y node@18 $ProjectRoot/node_modules/pkg/lib-es5/bin.js"
}
#endregion

$pkgOutput = & npx -y node@18 "$ProjectRoot/node_modules/pkg/lib-es5/bin.js" "$ProjectRoot/dist/app.bundle.cjs" --target $pkgTarget --output "$ReleaseDir/ai-ui-recorder-trial.exe" 2>&1
$pkgExitCode = $LASTEXITCODE

if ($pkgOutput) {
  $pkgOutputText = ($pkgOutput | ForEach-Object { $_.ToString() }) -join "`n"
  #region agent log
  Write-AgentDebugLog "H5" "recorder/scripts/build-trial.ps1:83" "pkg command output" @{
    outputHead = if ($pkgOutputText.Length -gt 1200) { $pkgOutputText.Substring(0, 1200) } else { $pkgOutputText }
  }
  #endregion
  $pkgOutput | ForEach-Object { Write-Host $_ }
}

#region agent log
Write-AgentDebugLog "H4" "recorder/scripts/build-trial.ps1:93" "after pkg" @{
  exitCode = $pkgExitCode
  hasExe = (Test-Path "$ReleaseDir/ai-ui-recorder-trial.exe")
}
#endregion

if ($pkgExitCode -ne 0 -or -not (Test-Path "$ReleaseDir/ai-ui-recorder-trial.exe")) {
  Write-Host "Pack EXE failed." -ForegroundColor Red
  exit 1
}

Write-Host "[4/5] Prepare offline Chromium runtime..." -ForegroundColor Cyan
$localChromeZipPath = if ($env:LOCAL_CHROME_ZIP) { $env:LOCAL_CHROME_ZIP } else { "D:\chrome_download\chrome-win64.zip" }
$usingLocalChromeZip = $false

if (Test-Path $localChromeZipPath) {
  Write-Host "Use local Chromium zip: $localChromeZipPath" -ForegroundColor Green
  Expand-Archive -Path $localChromeZipPath -DestinationPath $ReleaseDir -Force
  $localChromeExe = "$ReleaseDir/chrome-win64/chrome.exe"
  if (-not (Test-Path $localChromeExe)) {
    Write-Host "Local Chromium zip is invalid: chrome.exe not found." -ForegroundColor Red
    exit 1
  }
  $usingLocalChromeZip = $true
} else {
  Write-Host "Local Chromium zip not found, fallback to playwright download..." -ForegroundColor Yellow
  New-Item -ItemType Directory -Path "$ReleaseDir/ms-playwright" -Force | Out-Null
  $playwrightRuntimePath = (Resolve-Path "$ReleaseDir/ms-playwright").Path
  $env:PLAYWRIGHT_BROWSERS_PATH = $playwrightRuntimePath
  npx playwright install chromium
  $installExitCode = $LASTEXITCODE

  if ($installExitCode -ne 0) {
    Write-Host "Install Chromium runtime failed." -ForegroundColor Red
    exit 1
  }
}

Write-Host "[5/5] Copy static + config template..." -ForegroundColor Cyan
Copy-Item -Path "$ProjectRoot/src/dashboard/static" -Destination "$ReleaseDir/static" -Recurse -Force
Copy-Item -Path "$ProjectRoot/src/case_translate/prompts/md" -Destination "$ReleaseDir/prompts/md" -Recurse -Force
Copy-Item -Path "$ProjectRoot/src/case_translate/prompts/README.md" -Destination "$ReleaseDir/prompts/README.md" -Force
New-Item -ItemType Directory -Path "$ReleaseDir/config" -Force | Out-Null

# AI 配置模板(以 release1/config/ai.local.json 的 baseUrl/model 为标准):
#   - baseUrl / model 写死标准值,保证 EXE 知道往哪发请求、用哪个模型
#   - apiKey 留空,用户必须在使用前自己填入(否则 ai-config.js 启动时
#     normalizeAndValidate() 会抛 "AI 配置缺失字段: apiKey")
$aiConfigTemplate = @'
{
  "baseUrl": "https://api.minimax.chat/v1",
  "apiKey": "",
  "model": "MiniMax-M2.7-highspeed"
}
'@
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $ReleaseDir "config/ai.local.json"), $aiConfigTemplate, $utf8NoBom)

Write-Host "Build done: $ReleaseDir/ai-ui-recorder-trial.exe" -ForegroundColor Green
if ($usingLocalChromeZip) {
  Write-Host "Offline package: $ReleaseDir/ai-ui-recorder-trial.exe + $ReleaseDir/chrome-win64/" -ForegroundColor Yellow
} else {
  Write-Host "Offline package: $ReleaseDir/ai-ui-recorder-trial.exe + $ReleaseDir/ms-playwright/" -ForegroundColor Yellow
}
Write-Host "Generated $ReleaseDir/config/ai.local.json (template — please fill in apiKey before use)." -ForegroundColor Yellow
