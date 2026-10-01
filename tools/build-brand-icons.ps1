# Converts the brand artwork into a Windows ICO, unchanged framing (no crop, no redraw).
# The source picture is the product icon; this script only resamples it and repackages
# the same image into the ICO container the OS requires. ASCII-only: Windows PowerShell 5.1.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-brand-icons.ps1
param(
    [int[]]$IcoSizes = @(16, 24, 32, 48, 64, 128, 256)
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$repo = Split-Path -Parent $PSScriptRoot
$lockup = Join-Path $repo "apps/desktop/src/renderer/src/assets/brand/mochen-lockup.jpg"
$resources = Join-Path $repo "apps/desktop/resources"
if (-not (Test-Path $lockup)) { throw "missing source artwork: $lockup" }
New-Item -ItemType Directory -Force -Path $resources | Out-Null

function Resample([System.Drawing.Image]$source, [int]$side) {
    $bmp = New-Object System.Drawing.Bitmap $side, $side, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.DrawImage($source, (New-Object System.Drawing.Rectangle 0, 0, $side, $side), (New-Object System.Drawing.Rectangle 0, 0, $source.Width, $source.Height), [System.Drawing.GraphicsUnit]::Pixel)
    $g.Dispose()
    return $bmp
}

$src = [System.Drawing.Image]::FromFile($lockup)
try {
    $pngParts = @()
    foreach ($size in $IcoSizes) {
        $scaled = Resample $src $size
        $ms = New-Object System.IO.MemoryStream
        $scaled.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $scaled.Dispose()
        $pngParts += , $ms.ToArray()
        $ms.Dispose()
    }
} finally { $src.Dispose() }

# ICO with PNG-compressed entries (Vista+). Width/height byte 0 means 256.
$writer = New-Object System.IO.BinaryWriter ([System.IO.File]::Create((Join-Path $resources "icon.ico")))
try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$pngParts.Count)
    $offset = 6 + 16 * $pngParts.Count
    for ($i = 0; $i -lt $pngParts.Count; $i++) {
        $bytes = $pngParts[$i]
        $dim = $IcoSizes[$i]
        $writer.Write([byte]($(if ($dim -ge 256) { 0 } else { $dim })))
        $writer.Write([byte]($(if ($dim -ge 256) { 0 } else { $dim })))
        $writer.Write([byte]0); $writer.Write([byte]0)
        $writer.Write([uint16]1); $writer.Write([uint16]32)
        $writer.Write([uint32]$bytes.Length); $writer.Write([uint32]$offset)
        $offset += $bytes.Length
    }
    foreach ($bytes in $pngParts) { $writer.Write($bytes) }
} finally { $writer.Dispose() }

Write-Host "ico -> $resources\icon.ico ($($pngParts.Count) sizes, full artwork, uncropped)"
