# renew-session.ps1 — Ejecutar cuando GitHub avise que la sesion vencio (~1 vez por mes)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location $dir

Write-Host "`n=== RENOVAR SESION PAGO NUBE ===" -ForegroundColor Cyan
Write-Host "Abriendo browser para login con 2FA..." -ForegroundColor Yellow
node transfer.js --setup

Write-Host "`nSubiendo nueva sesion a GitHub..." -ForegroundColor Yellow
$sessionB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes("$dir\session.json"))
$env:GH_TOKEN = (Get-Content "$dir\.gh_token" -ErrorAction SilentlyContinue)
& "C:\Program Files\GitHub CLI\gh.exe" secret set TN_SESSION --body $sessionB64 --repo viken-home/pagonube-autotransfer

Write-Host "`n✓ Sesion renovada. El workflow automatico sigue corriendo." -ForegroundColor Green
