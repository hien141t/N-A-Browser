$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Security

$wmRoot = Join-Path $env:LOCALAPPDATA 'NAdev\WMBaccaratBridge'
$sessionFile = Join-Path $wmRoot 'session.dpapi'
$entropy = [System.Text.Encoding]::UTF8.GetBytes("NAdev.WMBaccaratBridge.v2")

$bridgeAuthToken = ""
if (Test-Path $sessionFile) {
    try {
        $encrypted = [System.IO.File]::ReadAllBytes($sessionFile)
        $decrypted = [System.Security.Cryptography.ProtectedData]::Unprotect(
            $encrypted,
            $entropy,
            [System.Security.Cryptography.DataProtectionScope]::CurrentUser
        )
        $bridgeAuthToken = [System.Text.Encoding]::UTF8.GetString($decrypted).Trim()
    } catch {
        Write-Host ">>> Không thể giải mã session.dpapi: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

$body = @{ action = 'status' } | ConvertTo-Json
$headers = @{
    'X-Bridge-Auth' = $bridgeAuthToken
}

try {
    $res = Invoke-RestMethod -Uri 'http://127.0.0.1:48903/bridge' -Method Post -Body $body -ContentType 'application/json' -Headers $headers
    Write-Host ">>> KẾT QUẢ KIỂM TRA TRẠNG THÁI BẢN QUYỀN MÁY:" -ForegroundColor Cyan
    $res | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
            $errBody = $reader.ReadToEnd()
            Write-Host ">>> PHẢN HỒI TỪ LOCAL BRIDGE (HTTP $([int]$_.Exception.Response.StatusCode)):" -ForegroundColor Yellow
            Write-Host $errBody
        } catch {
            Write-Host ">>> Lỗi kết nối tới Local Bridge: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host ">>> Lỗi kết nối tới Local Bridge: $($_.Exception.Message)" -ForegroundColor Red
    }
}
