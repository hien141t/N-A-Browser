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

# 1. Load source bitmap and resize to standard 256x256 px
$srcBmp = [System.Drawing.Bitmap]::FromFile($baseIconPath)
$bmp = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# Draw resized base icon
$g.DrawImage($srcBmp, 0, 0, 256, 256)
$srcBmp.Dispose()

# 2. Draw profile number badge at bottom-center
$badgeWidth = 140
if ($profileNum -ge 100) { $badgeWidth = 160 }
$badgeHeight = 52
$badgeX = [int]((256 - $badgeWidth) / 2)
$badgeY = 192
$rect = New-Object System.Drawing.Rectangle($badgeX, $badgeY, $badgeWidth, $badgeHeight)

$path = New-Object System.Drawing.Drawing2D.GraphicsPath
$radius = 20
$path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
$path.AddArc($rect.Right - $radius, $rect.Y, $radius, $radius, 270, 90)
$path.AddArc($rect.Right - $radius, $rect.Bottom - $radius, $radius, $radius, 0, 90)
$path.AddArc($rect.X, $rect.Bottom - $radius, $radius, $radius, 90, 90)
$path.CloseFigure()

$brushBg = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(240, 10, 10, 36))
$penBorder = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 240, 255), 3.5)
$g.FillPath($brushBg, $path)
$g.DrawPath($penBorder, $path)

# Text #profileNum
$fontSize = 24
if ($profileNum -ge 100) { $fontSize = 20 }
$font = New-Object System.Drawing.Font("Arial", $fontSize, [System.Drawing.FontStyle]::Bold)
$brushText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
$sf = New-Object System.Drawing.StringFormat
$sf.Alignment = [System.Drawing.StringAlignment]::Center
$sf.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("#$profileNum", $font, $brushText, [System.Drawing.RectangleF]$rect, $sf)

$g.Dispose()

# 3. Save standard 256x256 PNG
$bmp.Save($pngPath, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

# 4. Wrap into standard Windows ICO (256x256 PNG-based ICO)
$pngBytes = [System.IO.File]::ReadAllBytes($pngPath)
$icoHeader = [byte[]]::new(22)
# ICONDIR (6 bytes)
$icoHeader[0] = 0
$icoHeader[1] = 0
$icoHeader[2] = 1 # idType: 1 = Icon
$icoHeader[3] = 0
$icoHeader[4] = 1 # idCount: 1 image
$icoHeader[5] = 0

# ICONDIRENTRY (16 bytes)
$icoHeader[6] = 0 # bWidth: 0 specifies 256px
$icoHeader[7] = 0 # bHeight: 0 specifies 256px
$icoHeader[8] = 0 # bColorCount: 0 (>=8bpp)
$icoHeader[9] = 0 # bReserved
$icoHeader[10] = 1 # wPlanes: 1
$icoHeader[11] = 0
$icoHeader[12] = 32 # wBitCount: 32 bpp
$icoHeader[13] = 0

# dwBytesInRes (4 bytes)
$sizeBytes = [System.BitConverter]::GetBytes([int]$pngBytes.Length)
[System.Array]::Copy($sizeBytes, 0, $icoHeader, 14, 4)

# dwImageOffset (4 bytes) = 22
$offsetBytes = [System.BitConverter]::GetBytes([int]22)
[System.Array]::Copy($offsetBytes, 0, $icoHeader, 18, 4)

# Combine header + pngBytes
$fullIcoBytes = [byte[]]::new(22 + $pngBytes.Length)
[System.Array]::Copy($icoHeader, 0, $fullIcoBytes, 0, 22)
[System.Array]::Copy($pngBytes, 0, $fullIcoBytes, 22, $pngBytes.Length)

[System.IO.File]::WriteAllBytes($icoPath, $fullIcoBytes)

# 5. Create Start Menu Shortcut
try {
    $shortcutDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\N-A Browser Profiles"
    New-Item -ItemType Directory -Path $shortcutDir -Force | Out-Null
    $shortcutPath = Join-Path $shortcutDir "N-A Browser #$profileNum.lnk"

    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($shortcutPath)
    if ($chromeBin -and (Test-Path $chromeBin)) {
        $sc.TargetPath = $chromeBin
    } else {
        # Fallback to current browser if available
        $defaultChrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
        if (Test-Path $defaultChrome) {
            $sc.TargetPath = $defaultChrome
        } else {
            $sc.TargetPath = $baseIconPath
        }
    }
    $sc.Arguments = "--app-id=NABrowser.Profile.$profileNum"
    $sc.IconLocation = "$icoPath,0"
    $sc.Description = "N/A Browser Profile #$profileNum"
    $sc.Save()
} catch {}

# 6. Generate circular avatar badge (for Chrome native overlay badge)
try {
    $badgePngPath = Join-Path $outputDir "badge_$profileNum.png"
    $badgeBmp = New-Object System.Drawing.Bitmap(256, 256, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gb = [System.Drawing.Graphics]::FromImage($badgeBmp)
    $gb.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $gb.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

    $brushCircle = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 10, 10, 36))
    $penCircle = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 0, 240, 255), 18)
    $gb.FillEllipse($brushCircle, 12, 12, 232, 232)
    $gb.DrawEllipse($penCircle, 12, 12, 232, 232)

    $numText = "#$profileNum"
    $fontBadgeSize = if ($profileNum -ge 100) { 70 } elseif ($profileNum -ge 10) { 82 } else { 96 }
    $fontBadge = New-Object System.Drawing.Font("Arial", $fontBadgeSize, [System.Drawing.FontStyle]::Bold)
    $brushBadgeText = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0, 240, 255))
    $sfBadge = New-Object System.Drawing.StringFormat
    $sfBadge.Alignment = [System.Drawing.StringAlignment]::Center
    $sfBadge.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rectBadge = New-Object System.Drawing.RectangleF(0, 0, 256, 256)
    $gb.DrawString($numText, $fontBadge, $brushBadgeText, $rectBadge, $sfBadge)

    $gb.Dispose()
    $badgeBmp.Save($badgePngPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $badgeBmp.Dispose()
} catch {}

Write-Output "SUCCESS: $icoPath (Size: $($fullIcoBytes.Length) bytes)"
