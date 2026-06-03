$ErrorActionPreference = "Stop"

Write-Host "[1/3] Clean old standalone translate artifacts..." -ForegroundColor Cyan
if (Test-Path "dist/translate-standalone.bundle.cjs") {
  Remove-Item "dist/translate-standalone.bundle.cjs" -Force
}

Write-Host "[2/3] Build standalone translate bundle..." -ForegroundColor Cyan
node build/esbuild.translate-standalone.config.mjs
$bundleExitCode = $LASTEXITCODE
if ($bundleExitCode -ne 0 -or -not (Test-Path "dist/translate-standalone.bundle.cjs")) {
  Write-Host "Build standalone translate bundle failed." -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] Pack standalone translate EXE..." -ForegroundColor Cyan
$pkgTarget = "node18-win-x64"
$outputExe = "release/translate-standalone.exe"

if (-not (Test-Path "release")) {
  New-Item -ItemType Directory -Path "release" | Out-Null
}

& npx -y node@18 node_modules/pkg/lib-es5/bin.js "dist/translate-standalone.bundle.cjs" --target $pkgTarget --output $outputExe
$pkgExitCode = $LASTEXITCODE
if ($pkgExitCode -ne 0 -or -not (Test-Path $outputExe)) {
  Write-Host "Pack standalone translate EXE failed." -ForegroundColor Red
  exit 1
}

Copy-Item -Path "src/case_translate/prompts/md" -Destination "release/prompts/md" -Recurse -Force
Copy-Item -Path "src/case_translate/prompts/schema" -Destination "release/prompts/schema" -Recurse -Force
Copy-Item -Path "src/case_translate/prompts/README.md" -Destination "release/prompts/README.md" -Force

Write-Host "Build done: $outputExe" -ForegroundColor Green
Write-Host "Usage example:" -ForegroundColor Yellow
Write-Host "  .\release\translate-standalone.exe" -ForegroundColor Yellow
Write-Host "  .\release\translate-standalone.exe run_2026-03-09T12-30-07" -ForegroundColor Yellow
