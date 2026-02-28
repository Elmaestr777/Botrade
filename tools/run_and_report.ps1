Param(
  [string]$Symbol = "BTCUSDC",
  [string]$Tf = "1h",
  [string]$Profile = "balancee",
  [string]$Config = "config.example.yaml",
  [int]$Limit = 10,
  [switch]$Fast,
  [switch]$NoWf,
  [string]$Note = ""
)

$ErrorActionPreference = "Stop"

if (-not $env:SUPABASE_URL -and -not $env:SUPABASE_REST_URL) {
  throw "Missing SUPABASE_URL or SUPABASE_REST_URL in environment."
}
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
  throw "Missing SUPABASE_SERVICE_ROLE_KEY in environment."
}

$env:HEAVEN_PROFILE_NAME = $Profile
if ($Note -and $Note.Trim().Length -gt 0) {
  $env:HEAVEN_NOTE = $Note
} else {
  $env:HEAVEN_NOTE = "CLI run $Symbol $Tf profile=$Profile"
}

$runArgs = @("run_optimize.py", "--config", $Config)
if ($Fast) { $runArgs += "--fast" }
if ($NoWf) { $runArgs += "--no-wf" }

Write-Host "[1/2] Running optimizer..." -ForegroundColor Cyan
python @runArgs
if ($LASTEXITCODE -ne 0) { throw "Optimizer failed with code $LASTEXITCODE" }

Write-Host "[2/2] Reporting latest palmares..." -ForegroundColor Cyan
python tools/report_latest_palmares.py --symbol $Symbol --tf $Tf --limit $Limit --note-contains $env:HEAVEN_NOTE
if ($LASTEXITCODE -ne 0) { throw "Report failed with code $LASTEXITCODE" }

Write-Host "Done." -ForegroundColor Green
