# find-node.ps1 - Resolves the real node.exe path, following nvm junctions
$cmd = Get-Command node
$item = Get-Item $cmd.Source -Force
$target = "$($item.Target)".Trim('{}')
if ($target -and (Test-Path $target)) {
    Write-Output $target
} else {
    Write-Output $cmd.Source
}
