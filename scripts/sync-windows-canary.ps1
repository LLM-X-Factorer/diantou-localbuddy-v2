param(
  [string] $Repository = "LLM-X-Factorer/diantou-localbuddy-v2",
  [string] $Branch = "main",
  [string] $RunId = "",
  [string] $CanaryRoot = "",
  [string] $UserDataRoot = "",
  [switch] $NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows Canary sync must run on Windows"
}
if ($CanaryRoot.Length -eq 0) {
  $CanaryRoot = Join-Path $env:LOCALAPPDATA "LocalBuddy-Canary"
}
if ($UserDataRoot.Length -eq 0) {
  $UserDataRoot = Join-Path $env:APPDATA "LocalBuddy-Canary"
}

& gh auth status --hostname github.com *> $null
if ($LASTEXITCODE -ne 0) {
  throw "GitHub CLI must be authenticated before syncing a private Canary artifact"
}

if ($RunId.Length -eq 0) {
  $runsJson = & gh run list `
    --repo $Repository `
    --workflow ci.yml `
    --branch $Branch `
    --status success `
    --limit 1 `
    --json databaseId,headSha,conclusion,status,createdAt
  if ($LASTEXITCODE -ne 0) { throw "Could not query the latest successful Windows Canary build" }
  $runs = @($runsJson | ConvertFrom-Json)
  if ($runs.Count -ne 1) { throw "No successful Canary build is available on $Branch" }
  $RunId = [string] $runs[0].databaseId
  $headSha = [string] $runs[0].headSha
} else {
  if ($RunId -notmatch '^\d+$') { throw "RunId must contain digits only" }
  $runJson = & gh run view $RunId --repo $Repository --json headSha,conclusion,status
  if ($LASTEXITCODE -ne 0) { throw "Could not read GitHub Actions run $RunId" }
  $run = $runJson | ConvertFrom-Json
  if ($run.status -ne "completed" -or $run.conclusion -ne "success") {
    throw "GitHub Actions run $RunId is not a completed successful build"
  }
  $headSha = [string] $run.headSha
}
if ($headSha -notmatch '^[a-f0-9]{40}$') { throw "Canary build returned an invalid Git SHA" }

$buildsRoot = Join-Path $CanaryRoot "builds"
$buildRoot = Join-Path $buildsRoot $headSha
$statePath = Join-Path $CanaryRoot "current.json"
New-Item -ItemType Directory -Force -Path $buildsRoot, $UserDataRoot | Out-Null

if (-not (Test-Path -LiteralPath $buildRoot -PathType Container)) {
  $temporaryRoot = Join-Path $CanaryRoot (".incoming-" + [Guid]::NewGuid().ToString("N"))
  $expandedRoot = Join-Path $temporaryRoot "expanded"
  try {
    New-Item -ItemType Directory -Force -Path $temporaryRoot, $expandedRoot | Out-Null
    & gh run download $RunId `
      --repo $Repository `
      --name "localbuddy-windows-canary" `
      --dir $temporaryRoot
    if ($LASTEXITCODE -ne 0) { throw "Could not download Canary artifact from run $RunId" }
    $zips = @(Get-ChildItem -LiteralPath $temporaryRoot -Recurse -File -Filter "LocalBuddy-win32-x64-*.zip")
    if ($zips.Count -ne 1) { throw "Expected exactly one portable LocalBuddy ZIP, found $($zips.Count)" }
    Expand-Archive -LiteralPath $zips[0].FullName -DestinationPath $expandedRoot
    $executables = @(Get-ChildItem -LiteralPath $expandedRoot -Recurse -File -Filter "LocalBuddy.exe")
    if ($executables.Count -ne 1) { throw "Expected exactly one portable LocalBuddy.exe, found $($executables.Count)" }
    Move-Item -LiteralPath $expandedRoot -Destination $buildRoot
  } finally {
    if (Test-Path -LiteralPath $temporaryRoot) {
      Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
    }
  }
}

$installedExecutables = @(Get-ChildItem -LiteralPath $buildRoot -Recurse -File -Filter "LocalBuddy.exe")
if ($installedExecutables.Count -ne 1) {
  throw "Canary build $headSha does not contain exactly one LocalBuddy.exe"
}
$executable = $installedExecutables[0].FullName
$state = [ordered]@{
  schemaVersion = 1
  repository = $Repository
  branch = $Branch
  runId = [long] $RunId
  headSha = $headSha
  executable = $executable
  userData = $UserDataRoot
  synchronizedAt = [DateTime]::UtcNow.ToString("o")
}
$temporaryState = "$statePath.$PID.tmp"
$utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($temporaryState, (($state | ConvertTo-Json -Depth 4) + "`n"), $utf8WithoutBom)
Move-Item -LiteralPath $temporaryState -Destination $statePath -Force

$state | ConvertTo-Json -Depth 4
if (-not $NoLaunch) {
  Start-Process -FilePath $executable -ArgumentList @("--user-data-dir=$UserDataRoot")
}
