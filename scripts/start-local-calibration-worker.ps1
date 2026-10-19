param([switch]$Once)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$processingLocalDb = Join-Path (Get-Location) '.tools/fleet-local-copy-20261015.sqlite'
if (-not (Test-Path -LiteralPath $processingLocalDb)) { throw 'Local test database copy is missing. Start the existing local test environment first.' }
$env:DATABASE_PATH = $processingLocalDb
$env:CALIBRATION_RESULT_DIR = Join-Path (Get-Location) '.tools/calibration-results'
Write-Host 'Processing uses the local test database copy. MySQL raw data is read only.'
if ($Once) { & node --env-file=.env scripts/calibration-worker.mjs --once }
else { & node --env-file=.env scripts/calibration-worker.mjs }
exit $LASTEXITCODE
