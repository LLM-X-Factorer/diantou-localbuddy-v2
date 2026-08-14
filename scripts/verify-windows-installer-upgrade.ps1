param(
  [Parameter(Mandatory = $true)]
  [string] $BaseSetup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows installer upgrade verification must run on Windows"
}

$repository = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content -LiteralPath (Join-Path $repository "package.json") -Raw | ConvertFrom-Json
$targetVersion = [string] $packageJson.version
$baseSetupPath = (Resolve-Path $BaseSetup).Path
$feedRoots = @(Get-ChildItem -LiteralPath (Join-Path $repository ".localbuddy/forge-out/make/squirrel.windows") -Recurse -File -Filter "RELEASES" | ForEach-Object { $_.Directory.FullName })
if ($feedRoots.Count -ne 1) { throw "Expected exactly one generated Squirrel update feed" }
$feedRoot = $feedRoots[0]
$fullPackages = @(Get-ChildItem -LiteralPath $feedRoot -File -Filter "*-full.nupkg")
if ($fullPackages.Count -ne 1) { throw "Expected exactly one full nupkg in the generated update feed" }

$installRoot = Join-Path $env:LOCALAPPDATA "LocalBuddy"
$userDataRoot = Join-Path $env:APPDATA "LocalBuddy"
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $userDataRoot)) {
  throw "Refusing to overwrite an existing LocalBuddy installation or user profile"
}

$evidenceRoot = Join-Path $repository ".localbuddy/upgrade-smoke/windows"
$beforeScreenshot = Join-Path $evidenceRoot "before-upgrade.png"
$afterScreenshot = Join-Path $evidenceRoot "after-upgrade.png"
$markerPath = Join-Path $userDataRoot "upgrade-test-marker.json"
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
$installedBySmoke = $false
$originalScreenshot = $env:LOCALBUDDY_SCREENSHOT_PATH
$hadScreenshot = Test-Path Env:LOCALBUDDY_SCREENSHOT_PATH
$originalCoordination = $env:LOCALBUDDY_SHARED_COORDINATION
$hadCoordination = Test-Path Env:LOCALBUDDY_SHARED_COORDINATION

try {
  $setupProcess = Start-Process -FilePath $baseSetupPath -ArgumentList "--silent" -Wait -PassThru
  if ($setupProcess.ExitCode -ne 0) { throw "Base Setup exited with $($setupProcess.ExitCode)" }
  $installedBySmoke = $true
  $baseExecutables = @(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter "LocalBuddy.exe" | Where-Object { $_.Directory.Name -like "app-*" })
  if ($baseExecutables.Count -ne 1) { throw "Base release did not install exactly one versioned LocalBuddy.exe" }

  $env:LOCALBUDDY_SCREENSHOT_PATH = $beforeScreenshot
  $env:LOCALBUDDY_SHARED_COORDINATION = "0"
  $beforeProcess = Start-Process -FilePath $baseExecutables[0].FullName -Wait -PassThru
  if ($beforeProcess.ExitCode -ne 0) { throw "Base LocalBuddy first launch failed with $($beforeProcess.ExitCode)" }
  New-Item -ItemType Directory -Force -Path $userDataRoot | Out-Null
  [System.IO.File]::WriteAllText($markerPath, "{`"preserveAcrossUpgrade`":true}`n", [System.Text.UTF8Encoding]::new($false))

  $updateExecutable = Join-Path $installRoot "Update.exe"
  if (-not (Test-Path -LiteralPath $updateExecutable -PathType Leaf)) { throw "Installed Squirrel Update.exe is missing" }
  $updateProcess = Start-Process -FilePath $updateExecutable -ArgumentList @("--update", $feedRoot) -Wait -PassThru
  if ($updateProcess.ExitCode -ne 0) { throw "Squirrel update exited with $($updateProcess.ExitCode)" }

  $targetExecutables = @(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter "LocalBuddy.exe" | Where-Object {
    $_.Directory.Name -like "app-*" -and $_.FullName -ne $baseExecutables[0].FullName
  })
  if ($targetExecutables.Count -ne 1) { throw "Update did not install exactly one new versioned LocalBuddy.exe" }
  $targetExecutable = $targetExecutables[0].FullName
  if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
    throw "User profile marker was lost during the in-place update"
  }

  $env:LOCALBUDDY_SCREENSHOT_PATH = $afterScreenshot
  $afterProcess = Start-Process -FilePath $targetExecutable -Wait -PassThru
  if ($afterProcess.ExitCode -ne 0) { throw "Updated LocalBuddy launch failed with $($afterProcess.ExitCode)" }
  $afterDiagnostics = Get-Content -LiteralPath "$afterScreenshot.json" -Raw | ConvertFrom-Json
  if ([string] $afterDiagnostics.buildIdentity -notmatch [regex]::Escape("v$targetVersion")) {
    throw "Updated UI does not report the expected build version $targetVersion"
  }

  [ordered]@{
    schemaVersion = 1
    baseSetup = [IO.Path]::GetFileName($baseSetupPath)
    targetVersion = $targetVersion
    targetExecutable = $targetExecutable
    profilePreserved = $true
    beforeScreenshot = $beforeScreenshot
    afterScreenshot = $afterScreenshot
  } | ConvertTo-Json -Depth 4
} finally {
  if ($hadScreenshot) { $env:LOCALBUDDY_SCREENSHOT_PATH = $originalScreenshot } else { Remove-Item Env:LOCALBUDDY_SCREENSHOT_PATH -ErrorAction SilentlyContinue }
  if ($hadCoordination) { $env:LOCALBUDDY_SHARED_COORDINATION = $originalCoordination } else { Remove-Item Env:LOCALBUDDY_SHARED_COORDINATION -ErrorAction SilentlyContinue }
  if ($installedBySmoke) {
    $updateExecutable = Join-Path $installRoot "Update.exe"
    if (Test-Path -LiteralPath $updateExecutable -PathType Leaf) {
      $uninstallProcess = Start-Process -FilePath $updateExecutable -ArgumentList "--uninstall", "-s" -Wait -PassThru
      if ($uninstallProcess.ExitCode -ne 0) { throw "Squirrel uninstall exited with $($uninstallProcess.ExitCode)" }
    }
    if (Test-Path -LiteralPath $userDataRoot) {
      Remove-Item -LiteralPath $userDataRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $installRoot) {
      Remove-Item -LiteralPath $installRoot -Recurse -Force
    }
  }
}
