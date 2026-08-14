Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not $IsWindows) {
  throw "Windows installer verification must run on Windows"
}

function Restore-Environment(
  [string] $OriginalPath,
  [bool] $HadDeepSeek,
  [AllowNull()][string] $OriginalDeepSeek,
  [bool] $HadOpenAI,
  [AllowNull()][string] $OriginalOpenAI,
  [bool] $HadCoordination,
  [AllowNull()][string] $OriginalCoordination
) {
  $env:PATH = $OriginalPath
  if ($HadDeepSeek) { $env:DEEPSEEK_API_KEY = $OriginalDeepSeek } else { Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue }
  if ($HadOpenAI) { $env:OPENAI_API_KEY = $OriginalOpenAI } else { Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue }
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
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ("localbuddy-installer-smoke-" + [Guid]::NewGuid().ToString("N"))
$emptyPath = Join-Path $temporaryRoot "empty-path"
New-Item -ItemType Directory -Force -Path $evidenceRoot, $emptyPath | Out-Null

$originalPath = $env:PATH
$hadDeepSeek = Test-Path Env:DEEPSEEK_API_KEY
$originalDeepSeek = $env:DEEPSEEK_API_KEY
$hadOpenAI = Test-Path Env:OPENAI_API_KEY
$originalOpenAI = $env:OPENAI_API_KEY
$hadCoordination = Test-Path Env:LOCALBUDDY_SHARED_COORDINATION
$originalCoordination = $env:LOCALBUDDY_SHARED_COORDINATION
$installedBySmoke = $false

try {
  Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  $env:PATH = $emptyPath
  $env:LOCALBUDDY_SHARED_COORDINATION = "0"

  $setupProcess = Start-Process -FilePath $setupCandidates[0].FullName -ArgumentList "--silent" -Wait -PassThru
  if ($setupProcess.ExitCode -ne 0) {
    throw "Windows Setup exited with $($setupProcess.ExitCode)"
  }
  $installedBySmoke = $true

  $installedExecutables = @(Get-ChildItem -LiteralPath $installRoot -Recurse -File -Filter "LocalBuddy.exe" | Where-Object { $_.Directory.Name -like "app-*" })
  if ($installedExecutables.Count -ne 1) { throw "Setup did not install exactly one versioned LocalBuddy.exe" }
  $installedExecutable = $installedExecutables[0].FullName

  Restore-Environment $originalPath $hadDeepSeek $originalDeepSeek $hadOpenAI $originalOpenAI $hadCoordination $originalCoordination
  & pnpm verify:first-run-package $installedExecutable $evidenceRoot
  if ($LASTEXITCODE -ne 0) {
    throw "Installed executable first-launch smoke failed with $LASTEXITCODE"
  }

  [ordered]@{
    setup = $setupCandidates[0].FullName
    setupExitCode = $setupProcess.ExitCode
    installedExecutable = $installedExecutable
    installationRoot = $installRoot
    credentialEnvironment = "cleared"
    credentialCommandPath = "empty"
    isolatedUserData = $true
    evidenceRoot = $evidenceRoot
  } | ConvertTo-Json -Depth 4
} finally {
  Restore-Environment $originalPath $hadDeepSeek $originalDeepSeek $hadOpenAI $originalOpenAI $hadCoordination $originalCoordination
  if ($installedBySmoke) {
    $updateExecutable = Join-Path $installRoot "Update.exe"
    if (Test-Path -LiteralPath $updateExecutable -PathType Leaf) {
      $uninstallProcess = Start-Process -FilePath $updateExecutable -ArgumentList "--uninstall", "-s" -Wait -PassThru
      if ($uninstallProcess.ExitCode -ne 0) {
        throw "Squirrel uninstall exited with $($uninstallProcess.ExitCode)"
      }
    }
    if (Test-Path -LiteralPath $installRoot) {
      Remove-Item -LiteralPath $installRoot -Recurse -Force
    }
    if (Test-Path -LiteralPath $userDataRoot) {
      Remove-Item -LiteralPath $userDataRoot -Recurse -Force
    }
  }
  if (Test-Path -LiteralPath $temporaryRoot) {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force
  }
}
