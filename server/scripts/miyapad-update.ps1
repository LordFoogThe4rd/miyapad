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
Write-Host "Extracting into $dir"
Expand-Archive -Path $archive -DestinationPath $dir -Force
Remove-Item $archive -Force

Write-Host 'Update complete. Restart miyapad to apply.'
