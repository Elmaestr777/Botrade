$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5173
$Url = "http://127.0.0.1:$Port/"

function Test-BotradePort {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return $false
  }
}

Set-Location -LiteralPath $RepoRoot

if (-not (Test-BotradePort)) {
  $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npm) { $npm = Get-Command npm -ErrorAction SilentlyContinue }
  if (-not $npm) { throw "npm introuvable. Installe Node.js ou ajoute npm au PATH." }

  Start-Process -FilePath $npm.Source -ArgumentList @("run", "dev") -WorkingDirectory $RepoRoot -WindowStyle Hidden

  for ($i = 0; $i -lt 30; $i++) {
    if (Test-BotradePort) { break }
    Start-Sleep -Milliseconds 500
  }
}

Start-Process $Url
