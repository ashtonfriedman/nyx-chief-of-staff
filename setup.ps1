# Agent Mind — Setup Script
# Run this once after cloning/extracting the kit.
# This script prepares the environment; the actual personality bootstrapping
# happens through Copilot when you first open the repo.
#
# ── If this script won't run (PowerShell execution policy) ────────────────────
# Windows blocks unsigned scripts by default, and files extracted from a zip are
# also flagged with a "mark of the web". If you see
#   "... setup.ps1 cannot be loaded because running scripts is disabled ..."
# or "... is not digitally signed ...", pick ONE of the following:
#
#   1. Unblock this file (clears the downloaded-from-internet flag), then run:
#        Unblock-File .\setup.ps1
#        .\setup.ps1
#
#   2. Run it once, bypassing policy for this process only (does not change
#      machine settings):
#        powershell -ExecutionPolicy Bypass -File .\setup.ps1
#      (or, in an open session:  Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass)
#
#   3. Sign it yourself if your org requires signed scripts and you have a
#      code-signing certificate:
#        $cert = (Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert)[0]
#        Set-AuthenticodeSignature -FilePath .\setup.ps1 -Certificate $cert
# ─────────────────────────────────────────────────────────────────────────────

param(
    [switch]$SkipMaintenance,
    [switch]$SkipGraph,
    [switch]$InstallCli
)

$ErrorActionPreference = 'Stop'

Write-Host "`n=== Agent Mind Setup ===" -ForegroundColor Cyan
Write-Host "Preparing your agent's environment...`n"

# Collect any prerequisites the user must install/fix manually.
$prereqWarnings = @()

# 1. Check prerequisites (Node.js, Git, GitHub Copilot CLI)
Write-Host "[1/7] Checking prerequisites..." -ForegroundColor Yellow

# Node.js 18+
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodeVer = (& node --version) -replace '^v', ''
    $nodeMajor = [int]($nodeVer.Split('.')[0])
    if ($nodeMajor -ge 18) {
        Write-Host "  Node.js v$nodeVer" -ForegroundColor Green
    } else {
        Write-Host "  Node.js v$nodeVer found, but v18+ is required" -ForegroundColor Red
        $prereqWarnings += "Upgrade Node.js to v18 or later: https://nodejs.org"
    }
} else {
    Write-Host "  Node.js not found" -ForegroundColor Red
    $prereqWarnings += "Install Node.js 18+: https://nodejs.org"
}

# Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host "  Git $((git --version) -replace 'git version ', '')" -ForegroundColor Green
} else {
    Write-Host "  Git not found" -ForegroundColor Red
    $prereqWarnings += "Install Git: https://git-scm.com/download/win"
}

# GitHub Copilot CLI — auto-install via npm if missing
if (Get-Command copilot -ErrorAction SilentlyContinue) {
    Write-Host "  GitHub Copilot CLI installed" -ForegroundColor Green
} else {
    Write-Host "  GitHub Copilot CLI not found" -ForegroundColor Yellow
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Write-Host "    Installing (npm install -g @github/copilot)..." -ForegroundColor Yellow
        try {
            npm install -g @github/copilot --quiet 2>&1 | Out-Null
            if (Get-Command copilot -ErrorAction SilentlyContinue) {
                Write-Host "    GitHub Copilot CLI installed" -ForegroundColor Green
            } else {
                Write-Host "    Installed, but 'copilot' isn't on PATH yet — restart your terminal" -ForegroundColor Yellow
                $prereqWarnings += "Restart your terminal so the 'copilot' command is on PATH"
            }
        } catch {
            Write-Host "    Auto-install failed — run 'npm install -g @github/copilot' manually" -ForegroundColor Red
            $prereqWarnings += "Install GitHub Copilot CLI: npm install -g @github/copilot"
        }
    } else {
        $prereqWarnings += "Install GitHub Copilot CLI: npm install -g @github/copilot (needs Node.js/npm first)"
    }
}

# the Copilot CLI — the recommended launcher is `copilot`
$cliBin = Join-Path $env:APPDATA "copilot\CurrentVersion\copilot.exe"
$cliInstallerUrl = "https://example.com/install-cli.ps1" # Replace with your CLI installer URL
if ((Get-Command copilot -ErrorAction SilentlyContinue) -or (Test-Path $cliBin)) {
    Write-Host "  the Copilot CLI installed" -ForegroundColor Green
} else {
    Write-Host "  the Copilot CLI not found" -ForegroundColor Yellow
    Write-Host "    the Copilot CLI can be installed with your CLI installer. This downloads and" -ForegroundColor Yellow
    Write-Host "    runs a remote script from your provider:" -ForegroundColor Yellow
    Write-Host "      iex `"& { `$(irm $cliInstallerUrl) } copilot-cli`"" -ForegroundColor DarkGray

    # Only fetch-and-run remote code with explicit consent (-InstallCli to skip the prompt).
    $consent = $InstallCli
    if (-not $consent) {
        try {
            $answer = Read-Host "    Download and run the Copilot CLI installer from $cliInstallerUrl now? [y/N]"
            $consent = $answer -match '^(y|yes)$'
        } catch {
            # Non-interactive session — don't run remote code without an explicit opt-in.
            $consent = $false
        }
    }

    if ($consent) {
        Write-Host "    Installing the Copilot CLI..." -ForegroundColor Yellow
        try {
            Invoke-Expression "& { $(Invoke-RestMethod $cliInstallerUrl) } copilot-cli"
            if ((Get-Command copilot -ErrorAction SilentlyContinue) -or (Test-Path $cliBin)) {
                Write-Host "    the Copilot CLI installed" -ForegroundColor Green
            } else {
                Write-Host "    Installed, but 'copilot' isn't on PATH yet — restart your terminal" -ForegroundColor Yellow
                $prereqWarnings += "Restart your terminal so the 'copilot' command is on PATH"
            }
        } catch {
            Write-Host "    Auto-install failed — install the Copilot CLI manually" -ForegroundColor Red
            $prereqWarnings += "Install the Copilot CLI with your installer: iex '& { `$(irm $cliInstallerUrl) } copilot-cli' (docs: https://docs.example.com/cli)"
        }
    } else {
        Write-Host "    Skipped the Copilot CLI install." -ForegroundColor DarkGray
        $prereqWarnings += "Install the Copilot CLI with your installer: iex '& { `$(irm $cliInstallerUrl) } copilot-cli' (docs: https://docs.example.com/cli)"
    }
}

# 2. Initialize git repo (if not already)
if (-not (Test-Path ".git")) {
    Write-Host "[2/7] Initializing git repository..." -ForegroundColor Yellow
    git init
    git add -A
    git commit -m "chore: initial kit from Agent Starter Kit v3"
} else {
    Write-Host "[2/7] Git repository already exists — skipping init" -ForegroundColor Green
}

# 2. Remove remote (safety — this is a local-only repo)
$remote = git remote 2>$null
if ($remote) {
    Write-Host "[3/7] Removing git remote (this is a local-only repo)..." -ForegroundColor Yellow
    git remote remove origin 2>$null
} else {
    Write-Host "[3/7] No git remote found — good" -ForegroundColor Green
}

# 3. Install Node dependencies (knowledge graph + extensions)
if (-not $SkipGraph) {
    Write-Host "[4/7] Installing Node dependencies (graph + extensions)..." -ForegroundColor Yellow

    $nodeDirs = @()
    if (Test-Path "graph/package.json") { $nodeDirs += (Resolve-Path "graph").Path }
    if (Test-Path ".github/extensions") {
        $nodeDirs += Get-ChildItem ".github/extensions" -Directory |
            Where-Object { Test-Path (Join-Path $_.FullName "package.json") } |
            ForEach-Object { $_.FullName }
    }

    if ($nodeDirs.Count -eq 0) {
        Write-Host "  No package.json found in graph/ or extensions — skipping" -ForegroundColor DarkGray
    } else {
        foreach ($dir in $nodeDirs) {
            $label = Split-Path $dir -Leaf
            Push-Location $dir
            try {
                npm install --quiet 2>&1 | Out-Null
                Write-Host "  $label dependencies installed" -ForegroundColor Green
            } catch {
                Write-Host "  Warning: npm install failed in $label. Run 'npm install' there manually." -ForegroundColor Red
                $prereqWarnings += "Run 'npm install' in $dir"
            }
            Pop-Location
        }
    }
} else {
    Write-Host "[4/7] Skipping Node dependency setup (-SkipGraph)" -ForegroundColor DarkGray
}

# 5. Install Python skill dependencies
Write-Host "[5/7] Installing Python skill dependencies..." -ForegroundColor Yellow
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    $pythonCmd = Get-Command py -ErrorAction SilentlyContinue
}
if ($pythonCmd) {
    try {
        & $pythonCmd.Source -m pip install -r requirements.txt
        Write-Host "  Python skill dependencies installed" -ForegroundColor Green
    } catch {
        Write-Host "  Warning: pip install failed. Run 'python -m pip install -r requirements.txt' manually." -ForegroundColor Red
        $prereqWarnings += "Install Python skill dependencies: python -m pip install -r requirements.txt"
    }
} else {
    Write-Host "  Python not found" -ForegroundColor Red
    $prereqWarnings += "Install Python 3 and run 'python -m pip install -r requirements.txt' manually"
}

# 6. Register maintenance daemon
if (-not $SkipMaintenance) {
    $regScript = ".github/scripts/Register-AgentMaintenance.ps1"
    if (Test-Path $regScript) {
        Write-Host "[6/7] Registering optional maintenance daemon..." -ForegroundColor Yellow
        try {
            & $regScript
            Write-Host "  Maintenance task registered" -ForegroundColor Green
        } catch {
            Write-Host "  Skipped — this optional step needs an admin shell." -ForegroundColor DarkGray
            Write-Host "  The agent works fully without it. To enable later, run PowerShell as" -ForegroundColor DarkGray
            Write-Host "  Administrator and run: $regScript" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "[6/7] No maintenance registration script found — skipping" -ForegroundColor DarkGray
    }
} else {
    Write-Host "[6/7] Skipping maintenance setup (-SkipMaintenance)" -ForegroundColor DarkGray
}

# 7. Verify structure
Write-Host "[7/7] Verifying directory structure..." -ForegroundColor Yellow
$requiredDirs = @(
    ".github/skills",
    ".github/agents",
    ".github/extensions",
    ".github/scripts",
    ".working-memory",
    ".bootstrap-temp",
    "domains",
    "expertise",
    "initiatives",
    "inbox",
    "Archive",
    "graph"
)

$missing = @()
foreach ($dir in $requiredDirs) {
    if (-not (Test-Path $dir)) {
        $missing += $dir
    }
}

if ($missing.Count -eq 0) {
    Write-Host "  All directories present" -ForegroundColor Green
} else {
    Write-Host "  Missing directories:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "    - $_" -ForegroundColor Red }
}

# Summary
Write-Host "`n=== Setup Complete ===" -ForegroundColor Cyan

if ($prereqWarnings.Count -gt 0) {
    Write-Host "`nBefore you start, finish these prerequisites:" -ForegroundColor Yellow
    $prereqWarnings | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
}

Write-Host @"

Next steps:
  1. Start your agent by running Copilot CLI in this folder:

       copilot

  2. Type "hi" to kick off the bootstrap protocol. It guides you
     through creating your agent's personality, name, and configuration.
  3. Bootstrap takes about 5 minutes and creates your SOUL.md, agent file,
     and seeds your working memory.

For more information, see README.md
"@ -ForegroundColor White
