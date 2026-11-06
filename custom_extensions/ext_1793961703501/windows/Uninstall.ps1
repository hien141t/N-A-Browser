$ErrorActionPreference = 'SilentlyContinue'
$wmRoot = Join-Path $env:LOCALAPPDATA 'NAdev\WMBaccaratBridge'
$exe = Join-Path $wmRoot 'WMBridge.exe'

Get-CimInstance Win32_Process -Filter "Name='WMBridge.exe'" | Where-Object { $_.ExecutablePath -eq $exe } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'NAdevWMBaccaratBridge' -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nadev.wmbaccarat' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nadev.wmbaccarat' -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $wmRoot) {
    Remove-Item -LiteralPath $wmRoot -Recurse -Force
}
Write-Host ">>> Da go bo toan bo du lieu WM License Bridge khoi may tinh thanh cong." -ForegroundColor Yellow
