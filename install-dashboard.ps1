$ErrorActionPreference = 'Stop'
$projectDir = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction Stop).Source
$powershell = (Get-Command pwsh.exe -ErrorAction Stop).Source
$startup = [Environment]::GetFolderPath('Startup')
$desktop = [Environment]::GetFolderPath('Desktop')
$stateDir = Join-Path $env:LOCALAPPDATA 'MagpieDashboard'
$startupFile = Join-Path $startup 'MagpieDashboard-AutoOpen.vbs'
$background = Join-Path $projectDir 'dashboard-background.cjs'
$actions = Join-Path $projectDir 'dashboard-actions.ps1'
New-Item -ItemType Directory -Path $stateDir -Force | Out-Null

if (Test-Path -LiteralPath $startupFile) {
  $oldStartup = Get-Content -LiteralPath $startupFile -Raw
  if ($oldStartup -notmatch 'magpie-requests\\auto-open\.cjs' -and $oldStartup -notmatch [regex]::Escape($background)) {
    throw "Existing startup file is not recognized: $startupFile"
  }
  if ($oldStartup -match 'magpie-requests\\auto-open\.cjs') {
    Copy-Item -LiteralPath $startupFile -Destination (Join-Path $stateDir 'previous-startup.vbs.bak') -Force
  }
}

$startupContent = @"
Set shell = CreateObject("WScript.Shell")
shell.Run """$node"" ""$background""", 0, False
"@
[System.IO.File]::WriteAllText($startupFile, $startupContent, [System.Text.Encoding]::Default)

$shell = New-Object -ComObject WScript.Shell
$shortcuts = @{
  'Magpie - Start.lnk' = 'Start'
  'Magpie - Copy Address.lnk' = 'CopyAddress'
  'Magpie - Copy Password.lnk' = 'CopyPassword'
}
foreach ($name in $shortcuts.Keys) {
  $shortcut = $shell.CreateShortcut((Join-Path $desktop $name))
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $actions + '" -Action ' + $shortcuts[$name]
  $shortcut.WorkingDirectory = $projectDir
  $shortcut.WindowStyle = 7
  $shortcut.Save()
}

$oldTask = Get-ScheduledTask -TaskName 'MagpieUsage-Guard-148c37bb85c1' -ErrorAction SilentlyContinue
if ($oldTask -and ($oldTask.Actions.Arguments -match 'magpie-requests\\guard-launch\.vbs')) {
  Disable-ScheduledTask -InputObject $oldTask | Out-Null
}
Write-Output 'Startup entry and desktop shortcuts installed.'
