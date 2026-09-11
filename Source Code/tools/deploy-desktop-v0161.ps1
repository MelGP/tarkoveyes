$ErrorActionPreference = 'Stop'

$releaseRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$targetRoot = [IO.Path]::GetFullPath('C:\Users\lagmy\Desktop\tarkov')
$incoming = [IO.Path]::GetFullPath((Join-Path $targetRoot '.incoming-v0.16.1'))
$backup = [IO.Path]::GetFullPath((Join-Path $targetRoot ('Backups\RaidNotes-v0.16.0-before-v0.16.1-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))))
$targetPrefix = $targetRoot.TrimEnd('\') + '\'

function Assert-TargetChild([string]$Path) {
  $full = [IO.Path]::GetFullPath($Path)
  if (-not $full.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing filesystem operation outside the Tarkov folder: $full"
  }
  return $full
}

foreach ($path in @($incoming, $backup, (Join-Path $targetRoot 'App'), (Join-Path $targetRoot 'Source Code'), (Join-Path $targetRoot 'Documentation'))) {
  [void](Assert-TargetChild $path)
}

$packagedApp = Join-Path $releaseRoot 'dist\RaidNotes-win32-x64'
if (-not (Test-Path -LiteralPath (Join-Path $packagedApp 'RaidNotes.exe'))) { throw 'Packaged executable is missing.' }
$packagedManifest = Get-Content -LiteralPath (Join-Path $packagedApp 'resources\app\package.json') -Raw | ConvertFrom-Json
if ($packagedManifest.version -ne '0.16.1') { throw "Unexpected packaged version: $($packagedManifest.version)" }

if (Test-Path -LiteralPath $incoming) { Remove-Item -LiteralPath $incoming -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $incoming 'App'), (Join-Path $incoming 'Source Code'), (Join-Path $incoming 'Documentation') -Force | Out-Null
Get-ChildItem -LiteralPath $packagedApp -Force | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $incoming 'App') -Recurse -Force
}

foreach ($directory in @('app', 'licenses', 'test', 'tools')) {
  Copy-Item -LiteralPath (Join-Path $releaseRoot $directory) -Destination (Join-Path $incoming 'Source Code') -Recurse -Force
}
foreach ($file in @('core.cjs', 'items.cjs', 'LICENSE', 'main.cjs', 'package-lock.json', 'package.json', 'preload.cjs', 'preview.cjs', 'README.md', 'THIRD-PARTY.md', 'VERIFICATION.md')) {
  Copy-Item -LiteralPath (Join-Path $releaseRoot $file) -Destination (Join-Path $incoming 'Source Code') -Force
}
foreach ($file in @('LICENSE', 'README.md', 'THIRD-PARTY.md', 'VERIFICATION.md')) {
  Copy-Item -LiteralPath (Join-Path $releaseRoot $file) -Destination (Join-Path $incoming 'Documentation') -Force
}
Copy-Item -LiteralPath (Join-Path $releaseRoot 'dist\SHA256.json') -Destination (Join-Path $incoming 'Documentation\SHA256.json') -Force

$incomingManifest = Get-Content -LiteralPath (Join-Path $incoming 'App\resources\app\package.json') -Raw | ConvertFrom-Json
$sourceManifest = Get-Content -LiteralPath (Join-Path $incoming 'Source Code\package.json') -Raw | ConvertFrom-Json
if ($incomingManifest.version -ne '0.16.1' -or $sourceManifest.version -ne '0.16.1') { throw 'Unable to validate the staged release.' }
foreach ($required in @('App\resources\app\app\data\quests-seasonal.json', 'App\resources\app\app\data\special-tracks.json', 'App\resources\app\app\assets\loot\categories\valuables.webp')) {
  if (-not (Test-Path -LiteralPath (Join-Path $incoming $required))) { throw "Missing staged release file: $required" }
}

Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue | Stop-Process -Force
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if (-not (Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 200
}
if (Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue) { throw 'Raid Notes did not stop before deployment.' }

New-Item -ItemType Directory -Path $backup -Force | Out-Null
foreach ($name in @('App', 'Source Code', 'Documentation')) {
  $current = Join-Path $targetRoot $name
  if (Test-Path -LiteralPath $current) { Copy-Item -LiteralPath $current -Destination $backup -Recurse -Force }
}
if (Test-Path -LiteralPath (Join-Path $targetRoot 'OPEN THIS.txt')) {
  Copy-Item -LiteralPath (Join-Path $targetRoot 'OPEN THIS.txt') -Destination $backup -Force
}

foreach ($name in @('App', 'Source Code', 'Documentation')) {
  $current = Assert-TargetChild (Join-Path $targetRoot $name)
  if (Test-Path -LiteralPath $current) { Remove-Item -LiteralPath $current -Recurse -Force }
  Move-Item -LiteralPath (Join-Path $incoming $name) -Destination $targetRoot -Force
}
Remove-Item -LiteralPath $incoming -Recurse -Force

$openThis = @'
RAID NOTES 0.16.1

Double-click: START RAID NOTES

App           = application files
Source Code   = project source code
Backups       = previous versions kept for recovery
Documentation = information and verification files

Your quest progress is stored separately by Windows and was preserved.
'@
Set-Content -LiteralPath (Join-Path $targetRoot 'OPEN THIS.txt') -Value $openThis -Encoding UTF8

$installedManifest = Get-Content -LiteralPath (Join-Path $targetRoot 'App\resources\app\package.json') -Raw | ConvertFrom-Json
if ($installedManifest.version -ne '0.16.1') { throw 'Installed version validation failed.' }
$process = Start-Process -FilePath (Join-Path $targetRoot 'App\RaidNotes.exe') -WorkingDirectory (Join-Path $targetRoot 'App') -WindowStyle Hidden -PassThru
Start-Sleep -Seconds 3
if ($process.HasExited) { throw "Raid Notes exited immediately with code $($process.ExitCode)." }

[pscustomobject]@{
  Version = $installedManifest.version
  ProcessId = $process.Id
  Backup = $backup
  ProgressFile = Join-Path $env:APPDATA 'RaidNotes\local-data\progress.json'
} | ConvertTo-Json
