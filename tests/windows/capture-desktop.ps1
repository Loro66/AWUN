param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
Get-Process -Name SONGVALE -ErrorAction SilentlyContinue |
  Select-Object Id, MainWindowTitle, Path |
  ConvertTo-Json -Compress | Set-Content -Encoding utf8 (Join-Path $OutputDirectory 'processes.json')
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bitmap.Save((Join-Path $OutputDirectory 'desktop.png'))
} finally {
  $graphics.Dispose()
  $bitmap.Dispose()
}
