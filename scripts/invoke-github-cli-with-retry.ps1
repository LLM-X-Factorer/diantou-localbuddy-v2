Set-StrictMode -Version Latest

function Invoke-LocalBuddyGitHubCli {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Description,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string[]]$Arguments,

    [ValidateRange(1, 10)]
    [int]$MaximumAttempts = 5,

    [ValidateRange(1, 30)]
    [int]$InitialDelaySeconds = 3
  )

  for ($attempt = 1; $attempt -le $MaximumAttempts; $attempt += 1) {
    $commandOutput = & gh @Arguments 2>&1
    $commandExitCode = $LASTEXITCODE
    if ($commandExitCode -eq 0) {
      return $commandOutput
    }

    if ($attempt -eq $MaximumAttempts) {
      throw "GitHub CLI failed after $MaximumAttempts attempts: $Description"
    }

    $delaySeconds = [Math]::Min(30, $InitialDelaySeconds * $attempt)
    Write-Warning "GitHub CLI attempt $attempt/$MaximumAttempts failed for $Description; retrying in $delaySeconds seconds."
    Start-Sleep -Seconds $delaySeconds
  }
}
