param(
    [string]$baseIconPath = "D:\NABrowser\cloakdroid-app\assets\icon.png",
    [int]$profileNum = 1,
    [string]$outputDir = "D:\NABrowser\cloakdroid-app\profile_icons",
    [string]$chromeBin = ""
)

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null

$pngPath = Join-Path $outputDir "profile_$profileNum.png"
$icoPath = Join-Path $outputDir "profile_$profileNum.ico"

$bmp = [System.Drawing.Bitmap]::FromFile($baseIconPath)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

$rect = New-Object System.Drawing.Rectangle(36, 160, 184, 80)
$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 24
$path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
$path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
$path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()

$brushBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(245, 10, 10, 36))
$penBorder = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 6, 214, 160), 4)
$g.FillPath($brushBg, $path)
$g.DrawPath($penBorder, $path)

$font = New-Object System.Drawing.Font("Arial", 28, [System.Drawing.FontStyle]::Bold)
$brushText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("#$profileNum", $font, $brushText, [System.Drawing.RectangleF]$rect, $sf)

$g.Dispose()
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# Wrap into standard ICO
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoHeader = [byte[]]::new(22)
$icoHeader[2] = 1
$icoHeader[4] = 1
$icoHeader[6] = 0
$icoHeader[7] = 0
$icoHeader[10] = 1
$icoHeader[12] = 32
$sizeBytes = [System.BitConverter]::GetBytes([int]$pngBytes.Length)
[System.Array]::Copy($sizeBytes, 0, $icoHeader, 14, 4)
$offsetBytes = [System.BitConverter]::GetBytes([int]22)
[System.Array]::Copy($offsetBytes, 0, $icoHeader, 18, 4)

$fullIcoBytes = [byte[]]::new(22 + $pngBytes.Length)
[System.Array]::Copy($icoHeader, 0, $fullIcoBytes, 0, 22)
[System.Array]::Copy($pngBytes, 0, $fullIcoBytes, 22, $pngBytes.Length)

[System.IO.File]::WriteAllBytes($icoPath, $fullIcoBytes)

# Create Start Menu Shortcut
try {
    $shortcutDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\N-A Browser Profiles"
    New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
    $shortcutPath = Join-Path $shortcutDir "N-A Browser #$profileNum.lnk"

    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcutPath)
    if ($chromeBin -and (Test-Path $chromeBin)) {
        $sc.TargetPath = $chromeBin
    } else {
        $sc.TargetPath = "cmd.exe"
    }
    $sc.Arguments = "--app-id=NABrowser.Profile.$profileNum"
    $sc.IconLocation = "$icoPath,0"
    $sc.Save()
} catch {}

Write-Output "SUCCESS: $icoPath"
