Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows gray verification must run on Windows"
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -LiteralPath (Join-Path $repository "package.json") -Raw | ConvertFrom-Json
$version = [string] $packageJson.version
$setupName = "LocalBuddy-$version-Setup.exe"
$setupCandidates = @(Get-ChildItem -LiteralPath (Join-Path $repository ".localbuddy/forge-out/make") -Recurse -File -Filter $setupName)
if ($setupCandidates.Count -ne 1) {
  throw "Expected exactly one $setupName, found $($setupCandidates.Count)"
}

$installRoot = Join-Path $env:LOCALAPPDATA "LocalBuddy"
$userDataRoot = Join-Path $env:APPDATA "LocalBuddy"
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $userDataRoot)) {
  throw "Refusing to overwrite an existing LocalBuddy installation or user profile"
}

$evidenceRoot = Join-Path $repository ".localbuddy/windows-gray/win32-installer"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$installedBySmoke = $false

try {
  $setupProcess = Start-Process -FilePath $setupCandidates[0].FullName -ArgumentList "--silent" -Wait -PassThru
  if ($setupProcess.ExitCode -ne 0) {
    throw "Windows Setup exited with $($setupProcess.ExitCode)"
  }
  $installedBySmoke = $true

  $installedExecutable = Join-Path $installRoot "app-$version/LocalBuddy.exe"
  if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
    throw "Installed executable is missing at $installedExecutable"
  }

  & node scripts/verify-windows-installed-gray.mjs $installedExecutable $evidenceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Installed Windows gray verification failed with $LASTEXITCODE"
  }
} finally {
  if ($installedBySmoke) {
    $updateExecutable = Join-Path $installRoot "Update.exe"
    if (Test-Path -LiteralPath $updateExecutable -PathType Leaf) {
      $uninstallProcess = Start-Process -FilePath $updateExecutable -ArgumentList "--uninstall", "-s" -Wait -PassThru
      if ($uninstallProcess.ExitCode -ne 0) {
        throw "Squirrel uninstall exited with $($uninstallProcess.ExitCode)"
      }
    }
  }
}
