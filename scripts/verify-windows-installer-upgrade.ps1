param(
  [Parameter(Mandatory = $true)]
  [string] $BaseSetup,

  [string] $FeedRoot
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
$remoteFeed = -not [string]::IsNullOrWhiteSpace($FeedRoot)
if ($remoteFeed) {
  $feedUri = [Uri] $FeedRoot
  if ($feedUri.Scheme -ne "https" -or
      $feedUri.Host -ne "github.com" -or
      -not [string]::IsNullOrEmpty($feedUri.UserInfo) -or
      -not [string]::IsNullOrEmpty($feedUri.Query) -or
      -not [string]::IsNullOrEmpty($feedUri.Fragment)) {
    throw "Remote Squirrel feed must be a public credential-free GitHub HTTPS URL"
  }
  $resolvedFeedRoot = $feedUri.AbsoluteUri.TrimEnd("/")
} else {
  $feedRoots = @(Get-ChildItem -LiteralPath (Join-Path $repository ".localbuddy/forge-out/make/squirrel.windows") -Recurse -File -Filter "RELEASES" | ForEach-Object { $_.Directory.FullName })
  if ($feedRoots.Count -ne 1) { throw "Expected exactly one generated Squirrel update feed" }
  $resolvedFeedRoot = $feedRoots[0]
  $fullPackages = @(Get-ChildItem -LiteralPath $resolvedFeedRoot -File -Filter "*-full.nupkg")
  if ($fullPackages.Count -ne 1) { throw "Expected exactly one full nupkg in the generated update feed" }
}

$installRoot = Join-Path $env:LOCALAPPDATA "LocalBuddy"
$userDataRoot = Join-Path $env:APPDATA "LocalBuddy"
if ((Test-Path -LiteralPath $installRoot) -or (Test-Path -LiteralPath $userDataRoot)) {
  throw "Refusing to overwrite an existing LocalBuddy installation or user profile"
}

$evidenceRoot = Join-Path $repository $(if ($remoteFeed) { ".localbuddy/online-update-smoke/windows" } else { ".localbuddy/upgrade-smoke/windows" })
$beforeScreenshot = Join-Path $evidenceRoot "before-upgrade.png"
$afterScreenshot = Join-Path $evidenceRoot "after-upgrade.png"
$markerPath = Join-Path $userDataRoot "upgrade-test-marker.json"
$rawDiagnosticsRoot = Join-Path ([IO.Path]::GetTempPath()) "localbuddy-squirrel-diagnostics-$PID"
$directorySeparators = [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$tempRoot = [IO.Path]::GetTempPath().TrimEnd($directorySeparators)
$phaseTimings = [ordered]@{}
$activeSquirrelProcess = $null
New-Item -ItemType Directory -Force -Path $evidenceRoot | Out-Null
New-Item -ItemType Directory -Force -Path $rawDiagnosticsRoot | Out-Null
$installedBySmoke = $false
$originalScreenshot = $env:LOCALBUDDY_SCREENSHOT_PATH
$hadScreenshot = Test-Path Env:LOCALBUDDY_SCREENSHOT_PATH
$originalCoordination = $env:LOCALBUDDY_SHARED_COORDINATION
$hadCoordination = Test-Path Env:LOCALBUDDY_SHARED_COORDINATION

function ConvertTo-SanitizedDiagnosticText {
  param([string] $Text)

  $sanitized = $Text
  $rootReplacements = @(
    @{ source = $repository; replacement = "<repository>" },
    @{ source = $env:LOCALAPPDATA; replacement = "<local-app-data>" },
    @{ source = $env:APPDATA; replacement = "<roaming-app-data>" },
    @{ source = $env:USERPROFILE; replacement = "<user-profile>" },
    @{ source = $tempRoot; replacement = "<temp>" }
  )
  foreach ($replacement in $rootReplacements) {
    if (-not [string]::IsNullOrWhiteSpace([string] $replacement.source)) {
      $sanitized = $sanitized.Replace([string] $replacement.source, [string] $replacement.replacement)
    }
  }
  $sanitized = [regex]::Replace(
    $sanitized,
    '(?i)(authorization|access[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*\S+',
    '$1=<redacted>'
  )
  $sanitized = [regex]::Replace($sanitized, '(https://[^\s?]+)\?[^\s]+', '$1?<redacted>')
  return $sanitized
}

function Save-SquirrelDiagnostics {
  if (Test-Path -LiteralPath $installRoot -PathType Container) {
    $squirrelLogs = @(Get-ChildItem -LiteralPath $installRoot -File -Filter "Squirrel-*.log" -ErrorAction SilentlyContinue)
    foreach ($sourceLog in $squirrelLogs) {
      try {
        $sourceText = [IO.File]::ReadAllText($sourceLog.FullName)
        $safeText = ConvertTo-SanitizedDiagnosticText -Text $sourceText
        [IO.File]::WriteAllText(
          (Join-Path $evidenceRoot $sourceLog.Name),
          $safeText,
          [System.Text.UTF8Encoding]::new($false)
        )
      } catch {
        Write-Warning "Could not capture $($sourceLog.Name): $($_.Exception.GetType().Name)"
      }
    }
  }

  try {
    $packageState = @()
    $packagesRoot = Join-Path $installRoot "packages"
    if (Test-Path -LiteralPath $packagesRoot -PathType Container) {
      $packageState = @(Get-ChildItem -LiteralPath $packagesRoot -File -ErrorAction SilentlyContinue | ForEach-Object {
        [ordered]@{ name = $_.Name; bytes = $_.Length }
      })
    }
    $stateJson = ([ordered]@{
      schemaVersion = 1
      capturedAt = [DateTime]::UtcNow.ToString("o")
      packages = $packageState
    } | ConvertTo-Json -Depth 5) + "`n"
    [IO.File]::WriteAllText(
      (Join-Path $evidenceRoot "squirrel-package-state.json"),
      $stateJson,
      [System.Text.UTF8Encoding]::new($false)
    )
  } catch {
    Write-Warning "Could not capture Squirrel package state: $($_.Exception.GetType().Name)"
  }
}

function Save-SquirrelProcessOutput {
  param(
    [string] $Phase,
    [string] $RawStandardOutput,
    [string] $RawStandardError
  )

  $streams = @(
    @{ source = $RawStandardOutput; destination = "$Phase-stdout.log" },
    @{ source = $RawStandardError; destination = "$Phase-stderr.log" }
  )
  foreach ($stream in $streams) {
    try {
      if (Test-Path -LiteralPath $stream.source -PathType Leaf) {
        $safeText = ConvertTo-SanitizedDiagnosticText -Text ([IO.File]::ReadAllText($stream.source))
        [IO.File]::WriteAllText(
          (Join-Path $evidenceRoot $stream.destination),
          $safeText,
          [System.Text.UTF8Encoding]::new($false)
        )
      }
    } catch {
      Write-Warning "Could not capture $($stream.destination): $($_.Exception.GetType().Name)"
    }
  }
}

function Stop-SquirrelProcessTree {
  param(
    [System.Diagnostics.Process] $Process,
    [string] $Reason
  )

  $Process.Refresh()
  if ($Process.HasExited) { return $true }

  Write-Warning "Stopping Squirrel process tree after $Reason."
  try {
    & taskkill.exe /PID $Process.Id /T /F 2>&1 | Out-Null
  } catch {
    Write-Warning "Could not request Squirrel process-tree termination: $($_.Exception.GetType().Name)"
  }

  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    $Process.Refresh()
    if ($Process.HasExited) { return $true }
  }

  Write-Warning "Squirrel process tree did not exit within 10 seconds."
  return $false
}

function Invoke-SquirrelPhase {
  param(
    [string] $Phase,
    [string[]] $Arguments,
    [int] $TimeoutSeconds
  )

  $rawStandardOutput = Join-Path $rawDiagnosticsRoot "$Phase-stdout.log"
  $rawStandardError = Join-Path $rawDiagnosticsRoot "$Phase-stderr.log"
  $startedAt = [DateTime]::UtcNow
  Write-Host "Starting Squirrel $Phase phase with a ${TimeoutSeconds}s timeout."
  $script:activeSquirrelProcess = Start-Process -FilePath $updateExecutable -ArgumentList $Arguments -PassThru `
    -RedirectStandardOutput $rawStandardOutput -RedirectStandardError $rawStandardError
  $phaseProcess = $script:activeSquirrelProcess
  $phaseExitCode = $null
  try {
    while (-not $phaseProcess.WaitForExit(10000)) {
      Save-SquirrelDiagnostics
      $elapsedSeconds = [Math]::Floor(([DateTime]::UtcNow - $startedAt).TotalSeconds)
      $packagesRoot = Join-Path $installRoot "packages"
      $downloadedBytes = 0
      if (Test-Path -LiteralPath $packagesRoot -PathType Container) {
        $downloadedBytes = (Get-ChildItem -LiteralPath $packagesRoot -File -ErrorAction SilentlyContinue |
          Measure-Object -Property Length -Sum).Sum
        if ($null -eq $downloadedBytes) { $downloadedBytes = 0 }
      }
      Write-Host "Squirrel $Phase is still running after ${elapsedSeconds}s; package bytes on disk: $downloadedBytes."
      if ($elapsedSeconds -ge $TimeoutSeconds) {
        throw "Squirrel $Phase exceeded the ${TimeoutSeconds}s diagnostic timeout"
      }
    }
    $phaseProcess.Refresh()
    $phaseExitCode = $phaseProcess.ExitCode
  } finally {
    $processExited = $phaseProcess.HasExited
    if (-not $phaseProcess.HasExited) {
      $processExited = Stop-SquirrelProcessTree -Process $phaseProcess -Reason "$Phase timeout or failure"
    }
    Save-SquirrelDiagnostics
    if ($processExited) {
      $phaseProcess.Refresh()
      if ($null -eq $phaseExitCode) { $phaseExitCode = $phaseProcess.ExitCode }
      Save-SquirrelProcessOutput -Phase $Phase -RawStandardOutput $rawStandardOutput -RawStandardError $rawStandardError
      $phaseProcess.Dispose()
      $script:activeSquirrelProcess = $null
    } else {
      Write-Warning "Skipping Squirrel $Phase output capture because the process tree is still running."
    }
  }

  $elapsed = [Math]::Round(([DateTime]::UtcNow - $startedAt).TotalSeconds, 3)
  $phaseTimings[$Phase] = $elapsed
  if ($phaseExitCode -ne 0) {
    throw "Squirrel $Phase exited with $phaseExitCode"
  }
  Write-Host "Squirrel $Phase completed in ${elapsed}s."
}

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
  if ($remoteFeed) {
    Invoke-SquirrelPhase -Phase "check-for-update" -Arguments @("--checkForUpdate", $resolvedFeedRoot) -TimeoutSeconds 120
    Invoke-SquirrelPhase -Phase "download" -Arguments @("--download", $resolvedFeedRoot) -TimeoutSeconds 1500
    Invoke-SquirrelPhase -Phase "update" -Arguments @("--update", $resolvedFeedRoot) -TimeoutSeconds 480
  } else {
    Invoke-SquirrelPhase -Phase "update" -Arguments @("--update", $resolvedFeedRoot) -TimeoutSeconds 600
  }

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

  $summary = [ordered]@{
    schemaVersion = 1
    baseSetup = [IO.Path]::GetFileName($baseSetupPath)
    targetVersion = $targetVersion
    targetInstallDirectory = $targetExecutables[0].Directory.Name
    profilePreserved = $true
    feedKind = $(if ($remoteFeed) { "github-release-static" } else { "local-candidate" })
    phaseSeconds = $phaseTimings
    beforeScreenshot = [IO.Path]::GetFileName($beforeScreenshot)
    afterScreenshot = [IO.Path]::GetFileName($afterScreenshot)
  }
  $summaryJson = ($summary | ConvertTo-Json -Depth 4) + "`n"
  [System.IO.File]::WriteAllText(
    (Join-Path $evidenceRoot "upgrade-summary.json"),
    $summaryJson,
    [System.Text.UTF8Encoding]::new($false)
  )
  $summaryJson
} finally {
  if ($null -ne $activeSquirrelProcess -and -not $activeSquirrelProcess.HasExited) {
    $treeStopped = Stop-SquirrelProcessTree -Process $activeSquirrelProcess -Reason "top-level cleanup"
    if ($treeStopped) {
      $activeSquirrelProcess.Dispose()
      $script:activeSquirrelProcess = $null
    }
  }
  Save-SquirrelDiagnostics
  if (Test-Path -LiteralPath $rawDiagnosticsRoot -PathType Container) {
    try {
      Remove-Item -LiteralPath $rawDiagnosticsRoot -Recurse -Force -ErrorAction Stop
    } catch {
      Write-Warning "Could not remove temporary Squirrel diagnostics: $($_.Exception.GetType().Name)"
    }
  }
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
