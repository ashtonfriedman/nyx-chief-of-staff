<#
.SYNOPSIS
    Upgrades a v1 Agent Starter Kit to v2.

.DESCRIPTION
    Additive overlay — copies new skills, agents, expertise, graph, extensions,
    and maintenance infrastructure from a v2 kit into an existing v1 installation.
    
    NEVER overwrites: SOUL.md, memory.md, log.md, user-section of rules.md,
    domain files, initiative files, or inbox contents.

.PARAMETER Source
    Path to the extracted v2 kit (PM or Eng). Defaults to the directory
    containing this script.

.PARAMETER Target
    Path to the existing v1 kit installation to upgrade.

.PARAMETER DryRun
    Show what would change without modifying anything.

.EXAMPLE
    .\upgrade-v2.ps1 -Target "C:\Users\me\my-agent"
    .\upgrade-v2.ps1 -Source ".\agent-kit" -Target "C:\Users\me\my-agent" -DryRun
#>
param(
    [string]$Source = $PSScriptRoot,
    [Parameter(Mandatory)][string]$Target,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# ── Helpers ──────────────────────────────────────────────────────────
function Write-Step  { param([string]$msg) Write-Host "  → $msg" -ForegroundColor Cyan }
function Write-Skip  { param([string]$msg) Write-Host "  ○ $msg" -ForegroundColor DarkGray }
function Write-Done  { param([string]$msg) Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn  { param([string]$msg) Write-Host "  ⚠ $msg" -ForegroundColor Yellow }

function Copy-DirectorySafe {
    param([string]$From, [string]$To, [string]$Label)
    if (!(Test-Path $From)) { Write-Skip "$Label — source not found"; return 0 }
    $files = Get-ChildItem $From -Recurse -File
    $copied = 0
    foreach ($f in $files) {
        $rel = $f.FullName.Substring($From.Length).TrimStart('\')
        $dest = Join-Path $To $rel
        $destDir = Split-Path $dest -Parent
        if (!(Test-Path $destDir)) {
            if (!$DryRun) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        }
        if (!(Test-Path $dest)) {
            if (!$DryRun) { Copy-Item $f.FullName $dest -Force }
            $copied++
        } else {
            # Overwrite if source is newer or different size
            $existing = Get-Item $dest
            if ($f.Length -ne $existing.Length) {
                if (!$DryRun) { Copy-Item $f.FullName $dest -Force }
                $copied++
            }
        }
    }
    return $copied
}

# ── Validate ─────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║   Agent Starter Kit v1 → v2 Upgrade  ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════╝`n" -ForegroundColor Magenta

if ($DryRun) { Write-Host "  DRY RUN — no files will be modified`n" -ForegroundColor Yellow }

# Resolve paths
$Source = (Resolve-Path $Source).Path
$Target = (Resolve-Path $Target).Path

# Verify source is a v2 kit
if (!(Test-Path "$Source\.github\skills\agent-maintenance")) {
    throw "Source doesn't look like a v2 kit (missing agent-maintenance skill). Path: $Source"
}

# Verify target is a v1 kit
if (!(Test-Path "$Target\.working-memory") -or !(Test-Path "$Target\.github")) {
    throw "Target doesn't look like a starter kit (missing .working-memory/ or .github/). Path: $Target"
}

Write-Host "  Source: $Source"
Write-Host "  Target: $Target`n"

# ── Phase 1: Backup ─────────────────────────────────────────────────
Write-Host "Phase 1: Backup" -ForegroundColor White
$backupDir = Join-Path $Target ".upgrade-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
if (!$DryRun) {
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    
    # Back up .working-memory
    if (Test-Path "$Target\.working-memory") {
        Copy-Item "$Target\.working-memory" "$backupDir\.working-memory" -Recurse
    }
    # Back up .github
    if (Test-Path "$Target\.github") {
        Copy-Item "$Target\.github" "$backupDir\.github" -Recurse
    }
    # Back up expertise
    if (Test-Path "$Target\expertise") {
        Copy-Item "$Target\expertise" "$backupDir\expertise" -Recurse
    }
}
Write-Done "Backup created at $backupDir"

# ── Phase 2: New Skills ─────────────────────────────────────────────
Write-Host "`nPhase 2: Skills" -ForegroundColor White
$srcSkills = Get-ChildItem "$Source\.github\skills" -Directory
$newSkills = 0
foreach ($skill in $srcSkills) {
    $destSkill = Join-Path "$Target\.github\skills" $skill.Name
    if (!(Test-Path $destSkill)) {
        Write-Step "NEW skill: $($skill.Name)"
        if (!$DryRun) {
            Copy-Item $skill.FullName $destSkill -Recurse
        }
        $newSkills++
    } else {
        # Update existing skill files (overwrite with v2 versions)
        $updated = Copy-DirectorySafe $skill.FullName $destSkill $skill.Name
        if ($updated -gt 0) {
            Write-Step "UPDATED skill: $($skill.Name) ($updated files)"
        }
    }
}
Write-Done "$newSkills new skills added"

# ── Phase 3: Agents ─────────────────────────────────────────────────
Write-Host "`nPhase 3: Agents" -ForegroundColor White
$destAgents = "$Target\.github\agents"
if (!(Test-Path $destAgents)) {
    if (!$DryRun) { New-Item -ItemType Directory -Path $destAgents -Force | Out-Null }
}
$srcAgents = Get-ChildItem "$Source\.github\agents" -File -ErrorAction SilentlyContinue
$newAgents = 0
foreach ($agent in $srcAgents) {
    $destAgent = Join-Path $destAgents $agent.Name
    if (!(Test-Path $destAgent)) {
        Write-Step "NEW agent: $($agent.BaseName)"
        if (!$DryRun) { Copy-Item $agent.FullName $destAgent }
        $newAgents++
    } else {
        $existing = Get-Item $destAgent
        if ($agent.Length -ne $existing.Length) {
            Write-Step "UPDATED agent: $($agent.BaseName)"
            if (!$DryRun) { Copy-Item $agent.FullName $destAgent -Force }
        }
    }
}
Write-Done "$newAgents new agents added"

# ── Phase 4: Expertise ──────────────────────────────────────────────
Write-Host "`nPhase 4: Expertise" -ForegroundColor White
$srcExpertise = Get-ChildItem "$Source\expertise" -Directory
$newExpertise = 0
foreach ($exp in $srcExpertise) {
    $destExp = Join-Path "$Target\expertise" $exp.Name
    if (!(Test-Path $destExp)) {
        Write-Step "NEW expertise: $($exp.Name)"
        if (!$DryRun) { Copy-Item $exp.FullName $destExp -Recurse }
        $newExpertise++
    } else {
        $updated = Copy-DirectorySafe $exp.FullName $destExp $exp.Name
        if ($updated -gt 0) {
            Write-Step "UPDATED expertise: $($exp.Name) ($updated files)"
        }
    }
}
Write-Done "$newExpertise new expertise directories added"

# ── Phase 5: Graph ───────────────────────────────────────────────────
Write-Host "`nPhase 5: Knowledge Graph" -ForegroundColor White
if (Test-Path "$Source\graph") {
    $destGraph = "$Target\graph"
    if (!(Test-Path $destGraph)) {
        Write-Step "Installing knowledge graph system"
        if (!$DryRun) { Copy-Item "$Source\graph" $destGraph -Recurse }
        Write-Done "Graph installed"
    } else {
        $updated = Copy-DirectorySafe "$Source\graph" $destGraph "graph"
        Write-Done "Graph updated ($updated files)"
    }
    
    # Run npm install if package.json exists
    if ((Test-Path "$destGraph\package.json") -and !$DryRun) {
        Write-Step "Installing graph dependencies..."
        Push-Location $destGraph
        try { & npm install --quiet 2>$null } catch { Write-Warn "npm install failed — run manually: cd graph && npm install" }
        Pop-Location
    }
} else {
    Write-Skip "No graph directory in source"
}

# ── Phase 6: Extensions ─────────────────────────────────────────────
Write-Host "`nPhase 6: Extensions" -ForegroundColor White
$srcExtDir = "$Source\.github\extensions"
$destExtDir = "$Target\.github\extensions"
if (Test-Path $srcExtDir) {
    $srcExts = Get-ChildItem $srcExtDir -Directory
    $newExts = 0
    foreach ($ext in $srcExts) {
        $destExt = Join-Path $destExtDir $ext.Name
        if (!(Test-Path $destExt)) {
            Write-Step "NEW extension: $($ext.Name)"
            if (!$DryRun) { Copy-Item $ext.FullName $destExt -Recurse }
            $newExts++
        } else {
            $updated = Copy-DirectorySafe $ext.FullName $destExt $ext.Name
            if ($updated -gt 0) {
                Write-Step "UPDATED extension: $($ext.Name) ($updated files)"
            }
        }
    }
    Write-Done "$newExts new extensions added"
} else {
    Write-Skip "No extensions in source"
}

# ── Phase 7: Maintenance Scripts ─────────────────────────────────────
Write-Host "`nPhase 7: Maintenance Scripts" -ForegroundColor White
$srcScripts = "$Source\.github\scripts"
$destScripts = "$Target\.github\scripts"
if (Test-Path $srcScripts) {
    if (!(Test-Path $destScripts)) {
        if (!$DryRun) { New-Item -ItemType Directory -Path $destScripts -Force | Out-Null }
    }
    $updated = Copy-DirectorySafe $srcScripts $destScripts "scripts"
    Write-Done "Maintenance scripts installed ($updated files)"
} else {
    Write-Skip "No maintenance scripts in source"
}

# ── Phase 8: Rules Delta ────────────────────────────────────────────
Write-Host "`nPhase 8: Rules Merge" -ForegroundColor White
$srcRules = "$Source\.working-memory\rules.md"
$destRules = "$Target\.working-memory\rules.md"
if ((Test-Path $srcRules) -and (Test-Path $destRules)) {
    $srcLines = (Get-Content $srcRules) | Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\s*#' }
    $destContent = Get-Content $destRules -Raw
    $destLines = (Get-Content $destRules) | Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\s*#' }
    
    # Find rules in source that aren't in target (by trimmed content)
    $destSet = @{}
    foreach ($line in $destLines) { $destSet[$line.Trim()] = $true }
    
    $newRules = @()
    foreach ($line in $srcLines) {
        if (!$destSet.ContainsKey($line.Trim())) {
            $newRules += $line
        }
    }
    
    if ($newRules.Count -gt 0) {
        Write-Step "Appending $($newRules.Count) new rules"
        if (!$DryRun) {
            $appendBlock = "`n`n## v2 Rules (added by upgrade)`n`n"
            $appendBlock += ($newRules -join "`n")
            Add-Content -Path $destRules -Value $appendBlock
        }
        Write-Done "$($newRules.Count) rules appended"
    } else {
        Write-Skip "No new rules to add"
    }
} else {
    Write-Skip "Rules file not found in source or target"
}

# ── Phase 9: Copilot Instructions ────────────────────────────────────
Write-Host "`nPhase 9: Agent Instructions" -ForegroundColor White
$srcInstr = "$Source\.github\copilot-instructions.md"
$destInstr = "$Target\.github\copilot-instructions.md"
if (Test-Path $srcInstr) {
    if (!(Test-Path $destInstr)) {
        Write-Step "Installing copilot-instructions.md"
        if (!$DryRun) { Copy-Item $srcInstr $destInstr }
        Write-Done "Instructions installed"
    } else {
        # Back up and replace — the instructions are infrastructure, not user content
        Write-Step "Updating copilot-instructions.md (old version in backup)"
        if (!$DryRun) { Copy-Item $srcInstr $destInstr -Force }
        Write-Done "Instructions updated"
    }
} else {
    Write-Skip "No copilot-instructions.md in source"
}

# ── Phase 10: Bootstrap Templates ─────────────────────────────────────
Write-Host "`nPhase 10: Bootstrap Templates" -ForegroundColor White
$srcBoot = "$Source\.bootstrap-temp"
if (Test-Path $srcBoot) {
    $updated = Copy-DirectorySafe $srcBoot "$Target\.bootstrap-temp" "bootstrap"
    Write-Done "Bootstrap templates updated ($updated files)"
} else {
    Write-Skip "No bootstrap templates in source"
}

# ── Phase 11: Setup Script ────────────────────────────────────────────
Write-Host "`nPhase 11: Setup Script" -ForegroundColor White
$srcSetup = "$Source\setup.ps1"
if (Test-Path $srcSetup) {
    Write-Step "Updating setup.ps1"
    if (!$DryRun) { Copy-Item $srcSetup "$Target\setup.ps1" -Force }
    Write-Done "setup.ps1 updated"
} else {
    Write-Skip "No setup.ps1 in source"
}

# ── Phase 12: Mind Index ──────────────────────────────────────────────
Write-Host "`nPhase 12: Mind Index" -ForegroundColor White
$srcIndex = "$Source\mind-index.md"
if (Test-Path $srcIndex) {
    Write-Step "Updating mind-index.md"
    if (!$DryRun) { Copy-Item $srcIndex "$Target\mind-index.md" -Force }
    Write-Done "mind-index.md updated"
} else {
    Write-Skip "No mind-index.md in source"
}

# ── Phase 13: Domain READMEs ─────────────────────────────────────────
Write-Host "`nPhase 13: Domain Structure" -ForegroundColor White
$domainDirs = @('domains', 'domains\people', 'domains\services', 'domains\products', 'domains\repos', 'domains\stakeholders')
$addedReadmes = 0
foreach ($dir in $domainDirs) {
    $srcDir = Join-Path $Source $dir
    $destDir = Join-Path $Target $dir
    
    if (!(Test-Path $destDir)) {
        if (!$DryRun) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
    }
    
    # Only copy README.md (templates) — never touch user's domain files
    $srcReadme = Join-Path $srcDir "README.md"
    $destReadme = Join-Path $destDir "README.md"
    if ((Test-Path $srcReadme) -and !(Test-Path $destReadme)) {
        if (!$DryRun) { Copy-Item $srcReadme $destReadme }
        $addedReadmes++
    }
}
Write-Done "$addedReadmes domain READMEs added"

# ── Summary ───────────────────────────────────────────────────────────
Write-Host "`n╔══════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║         Upgrade Complete!             ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════╝`n" -ForegroundColor Green

Write-Host "  Protected (not modified):" -ForegroundColor White
Write-Host "    • SOUL.md" -ForegroundColor DarkGray
Write-Host "    • .working-memory/memory.md" -ForegroundColor DarkGray
Write-Host "    • .working-memory/log.md" -ForegroundColor DarkGray
Write-Host "    • domains/ (existing files)" -ForegroundColor DarkGray
Write-Host "    • initiatives/" -ForegroundColor DarkGray
Write-Host "    • inbox/" -ForegroundColor DarkGray

Write-Host "`n  Next steps:" -ForegroundColor White
Write-Host "    1. Review the new skills: Get-ChildItem .github\skills -Directory" -ForegroundColor Cyan
Write-Host "    2. Run: cd graph && npm install" -ForegroundColor Cyan
Write-Host "    3. Register maintenance: .\setup.ps1 -RegisterMaintenance" -ForegroundColor Cyan
Write-Host "    4. Start a new Copilot session to pick up new agents and skills" -ForegroundColor Cyan

if ($DryRun) {
    Write-Host "`n  This was a DRY RUN. Re-run without -DryRun to apply changes." -ForegroundColor Yellow
}

Write-Host ""
