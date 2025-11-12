param(
  [string]$EnvFile = "$PSScriptRoot/.env.runner"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Info($msg){ Write-Host "[runner] $msg" -ForegroundColor Cyan }
function Write-Err($msg){ Write-Host "[runner] $msg" -ForegroundColor Red }

try{
  Push-Location $PSScriptRoot

  if(-not (Test-Path $EnvFile)){
    Write-Err "Fichier d'environnement introuvable: $EnvFile"
    Write-Host "Créez .env.runner à la racine avec au minimum:" -ForegroundColor Yellow
    Write-Host "  SUPABASE_URL=https://<ref>.supabase.co" -ForegroundColor Yellow
    Write-Host "  SUPABASE_SERVICE_KEY=... (service role)" -ForegroundColor Yellow
    exit 1
  }

  $env:DOTENV_CONFIG_PATH = $EnvFile
  Write-Info "DOTENV_CONFIG_PATH=$EnvFile"

  # Check node
  $nodeVer = (node -v) 2>$null
  if(-not $nodeVer){ Write-Err "Node.js non détecté"; exit 1 }
  Write-Info "Node $nodeVer"

  # Install deps for runner
  Write-Info "Installation des dépendances du runner..."
  npm i --prefix ./runner | Out-Host

  # Start runner
  Write-Info "Démarrage du runner (Ctrl+C pour arrêter)..."
  node ./runner/index.js
}
finally{
  Pop-Location
}
