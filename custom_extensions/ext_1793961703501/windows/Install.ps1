# Windows PowerShell 5.1 / .NET Framework. No administrator privileges required.
param(
    [string]$Key = ""
)
$ErrorActionPreference = 'Stop'

try {
    $settingsFile = Join-Path $PSScriptRoot 'install-settings.json'
    if (-not (Test-Path $settingsFile)) {
        throw "Khong tim thay file cau hinh install-settings.json."
    }
    $settings = Get-Content -Raw $settingsFile | ConvertFrom-Json
    $api = [Uri]$settings.api_url
    if ($api.Scheme -ne 'https' -or ($api.Host -ne 'powerai.duckdns.org' -and $api.Host -ne 'nadev2026.duckdns.org')) {
        throw "API URL khong hop le (bat buoc https://powerai.duckdns.org)."
    }

    $wmRoot = Join-Path $env:LOCALAPPDATA 'NAdev\WMBaccaratBridge'
    New-Item -ItemType Directory -Force -Path $wmRoot | Out-Null

    $exe = Join-Path $wmRoot 'WMBridge.exe'
    
    # 1. Dung tien trinh WMBridge.exe cu neu dang chay
    $runningProcs = Get-Process -Name 'WMBridge' -ErrorAction SilentlyContinue
    if ($runningProcs) {
        $runningProcs | Stop-Process -Force -ErrorAction SilentlyContinue
        $runningProcs | Wait-Process -Timeout 5 -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 600
    }

    # 2. Xoa file cu (voi vong lap retry tranh loi Access Denied do file lock chua kip nha)
    if (Test-Path $exe) {
        $deleted = $false
        for ($i = 0; $i -lt 10; $i++) {
            try {
                Remove-Item -LiteralPath $exe -Force -ErrorAction Stop
                $deleted = $true
                break
            } catch {
                Start-Sleep -Milliseconds 500
            }
        }
        if (-not $deleted -and (Test-Path $exe)) {
            $oldExe = Join-Path $wmRoot ("WMBridge_old_" + [Guid]::NewGuid().ToString("N") + ".exe")
            Move-Item -LiteralPath $exe -Destination $oldExe -Force -ErrorAction SilentlyContinue
        }
    }

    $prebuiltExe = Join-Path $PSScriptRoot 'WMBridge.exe'
    if (Test-Path $prebuiltExe) {
        Write-Host ">>> Dang cai dat bo xac thuc phan cung N/A DEV Native Bridge..." -ForegroundColor Cyan
        Copy-Item -LiteralPath $prebuiltExe -Destination $exe -Force
    } else {
        Write-Host ">>> Dang bien dich bo xac thuc phan cung N/A DEV Native Bridge..." -ForegroundColor Cyan
        $bridgeCsPath = Join-Path $PSScriptRoot 'Bridge.cs'
        $source = [System.IO.File]::ReadAllText($bridgeCsPath, [System.Text.Encoding]::UTF8)
        $tempBuildExe = Join-Path $env:TEMP ('WMBridge_build_' + [Guid]::NewGuid().ToString('N') + '.exe')
        Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $tempBuildExe -OutputType ConsoleApplication -ReferencedAssemblies @('System.dll', 'System.Core.dll', 'System.Security.dll', 'System.Web.Extensions.dll')
        Copy-Item -LiteralPath $tempBuildExe -Destination $exe -Force
        Remove-Item -LiteralPath $tempBuildExe -Force -ErrorAction SilentlyContinue
    }

    $settings | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $wmRoot 'settings.json') -Encoding UTF8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'StartBridge.ps1') -Destination $wmRoot -Force

    # Chay kich hoat key voi VPS khong de lo secret tren command line
    if ($Key -and $Key.Trim()) {
        $env:WM_LICENSE_KEY = $Key.Trim()
    }
    try {
        & $exe --activate
    } finally {
        $env:WM_LICENSE_KEY = $null
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Kich hoat khong thanh cong. Vui long kiem tra lai ma Key, ket noi mang hoac lien he Admin."
    }

    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if ($settings.localhost_fallback) {
        New-Item -Path $runKey -Force | Out-Null
        $startScript = Join-Path $wmRoot 'StartBridge.ps1'
        $startCommand = 'powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $startScript + '"'
        New-ItemProperty -Path $runKey -Name 'NAdevWMBaccaratBridge' -Value $startCommand -PropertyType String -Force | Out-Null
        & $startScript
    }

    # Dang ky Chrome & Edge Native Messaging Host (chuan Fantan)
    try {
        $manifestJson = Join-Path $wmRoot 'com.nadev.wmbaccarat.json'
        $allowedOrigins = @(
            "chrome-extension://$($settings.extension_id)/"
        )
        if ($settings.allowed_extension_ids) {
            foreach ($extId in $settings.allowed_extension_ids) {
                $allowedOrigins += "chrome-extension://$extId/"
            }
        }
        $allowedOrigins = $allowedOrigins | Select-Object -Unique

        $manifestObj = [ordered]@{
            name = "com.nadev.wmbaccarat"
            description = "NAdev WM Baccarat Windows identity bridge"
            path = $exe
            type = "stdio"
            allowed_origins = $allowedOrigins
        }
        $manifestObj | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestJson -Encoding UTF8

        $nmChromeKey = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.nadev.wmbaccarat'
        New-Item -Path $nmChromeKey -Force | Out-Null
        Set-ItemProperty -Path $nmChromeKey -Name '(Default)' -Value $manifestJson -Force | Out-Null

        $nmEdgeKey = 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.nadev.wmbaccarat'
        New-Item -Path $nmEdgeKey -Force | Out-Null
        Set-ItemProperty -Path $nmEdgeKey -Name '(Default)' -Value $manifestJson -Force | Out-Null
    } catch {
        # Bo qua neu trinh duyet khong cai dat hoac khong can thiet
    }

    Write-Host ""
    Write-Host ">>> KICH HOAT THANH CONG! Dich vu xac thuc ngam da tu khoi dong." -ForegroundColor Green
    Write-Host ">>> Ban co the mo bat ky profile Chrome / Hide / Anti-detect nao tren may nay." -ForegroundColor Green
    exit 0
} catch {
    Write-Host ""
    Write-Host ">>> [LOI]: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
