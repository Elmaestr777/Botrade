@echo off
setlocal enabledelayedexpansion

REM Determine repo root (script directory)
set "ROOT=%~dp0"
set "ENVFILE=%ROOT%.env.runner"

if not exist "%ENVFILE%" (
  echo [runner] ERREUR: fichier d'environnement introuvable: %ENVFILE%
  echo Creez .env.runner a la racine avec au minimum:
  echo   SUPABASE_URL=https://^<ref^>.supabase.co
  echo   SUPABASE_SERVICE_KEY=... (service role)
  exit /b 1
)

set "DOTENV_CONFIG_PATH=%ENVFILE%"

echo [runner] Installation des dependances du runner...
npm i --prefix "%ROOT%runner"

echo [runner] Demarrage du runner (Ctrl+C pour arreter)...
node "%ROOT%runner\index.js"
