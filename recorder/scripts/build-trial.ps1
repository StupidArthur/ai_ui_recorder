$ErrorActionPreference = "Stop"

# recorder 目录 = scripts/ 上一级
$RecorderDir = Split-Path $PSScriptRoot -Parent

# 工程根目录 = recorder/ 上一级 = 仓库根
$ProjectRoot = Split-Path $RecorderDir -Parent

# Node 录制器输出目录
$ReleaseDir = Join-Path $ProjectRoot "release/recorder"

Write-Host "[1/5] Clean old recorder artifacts..." -ForegroundColor Cyan
if (Test-Path "$RecorderDir/dist") { Remove-Item "$RecorderDir/dist" -Recurse -Force }
if (Test-Path $ReleaseDir) { Remove-Item $ReleaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $ReleaseDir -Force | Out-Null

Write-Host "[2/5] Build bundle..." -ForegroundColor Cyan
npm run build:bundle
$bundleExitCode = $LASTEXITCODE

if ($bundleExitCode -ne 0 -or -not (Test-Path "$RecorderDir/dist/app.bundle.cjs")) {
  Write-Host "Build bundle failed, abort packaging." -ForegroundColor Red
  exit 1
}

Write-Host "[3/5] Pack single EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"

# 用 Node 18 运行 pkg CLI，规避 Node 24 + pkg-fetch 的兼容问题
$pkgOutput = & npx -y node@18 "$RecorderDir/node_modules/pkg/lib-es5/bin.js" "$RecorderDir/dist/app.bundle.cjs" --target $pkgTarget --output "$ReleaseDir/ai-ui-recorder-trial.exe" 2>&1
$pkgExitCode = $LASTEXITCODE

if ($pkgOutput) {
  $pkgOutput | ForEach-Object { Write-Host $_ }
}

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

Write-Host "[5/5] Copy recorder assets..." -ForegroundColor Cyan
Copy-Item -Path "$RecorderDir/package.json" -Destination "$ReleaseDir/package.json" -Force
Copy-Item -Path "$RecorderDir/src/dashboard/static" -Destination "$ReleaseDir/static" -Recurse -Force

Write-Host "Build done: $ReleaseDir/ai-ui-recorder-trial.exe" -ForegroundColor Green
if ($usingLocalChromeZip) {
  Write-Host "Offline package: $ReleaseDir/ai-ui-recorder-trial.exe + $ReleaseDir/chrome-win64/" -ForegroundColor Yellow
} else {
  Write-Host "Offline package: $ReleaseDir/ai-ui-recorder-trial.exe + $ReleaseDir/ms-playwright/" -ForegroundColor Yellow
}
