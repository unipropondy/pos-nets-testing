Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\admin\.gemini\antigravity-ide\brain\69c5a893-41b9-4047-b53f-e8f76db046c6\.user_uploaded\media_1791990815232.jpg"
$img = [System.Drawing.Image]::FromFile($srcPath)

# 1. Save PNG versions (1024x1024)
$pngPaths = @(
    "c:\Users\admin\POS-v-2.0\electron\icon.png",
    "c:\Users\admin\POS-v-2.0\frontend\assets\images\logo_pos.png"
)

foreach ($p in $pngPaths) {
    $parent = Split-Path -Parent $p
    if (!(Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $img.Save($p, [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Host "Saved PNG to $p"
}

# 2. Build Multi-Resolution Windows .ICO file
# Sizes: 256, 128, 64, 48, 32, 16
$sizes = @(256, 128, 64, 48, 32, 16)
$pngStreams = @()

foreach ($sz in $sizes) {
    $resized = New-Object System.Drawing.Bitmap($sz, $sz)
    $g = [System.Drawing.Graphics]::FromImage($resized)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $sz, $sz)
    $g.Dispose()

    $ms = New-Object System.IO.MemoryStream
    $resized.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngStreams += @{ Size = $sz; Bytes = $ms.ToArray() }
    $ms.Dispose()
    $resized.Dispose()
}

$img.Dispose()

# Create .ico binary structure
$icoMs = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($icoMs)

# ICONDIR
$bw.Write([uint16]0) # Reserved
$bw.Write([uint16]1) # Type (1 = ICO)
$bw.Write([uint16]$pngStreams.Count) # Image count

$offset = 6 + (16 * $pngStreams.Count)

foreach ($entry in $pngStreams) {
    $w = if ($entry.Size -eq 256) { 0 } else { [byte]$entry.Size }
    $h = if ($entry.Size -eq 256) { 0 } else { [byte]$entry.Size }
    $bw.Write([byte]$w)            # Width
    $bw.Write([byte]$h)            # Height
    $bw.Write([byte]0)             # Color count (0 = no palette)
    $bw.Write([byte]0)             # Reserved
    $bw.Write([uint16]1)           # Color planes
    $bw.Write([uint16]32)          # Bits per pixel
    $bw.Write([uint32]$entry.Bytes.Length) # Image size in bytes
    $bw.Write([uint32]$offset)     # Offset of image data
    $offset += $entry.Bytes.Length
}

# Write PNG payloads
foreach ($entry in $pngStreams) {
    $bw.Write($entry.Bytes)
}

$bw.Flush()
$icoBytes = $icoMs.ToArray()
$bw.Close()
$icoMs.Dispose()

$icoPaths = @(
    "c:\Users\admin\POS-v-2.0\installer-output\.icon-ico\icon.ico",
    "c:\Users\admin\POS-v-2.0\installer-build\icon.ico"
)

foreach ($ip in $icoPaths) {
    $parent = Split-Path -Parent $ip
    if (!(Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllBytes($ip, $icoBytes)
    Write-Host "Saved ICO to $ip (Size: $($icoBytes.Length) bytes)"
}

Write-Host "Icon generation completed successfully!"
