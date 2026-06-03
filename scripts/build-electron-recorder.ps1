$ErrorActionPreference = "Stop"

Write-Host "[1/3] Clean old launcher artifacts..." -ForegroundColor Cyan
if (Test-Path "dist/electron-recorder.bundle.cjs") {
  Remove-Item "dist/electron-recorder.bundle.cjs" -Force
}

Write-Host "[2/3] Build launcher bundle..." -ForegroundColor Cyan
node build/esbuild.electron-recorder.config.mjs
$bundleExitCode = $LASTEXITCODE
if ($bundleExitCode -ne 0 -or -not (Test-Path "dist/electron-recorder.bundle.cjs")) {
  Write-Host "Build launcher bundle failed." -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] Pack launcher EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"
$outputExe = "release/electron-recorder-launcher.exe"

if (-not (Test-Path "release")) {
  New-Item -ItemType Directory -Path "release" | Out-Null
}

& npx -y node@18 node_modules/pkg/lib-es5/bin.js "dist/electron-recorder.bundle.cjs" --target $pkgTarget --output $outputExe
$pkgExitCode = $LASTEXITCODE
if ($pkgExitCode -ne 0 -or -not (Test-Path $outputExe)) {
  Write-Host "Pack launcher EXE failed." -ForegroundColor Red
  exit 1
}

Write-Host "Build done: $outputExe" -ForegroundColor Green
Write-Host "Usage example:" -ForegroundColor Yellow
Write-Host "  .\release\electron-recorder-launcher.exe `"C:\path\to\your-electron-app.exe`"" -ForegroundColor Yellow
