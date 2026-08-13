Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows installer verification must run on Windows"
}

function Wait-ForFile([string] $Path, [int] $TimeoutSeconds = 90) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Timed out waiting for $Path"
}

function Wait-ForLocalBuddyExit([int] $TimeoutSeconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (@(Get-Process -Name "LocalBuddy" -ErrorAction SilentlyContinue).Count -eq 0) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "Installed LocalBuddy did not exit after capture"
}

function Assert-CleanFirstLaunchEvidence([string] $ScreenshotPath) {
  $jsonPath = "$ScreenshotPath.json"
  Wait-ForFile -Path $ScreenshotPath
  Wait-ForFile -Path $jsonPath
  $diagnostics = Get-Content -LiteralPath $jsonPath -Raw | ConvertFrom-Json

  if ($diagnostics.url -ne "localbuddy://app/index.html") { throw "Unexpected installed app URL" }
  if ($diagnostics.title -ne "LocalBuddy V2") { throw "Unexpected installed app title" }
  if ($diagnostics.api -ne "object") { throw "Installed preload API is unavailable" }
  if ($diagnostics.rootChildren -ne 1) { throw "Installed Renderer root is unavailable" }
  if ($diagnostics.bodyCharacters -le 100) { throw "Installed Renderer body is unexpectedly empty" }
  if ($diagnostics.guideVisible -ne $true) { throw "Installed Guide is not visible" }
  if ($diagnostics.providerDialogVisible -ne $true) { throw "Installed Provider dialog is not visible" }
  if ($diagnostics.providerEntry -notmatch "DeepSeek" -or $diagnostics.providerEntry -notmatch "未配置") {
    throw "Installed Provider entry is not unconfigured"
  }
  $providerChoices = @($diagnostics.providerChoices)
  if ($providerChoices.Count -ne 2) { throw "Expected two installed Provider choices" }
  if (@($providerChoices | Where-Object { $_ -match "DeepSeek" -and $_ -match "尚未保存 API Key" }).Count -ne 1) {
    throw "Installed DeepSeek choice is not clean"
  }
  if (@($providerChoices | Where-Object { $_ -match "OpenAI" -and $_ -match "尚未保存 API Key" }).Count -ne 1) {
    throw "Installed OpenAI choice is not clean"
  }
  if ($diagnostics.verifyDisabled -ne $true) { throw "Installed connection verification is not disabled" }
  if ($diagnostics.startDisabled -ne $true) { throw "Installed task start is not disabled" }
  if ((Get-Item -LiteralPath $ScreenshotPath).Length -le 10000) { throw "Installed screenshot is unexpectedly small" }

  return $diagnostics
}

function Restore-Environment(
  [string] $OriginalPath,
  [bool] $HadDeepSeek,
  [AllowNull()][string] $OriginalDeepSeek,
  [bool] $HadOpenAI,
  [AllowNull()][string] $OriginalOpenAI,
  [bool] $HadScreenshot,
  [AllowNull()][string] $OriginalScreenshot,
  [bool] $HadCoordination,
  [AllowNull()][string] $OriginalCoordination
) {
  $env:PATH = $OriginalPath
  if ($HadDeepSeek) { $env:DEEPSEEK_API_KEY = $OriginalDeepSeek } else { Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue }
  if ($HadOpenAI) { $env:OPENAI_API_KEY = $OriginalOpenAI } else { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
  if ($HadScreenshot) { $env:LOCALBUDDY_SCREENSHOT_PATH = $OriginalScreenshot } else { Remove-Item Env:LOCALBUDDY_SCREENSHOT_PATH -ErrorAction SilentlyContinue }
  if ($HadCoordination) { $env:LOCALBUDDY_SHARED_COORDINATION = $OriginalCoordination } else { Remove-Item Env:LOCALBUDDY_SHARED_COORDINATION -ErrorAction SilentlyContinue }
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

$evidenceRoot = Join-Path $repository ".localbuddy/first-run-smoke/win32-installer"
$installerScreenshot = Join-Path $evidenceRoot "installed-first-launch.png"
$relaunchEvidenceRoot = Join-Path $evidenceRoot "isolated-relaunch"
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("localbuddy-installer-smoke-" + [Guid]::NewGuid().ToString("N"))
$emptyPath = Join-Path $temporaryRoot "empty-path"
New-Item -ItemType Directory -Force -Path $evidenceRoot, $emptyPath | Out-Null

$originalPath = $env:PATH
$hadDeepSeek = Test-Path Env:DEEPSEEK_API_KEY
$originalDeepSeek = $env:DEEPSEEK_API_KEY
$hadOpenAI = Test-Path Env:OPENAI_API_KEY
$originalOpenAI = $env:OPENAI_API_KEY
$hadScreenshot = Test-Path Env:LOCALBUDDY_SCREENSHOT_PATH
$originalScreenshot = $env:LOCALBUDDY_SCREENSHOT_PATH
$hadCoordination = Test-Path Env:LOCALBUDDY_SHARED_COORDINATION
$originalCoordination = $env:LOCALBUDDY_SHARED_COORDINATION
$installedBySmoke = $false
$uninstallExitCode = $null

try {
  Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  $env:PATH = $emptyPath
  $env:LOCALBUDDY_SCREENSHOT_PATH = $installerScreenshot
  $env:LOCALBUDDY_SHARED_COORDINATION = "0"

  $setupProcess = Start-Process -FilePath $setupCandidates[0].FullName -ArgumentList "--silent" -Wait -PassThru
  if ($setupProcess.ExitCode -ne 0) {
    throw "Windows Setup exited with $($setupProcess.ExitCode)"
  }
  $installedBySmoke = $true
  $installerDiagnostics = Assert-CleanFirstLaunchEvidence -ScreenshotPath $installerScreenshot
  Wait-ForLocalBuddyExit

  $installedExecutable = Join-Path $installRoot "app-$version/LocalBuddy.exe"
  if (-not (Test-Path -LiteralPath $installedExecutable -PathType Leaf)) {
    throw "Installed executable is missing at $installedExecutable"
  }

  Restore-Environment $originalPath $hadDeepSeek $originalDeepSeek $hadOpenAI $originalOpenAI $hadScreenshot $originalScreenshot $hadCoordination $originalCoordination
  & pnpm verify:first-run-package $installedExecutable $relaunchEvidenceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Installed executable relaunch smoke failed with $LASTEXITCODE"
  }

  [ordered]@{
    setup = $setupCandidates[0].FullName
    setupExitCode = $setupProcess.ExitCode
    installedExecutable = $installedExecutable
    credentialEnvironment = "cleared"
    credentialCommandPath = "empty"
    installerFirstRun = $installerDiagnostics
    isolatedRelaunchEvidence = $relaunchEvidenceRoot
  } | ConvertTo-Json -Depth 8
} finally {
  Restore-Environment $originalPath $hadDeepSeek $originalDeepSeek $hadOpenAI $originalOpenAI $hadScreenshot $originalScreenshot $hadCoordination $originalCoordination
  if ($installedBySmoke) {
    $updateExecutable = Join-Path $installRoot "Update.exe"
    if (Test-Path -LiteralPath $updateExecutable -PathType Leaf) {
      $uninstallProcess = Start-Process -FilePath $updateExecutable -ArgumentList "--uninstall", "-s" -Wait -PassThru
      $uninstallExitCode = $uninstallProcess.ExitCode
      if ($uninstallExitCode -ne 0) {
        throw "Squirrel uninstall exited with $uninstallExitCode"
      }
    }
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
