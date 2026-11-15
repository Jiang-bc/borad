param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Start', 'CopyAddress', 'CopyPassword')]
  [string]$Action
)

$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$addressFile = Join-Path $projectDir 'tunnel-address.txt'

Add-Type -AssemblyName System.Windows.Forms
function Show-Message([string]$Message) {
  [System.Windows.Forms.MessageBox]::Show($Message, 'Magpie Dashboard') | Out-Null
}

try {
  if ($Action -eq 'Start') {
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 3 } catch { $health = $null }
    if ($health.instance -eq 'magpie-dashboard-managed-v1') {
      Show-Message 'Dashboard is already running.'
      return
    }
    if (Get-NetTCPConnection -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 8790 is already in use. Stop the other service first.' }
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $projectDir 'dashboard-background.cjs') + '"') -WorkingDirectory $projectDir -WindowStyle Hidden
    Show-Message 'Dashboard and public tunnel are starting. Wait a few seconds, then use Copy Address.'
  } elseif ($Action -eq 'CopyAddress') {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -TimeoutSec 3
    if ($health.instance -ne 'magpie-dashboard-managed-v1') { throw 'The managed dashboard is not running.' }
    $address = (Get-Content -LiteralPath $addressFile -Raw).Trim()
    if ($address -notmatch '^https://[a-z0-9-]+\.trycloudflare\.com$') { throw 'Public address is not ready.' }
    Set-Clipboard -Value $address
    Show-Message 'Public address copied to clipboard.'
  } else {
    $credentialsFile = Join-Path $env:LOCALAPPDATA 'MagpieDashboard\credentials.json'
    if (Test-Path -LiteralPath $credentialsFile) { throw 'A custom password is set. Enter the password you chose.' }
    Set-Clipboard -Value 'jbc'
    Show-Message 'Dashboard password copied to clipboard.'
  }
} catch {
  Show-Message $_.Exception.Message
}
