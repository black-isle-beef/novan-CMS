[CmdletBinding()]
param(
    # Audit only projects affected since the Nx base (CI). Without it every Angular project is audited.
    [switch]$Affected
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$npx = if ($env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
$graphFile = Join-Path $repoRoot 'tmp/ci/project-graph.json'

Push-Location $repoRoot
try {
    & $npx nx graph --file=$graphFile | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "nx graph failed with exit code $LASTEXITCODE." }
    $nodes = (Get-Content $graphFile -Raw | ConvertFrom-Json).graph.nodes

    $names = if ($Affected) {
        $json = & $npx nx show projects --affected --json
        if ($LASTEXITCODE -ne 0) { throw "nx show projects failed with exit code $LASTEXITCODE." }
        @($json | ConvertFrom-Json)
    }
    else {
        @($nodes.PSObject.Properties.Name)
    }

    # An Angular project has at least one target run by an Angular builder.
    $roots = @(
        foreach ($name in $names) {
            $node = $nodes.$name
            $executors = @($node.data.targets.PSObject.Properties.Value | ForEach-Object { $_.executor })
            if ($executors | Where-Object { $_ -like '@angular/*' -or $_ -like '@nx/angular:*' }) {
                $node.data.root
            }
        }
    )

    if ($roots.Count -eq 0) {
        Write-Host 'No affected Angular projects.'
        exit 0
    }
    Write-Host ("Auditing: {0}" -f ($roots -join ', '))
    & (Join-Path $repoRoot '.claude/skills/angular-scss-compliance-remediator/audit.ps1') -Projects $roots
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
