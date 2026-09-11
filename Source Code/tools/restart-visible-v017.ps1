$ErrorActionPreference = 'Stop'

$exe = 'C:\Users\lagmy\Desktop\tarkov\App\RaidNotes.exe'
$work = Split-Path -Parent $exe
if (-not (Test-Path -LiteralPath $exe)) { throw 'Raid Notes executable is missing.' }

Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue | Stop-Process -Force
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  if (-not (Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 200
}
if (Get-Process -Name 'RaidNotes' -ErrorAction SilentlyContinue) { throw 'Raid Notes did not stop before restart.' }

$process = Start-Process -FilePath $exe -WorkingDirectory $work -PassThru
Start-Sleep -Seconds 4
if ($process.HasExited) { throw "Raid Notes exited immediately with code $($process.ExitCode)." }
$running = Get-Process -Name 'RaidNotes' -ErrorAction Stop | Select-Object -First 1

[pscustomobject]@{
  ProcessId = $running.Id
  MainWindowTitle = $running.MainWindowTitle
} | ConvertTo-Json
