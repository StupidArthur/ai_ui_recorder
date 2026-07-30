$ErrorActionPreference = "Stop"

Write-Host "Test 1: hardcoded"
$RecorderDir = "G:\github\ai_ui_recorder\recorder"
Write-Host "RecorderDir=$RecorderDir"

Write-Host "Test 2: Split-Path"
$test = Split-Path $PSScriptRoot -Parent
Write-Host "test=$test"

Write-Host "Test 3: Get-Item"
$test2 = (Get-Item $PSScriptRoot).Parent.FullName
Write-Host "test2=$test2"
