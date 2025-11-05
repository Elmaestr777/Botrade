param(
  [switch]$NoPush,
  [switch]$NoSeed
)
$ErrorActionPreference = 'Stop'

# Resolve paths
$root    = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envFile = Join-Path $root 'supabase\.env.local'
$supaExe = Join-Path $root 'supabase.exe'
$cfgDir  = Join-Path $root 'supabase'
$cfgToml = Join-Path $cfgDir 'config.toml'
$seedSql = Join-Path $cfgDir 'seed.sql'

if (-not (Test-Path $envFile)) { Write-Error "Missing $envFile"; exit 2 }
if (-not (Test-Path $supaExe)) { Write-Error "Missing Supabase CLI at $supaExe"; exit 2 }

# Load .env-style file into process env
(Get-Content $envFile -Raw).Split("`n") | ForEach-Object {
  $line = $_.Trim()
  if (-not $line) { return }
  if ($line.StartsWith('#')) { return }
  $kv = $line -split '=', 2
  if ($kv.Length -eq 2) {
    $k = $kv[0].Trim(); $v = $kv[1].Trim()
    [Environment]::SetEnvironmentVariable($k, $v, "Process")
  }
}

if (-not $env:SUPABASE_ACCESS_TOKEN) { Write-Error 'SUPABASE_ACCESS_TOKEN is empty in supabase/.env.local'; exit 2 }
if (-not $env:SUPABASE_PROJECT_REF) { Write-Error 'SUPABASE_PROJECT_REF is empty in supabase/.env.local'; exit 2 }

# Link project (creates supabase/config.toml) if needed
if (-not (Test-Path $cfgToml)) {
  & $supaExe link --project-ref $env:SUPABASE_PROJECT_REF
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Push migrations
if (-not $NoPush) {
  & $supaExe db push
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Seed profiles
if (-not $NoSeed) {
  & $supaExe db seed --file $seedSql
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host 'Supabase remote: done.'