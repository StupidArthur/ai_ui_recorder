$ErrorActionPreference = "Stop"

# 工程根目录 = scripts/ 上一级 = recorder/
$ProjectRoot = Split-Path $PSScriptRoot -Parent

# TODO: build/esbuild.electron-recorder.config.mjs 目前不存在,
#       src/recorder/electron-cli.js 入口的打包约定也待核实。
#       本脚本处于"路径已对齐新布局,配置待补"状态,实际打包前需要先补 esbuild 配置。

Write-Host "[1/3] Clean old launcher artifacts..." -ForegroundColor Cyan
if (Test-Path "$ProjectRoot/dist/electron-recorder.bundle.cjs") {
  Remove-Item "$ProjectRoot/dist/electron-recorder.bundle.cjs" -Force
}

Write-Host "[2/3] Build launcher bundle..." -ForegroundColor Cyan
node "$ProjectRoot/build/esbuild.electron-recorder.config.mjs"
$bundleExitCode = $LASTEXITCODE
if ($bundleExitCode -ne 0 -or -not (Test-Path "$ProjectRoot/dist/electron-recorder.bundle.cjs")) {
  Write-Host "Build launcher bundle failed." -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] Pack launcher EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"
$outputExe = "$ProjectRoot/release/electron-recorder-launcher.exe"

if (-not (Test-Path "$ProjectRoot/release")) {
  New-Item -ItemType Directory -Path "$ProjectRoot/release" | Out-Null
}

& npx -y node@18 "$ProjectRoot/node_modules/pkg/lib-es5/bin.js" "$ProjectRoot/dist/electron-recorder.bundle.cjs" --target $pkgTarget --output $outputExe
$pkgExitCode = $LASTEXITCODE
if ($pkgExitCode -ne 0 -or -not (Test-Path $outputExe)) {
  Write-Host "Pack launcher EXE failed." -ForegroundColor Red
  exit 1
}

Write-Host "Build done: $outputExe" -ForegroundColor Green
Write-Host "Usage example:" -ForegroundColor Yellow
Write-Host "  .\release\electron-recorder-launcher.exe `"C:\path\to\your-electron-app.exe`"" -ForegroundColor Yellow
