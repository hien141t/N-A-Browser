$ErrorActionPreference = 'SilentlyContinue'
$wmRoot = Join-Path $env:LOCALAPPDATA 'NAdev\WMBaccaratBridge'
$exe = Join-Path $wmRoot 'WMBridge.exe'

function Test-PortOpen([int]$port) {
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect("127.0.0.1", $port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(500, $false)
        if ($ok -and $tcp.Connected) {
            $tcp.EndConnect($iar)
            $tcp.Close()
            return $true
        }
        $tcp.Close()
        return $false
    } catch {
        return $false
    }
}

if (Test-Path $exe) {
    $running = Get-Process -Name 'WMBridge' -ErrorAction SilentlyContinue
    $isListening = Test-PortOpen 48903

    if (-not $running -or -not $isListening) {
        if ($running) {
            $running | Stop-Process -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 600
        }
        # Khoi dong ngam an 100% khong tao cua so console
        Start-Process -FilePath $exe -ArgumentList '--serve' -WorkingDirectory $wmRoot -WindowStyle Hidden
    }
}
