$ErrorActionPreference = 'Stop'

$repo = 'lordfoogthe4rd/miyapad'
$api = "https://api.github.com/repos/$repo/releases/latest"

Write-Host 'Fetching latest release...'
$release = Invoke-RestMethod -Uri $api -Headers @{ 'Accept' = 'application/vnd.github+json'; 'User-Agent' = 'miyapad-update' }

$asset = $release.assets | Where-Object { $_.name -like '*win-x64*' } | Select-Object -First 1

if (-not $asset) {
	Write-Host "No matching asset found for win-x64."
	Write-Host "Download manually from: $($release.html_url)"
	exit 1
}

$archive = Join-Path $env:TEMP 'miyapad-update.zip'
Write-Host "Downloading $($asset.browser_download_url)"
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive

if (-not (Test-Path $archive) -or (Get-Item $archive).Length -eq 0) {
	Write-Host 'Downloaded file is empty. Aborting.'
	exit 1
}

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$stage = Join-Path $env:TEMP ("miyapad-stage-" + [System.Guid]::NewGuid().ToString('N'))
# ponytail: extract to staging first so a bad/interrupted archive can't
# half-overwrite the live install. Trusted GitHub source, no rollback.
try {
	Write-Host 'Staging update...'
	Expand-Archive -Path $archive -DestinationPath $stage -Force
	Write-Host "Installing into $dir"
	Copy-Item -Path (Join-Path $stage '*') -Destination $dir -Recurse -Force
}
finally {
	Remove-Item $archive -Force -ErrorAction SilentlyContinue
	Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Update complete. Restart miyapad to apply.'
