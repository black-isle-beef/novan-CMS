[CmdletBinding()]
param(
    [switch]$Fix,
    [switch]$Build
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../..')).Path
$sourceRoots = @(
    Get-ChildItem -Path (Join-Path $repoRoot 'apps'), (Join-Path $repoRoot 'libs') -Directory -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName 'src' } |
        Where-Object { Test-Path $_ }
)
$globalStyleEntryPoints = @(
    $sourceRoots | ForEach-Object { Join-Path $_ 'styles.scss' } | Where-Object { Test-Path $_ }
)
$includeExtensions = @('.ts', '.html', '.scss', '.css')
$excludedDirectories = @('node_modules', 'dist', 'test-results', '.angular')
$findings = New-Object System.Collections.Generic.List[object]

function Get-SourceFiles {
    Get-ChildItem -Path $sourceRoots -Recurse -File | Where-Object {
        $file = $_
        $includeExtensions -contains $_.Extension.ToLowerInvariant() -and
        $file.Name -notmatch '\.(spec|stories)\.ts$' -and
        $file.FullName -notmatch '\\styles\\tokens\\|\\lib\\tokens\\' -and
        @($excludedDirectories | Where-Object { $file.FullName -like "*\$_\*" }).Count -eq 0
    }
}

function Add-Finding {
    param(
        [System.IO.FileInfo]$File,
        [string]$Rule,
        [string]$Pattern,
        [string]$Details
    )

    $relativePath = $File.FullName.Substring($repoRoot.Length + 1)
    $findings.Add([pscustomobject]@{
        File = $relativePath
        Rule = $Rule
        Pattern = $Pattern
        Details = $Details
    })
}

function Test-Pattern {
    param(
        [System.IO.FileInfo]$File,
        [string]$Rule,
        [string]$Pattern,
        [string]$Details
    )

    $patternMatches = Select-String -Path $File.FullName -Pattern $Pattern -AllMatches
    foreach ($match in $patternMatches) {
        Add-Finding -File $File -Rule $Rule -Pattern $Pattern -Details ("line {0}: {1}" -f $match.LineNumber, $Details)
    }
}

$files = @(Get-SourceFiles)

foreach ($file in $files) {
    switch ($file.Extension.ToLowerInvariant()) {
        '.ts' {
            Test-Pattern $file 'Legacy Angular APIs' '@(Input|Output)\b' 'Use input() or output() signal APIs.'
            Test-Pattern $file 'Untyped TypeScript' '(^|[^A-Za-z0-9_])(any)([^A-Za-z0-9_]|$)' 'Define an interface or type and narrow unknown values.'
            Test-Pattern $file 'Angular module usage' '@NgModule\b|\bdeclarations\s*:' 'Use standalone architecture.'
            Test-Pattern $file 'Manual RxJS subscription' '\.subscribe\s*\(' 'Prefer signals or an async pipe where applicable.'
        }
        '.html' {
            Test-Pattern $file 'Angular control flow' '\*ng(If|For|Switch)' 'Replace structural directive syntax with @if, @for, or @switch.'
            Test-Pattern $file 'Inline styling' '(^|\s)style\s*=' 'Move styling into the appropriate global stylesheet and use Bootstrap utilities.'
            Test-Pattern $file 'Inline style binding' '\[style(?:\.|\])' 'Use a semantic class and the appropriate global stylesheet.'
        }
        { $_ -in @('.scss', '.css') } {
            Test-Pattern $file 'Hardcoded SCSS colors' '(#([0-9A-Fa-f]{3,8})\b|\b(?:rgba?|hsla?)\s*\()' 'Reference Bootstrap or repository SCSS variables.'
        }
    }
}

$componentFiles = @($files | Where-Object { $_.Extension -eq '.ts' })
foreach ($file in $componentFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    if ($content -notmatch '@Component\s*\(') {
        continue
    }
    # Components are standalone by default since Angular 19; only an explicit opt-out is a violation.
    if ($content -match 'standalone\s*:\s*false') {
        Add-Finding -File $file -Rule 'Standalone components' -Pattern 'standalone: false' -Details 'Component opts out of standalone; remove standalone: false.'
    }
    if ($content -match 'styleUrls?\s*:|styleUrl\s*:') {
        Add-Finding -File $file -Rule 'Global component styles' -Pattern 'styleUrl/styleUrls' -Details 'Move component styles into the appropriate global stylesheet and remove the component stylesheet reference.'
    }
}

$componentStyleFiles = @($files | Where-Object {
    $_.Extension -in @('.scss', '.css') -and
    $_.FullName -notin $globalStyleEntryPoints -and
    $_.DirectoryName -notmatch '\\src\\styles(?:\\|$)'
})
foreach ($file in $componentStyleFiles) {
    Add-Finding -File $file -Rule 'Global component styles' -Pattern $file.Name -Details 'Component stylesheets must live under the appropriate global styles directory.'
}

$htmlFiles = @($files | Where-Object { $_.Extension -eq '.html' })
foreach ($file in $htmlFiles) {
    $content = Get-Content -Path $file.FullName -Raw
    $imageTags = [regex]::Matches($content, '<img\b[^>]*>', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
    foreach ($image in $imageTags) {
        if ($image.Value -notmatch '\balt\s*=') {
            Add-Finding -File $file -Rule 'Image accessibility' -Pattern '<img>' -Details 'Every image needs an accurate alt attribute, including dynamic images.'
        }
    }
}

if ($Fix) {
    if (Test-Path (Join-Path $repoRoot 'node_modules/.bin/prettier.cmd')) {
        & (Join-Path $repoRoot 'node_modules/.bin/prettier.cmd') --write '{apps,libs}/*/src/**/*.{ts,html,scss,css}' | Out-Host
        if ($LASTEXITCODE -ne 0) {
            throw "Prettier failed with exit code $LASTEXITCODE."
        }
        Write-Host 'Applied formatting with the repository-installed Prettier.' -ForegroundColor Green
    }
    else {
        Write-Warning 'No local Prettier executable found; semantic refactors remain for the agent to apply.'
    }
}

Write-Host ("Scanned {0} source files." -f $files.Count)
if ($findings.Count -eq 0) {
    Write-Host 'PASS: no static compliance findings.' -ForegroundColor Green
}
else {
    Write-Host ("FAIL: {0} finding(s)." -f $findings.Count) -ForegroundColor Red
    $findings | Sort-Object File, Rule | ForEach-Object {
        "{0} | {1} | {2}" -f $_.File, $_.Rule, $_.Details
    }
}

if ($Build) {
    Push-Location $repoRoot
    try {
        & npx.cmd nx run-many -t build
        if ($LASTEXITCODE -ne 0) {
            throw "Angular build failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}

if ($findings.Count -gt 0) {
    exit 1
}
exit 0
