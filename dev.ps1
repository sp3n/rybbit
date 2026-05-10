param(
  [switch]$Install,
  [switch]$SkipDbPush,
  [switch]$NoWindows
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Invoke-Checked {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [string[]]$ArgumentList = @(),
    [Parameter(Mandatory = $true)]
    [string]$FailureMessage
  )

  & $FilePath @ArgumentList
  if ($LASTEXITCODE -ne 0) {
    throw $FailureMessage
  }
}

function Ensure-ComposeEnvDefaults {
  $defaults = @{
    DOMAIN_NAME        = "localhost"
    BETTER_AUTH_SECRET = "dev-secret-change-me-32chars-minimum"
    BASE_URL           = "http://localhost:3002"
    DISABLE_SIGNUP     = "false"
    DISABLE_TELEMETRY  = "false"
    MAPBOX_TOKEN       = ""
  }

  foreach ($key in $defaults.Keys) {
    $current = [Environment]::GetEnvironmentVariable($key)
    if ([string]::IsNullOrWhiteSpace($current)) {
      Set-Item -Path "Env:$key" -Value $defaults[$key]
    }
  }
}

function Wait-ForHttp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Url,
    [int]$TimeoutSeconds = 60
  )

  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
    try {
      $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
      if ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 500) {
        return
      }
    } catch {}
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for $Url"
}

function Wait-ForTcp {
  param(
    [Parameter(Mandatory = $true)]
    [string]$TargetHost,
    [Parameter(Mandatory = $true)]
    [int]$Port,
    [int]$TimeoutSeconds = 60
  )

  $start = Get-Date
  while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSeconds) {
    $ok = Test-NetConnection -ComputerName $TargetHost -Port $Port -WarningAction SilentlyContinue
    if ($ok.TcpTestSucceeded) {
      return
    }
    Start-Sleep -Seconds 1
  }
  throw "Timed out waiting for TCP $TargetHost`:$Port"
}

Push-Location $repoRoot
try {
  Write-Host "Checking Docker daemon..."
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker Desktop is not running (or daemon is unreachable). Start Docker Desktop, wait until it's ready, then rerun this script."
  }

  Ensure-ComposeEnvDefaults

  Write-Host "Starting infra containers (clickhouse, postgres)..."
  Invoke-Checked -FilePath "docker" -ArgumentList @("compose", "up", "-d", "clickhouse", "postgres") -FailureMessage "Failed to start clickhouse/postgres via docker compose."

  Write-Host "Waiting for ClickHouse and Postgres to accept connections..."
  Wait-ForHttp -Url "http://localhost:8123/ping" -TimeoutSeconds 90
  Wait-ForTcp -TargetHost "localhost" -Port 5432 -TimeoutSeconds 90

  if ($Install) {
    Write-Host "Installing dependencies..."
    Push-Location "$repoRoot\shared"
    Invoke-Checked -FilePath "npm" -ArgumentList @("install") -FailureMessage "npm install failed in shared."
    Pop-Location

    Push-Location "$repoRoot\server"
    Invoke-Checked -FilePath "npm" -ArgumentList @("install") -FailureMessage "npm install failed in server."
    Pop-Location

    Push-Location "$repoRoot\client"
    Invoke-Checked -FilePath "npm" -ArgumentList @("install") -FailureMessage "npm install failed in client."
    Pop-Location
  }

  Write-Host "Building shared package..."
  Push-Location "$repoRoot\shared"
  Invoke-Checked -FilePath "npm" -ArgumentList @("run", "build") -FailureMessage "shared build failed."
  Pop-Location

  if (-not $SkipDbPush) {
    Write-Host "Pushing Postgres schema..."
    Push-Location "$repoRoot\server"
    Invoke-Checked -FilePath "npm" -ArgumentList @("run", "db:push", "--", "--force") -FailureMessage "db:push failed."
    Pop-Location
  }

  if ($NoWindows) {
    Write-Host "Run these in two terminals:"
    Write-Host "  cd server; npm run dev"
    Write-Host "  cd client; npm run dev"
    return
  }

  Write-Host "Launching backend and client in separate PowerShell windows..."
  Start-Process powershell -ArgumentList @("-NoExit", "-Command", "Set-Location `"$repoRoot\\server`"; npm run dev")
  Start-Process powershell -ArgumentList @("-NoExit", "-Command", "Set-Location `"$repoRoot\\client`"; npm run dev")

  Write-Host "Done."
  Write-Host "Frontend: http://localhost:3002"
  Write-Host "Backend health: http://localhost:3001/api/health"
}
finally {
  Pop-Location
}
