# Castle Installer for Windows
# Usage: iwr -useb https://castlekit.com/install.ps1 | iex
#        & ([scriptblock]::Create((iwr -useb https://castlekit.com/install.ps1))) -Version 0.4.0 -NoOnboard -DryRun

param(
    [string]$Version = "latest",
    [switch]$NoOnboard,
    [switch]$DryRun,
    [switch]$Verbose,
    [switch]$Help
)

$ErrorActionPreference = "Stop"

# --- Taglines -----------------------------------------------------------------

$Taglines = @(
    "Your kingdom awaits, sire."
    "The throne room is ready."
    "A fortress for your AI agents."
    "All hail the command center."
    "Knights of the round terminal."
    "Raise the drawbridge, lower the latency."
    "By royal decree, your agents are assembled."
    "The court is now in session."
    "From castle walls to API calls."
    "Forged in code, ruled by you."
    "Every king needs a castle."
    "Where agents serve and dragons compile."
    "The siege of busywork ends here."
    "Hear ye, hear ye -- your agents await."
    "A castle built on open source bedrock."
    "One does not simply walk in without a CLI."
    "The moat is deep but the docs are deeper."
    "Fear not the dark mode, for it is default."
    "In the land of AI, the castlekeeper wears a hoodie."
    "Excalibur was a sword. This is better."
    "npm install --save-the-kingdom."
    "The Round Table, but make it a dashboard."
    "Dragons? Handled. Bugs? Working on it."
    "A quest to automate the mundane."
)

$Tagline = $Taglines | Get-Random

# --- Banner -------------------------------------------------------------------

function Print-Banner {
    $banner = @(
        '                                  |>>>'
        '                                  |'
        '                    |>>>      _  _|_  _         |>>>'
        '                    |        |;| |;| |;|        |'
        '                _  _|_  _    \.    .  /    _  _|_  _'
        '               |;|_|;|_|;|    \:. ,  /    |;|_|;|_|;|'
        '               \..      /    ||;   . |    \.    .  /'
        '                \.  ,  /     ||:  .  |     \:  .  /'
        '                 ||:   |_   _ ||_ . _ | _   _||:   |'
        '                 ||:  .|||_|;|_|;|_|;|_|;|_|;||:.  |'
        '                 ||:   ||.    .     .      . ||:  .|'
        '                 ||: . || .     . .   .  ,   ||:   |       \,/'
        '                 ||:   ||:  ,  _______   .   ||: , |            /`\\'
        '                 ||:   || .   /+++++++\    . ||:   |'
        '                 ||:   ||.    |+++++++| .    ||: . |'
        '              __ ||: . ||: ,  |+++++++|.  . _||_   |'
        "     ____--``~    '--~~__|.    |+++++__|----~    ~``---,              ___"
        "-~--~                   ~---__|,--~'                  ~~----_____-~'   ``~----~~"
    )
    # Blue-to-purple gradient using ANSI escape codes
    $gradient = @(27, 27, 33, 33, 63, 63, 99, 99, 135, 135, 141, 141, 177, 177, 177, 176, 176, 176)
    Write-Host ""
    for ($i = 0; $i -lt $banner.Length; $i++) {
        $color = $gradient[$i]
        Write-Host "`e[38;5;${color}m$($banner[$i])`e[0m"
    }
    Write-Host ""
    Write-Host "  " -NoNewline
    Write-Host "Castle" -ForegroundColor Blue -NoNewline
    Write-Host " - The multi-agent workspace" -ForegroundColor DarkGray
    Write-Host "  $Tagline" -ForegroundColor DarkGray
    Write-Host ""
}

# --- Help ---------------------------------------------------------------------

function Print-Usage {
    Write-Host "Castle installer (Windows)"
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  iwr -useb https://castlekit.com/install.ps1 | iex"
    Write-Host "  & ([scriptblock]::Create((iwr -useb https://castlekit.com/install.ps1))) [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Version <version>    npm version to install (default: latest)"
    Write-Host "  -NoOnboard            Skip setup wizard after install"
    Write-Host "  -DryRun               Print what would happen (no changes)"
    Write-Host "  -Verbose              Print debug output"
    Write-Host "  -Help                 Show this help"
    Write-Host ""
    Write-Host "Environment variables:"
    Write-Host "  CASTLE_VERSION=latest|<semver>"
    Write-Host "  CASTLE_NO_ONBOARD=1"
    Write-Host "  CASTLE_DRY_RUN=1"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  iwr -useb https://castlekit.com/install.ps1 | iex"
    Write-Host '  & ([scriptblock]::Create((iwr -useb https://castlekit.com/install.ps1))) -NoOnboard'
}

# --- Environment variable overrides -------------------------------------------

if (-not $PSBoundParameters.ContainsKey("Version")) {
    if (-not [string]::IsNullOrWhiteSpace($env:CASTLE_VERSION)) {
        $Version = $env:CASTLE_VERSION
    }
}
if (-not $PSBoundParameters.ContainsKey("NoOnboard")) {
    if ($env:CASTLE_NO_ONBOARD -eq "1") {
        $NoOnboard = $true
    }
}
if (-not $PSBoundParameters.ContainsKey("DryRun")) {
    if ($env:CASTLE_DRY_RUN -eq "1") {
        $DryRun = $true
    }
}

# --- Helpers ------------------------------------------------------------------

function Refresh-Path {
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# --- Node.js ------------------------------------------------------------------

function Check-Node {
    try {
        $nodeVersion = (node -v 2>$null)
        if ($nodeVersion) {
            $major = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
            if ($major -ge 22) {
                Write-Host "[OK] Node.js $nodeVersion found" -ForegroundColor Green
                return $true
            } else {
                Write-Host "[!] Node.js $nodeVersion found, but v22+ required" -ForegroundColor Yellow
                return $false
            }
        }
    } catch {
        Write-Host "[!] Node.js not found" -ForegroundColor Yellow
        return $false
    }
    return $false
}

function Install-Node {
    Write-Host "[*] Installing Node.js 22..." -ForegroundColor Yellow

    # Try winget first (Windows 11 / Windows 10 with App Installer)
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host "  Using winget..." -ForegroundColor Gray
        winget install OpenJS.NodeJS.LTS --source winget --accept-package-agreements --accept-source-agreements
        Refresh-Path
        Write-Host "[OK] Node.js installed via winget" -ForegroundColor Green
        return
    }

    # Try Chocolatey
    if (Get-Command choco -ErrorAction SilentlyContinue) {
        Write-Host "  Using Chocolatey..." -ForegroundColor Gray
        choco install nodejs-lts -y
        Refresh-Path
        Write-Host "[OK] Node.js installed via Chocolatey" -ForegroundColor Green
        return
    }

    # Try Scoop
    if (Get-Command scoop -ErrorAction SilentlyContinue) {
        Write-Host "  Using Scoop..." -ForegroundColor Gray
        scoop install nodejs-lts
        Write-Host "[OK] Node.js installed via Scoop" -ForegroundColor Green
        return
    }

    # No package manager available
    Write-Host ""
    Write-Host "Error: Could not find a package manager (winget, choco, or scoop)" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please install Node.js 22+ manually:" -ForegroundColor Yellow
    Write-Host "  https://nodejs.org/en/download/" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or install winget (App Installer) from the Microsoft Store." -ForegroundColor Gray
    exit 1
}

# --- Git ----------------------------------------------------------------------

function Check-Git {
    if (Get-Command git -ErrorAction SilentlyContinue) {
        Write-Host "[OK] Git found" -ForegroundColor Green
        return $true
    }
    Write-Host "[!] Git not found (optional -- needed for some npm packages)" -ForegroundColor Yellow
    return $false
}

# --- npm PATH -----------------------------------------------------------------

function Ensure-NpmGlobalOnPath {
    $npmPrefix = $null
    try {
        $npmPrefix = (npm config get prefix 2>$null).Trim()
    } catch {
        return
    }

    if ([string]::IsNullOrWhiteSpace($npmPrefix)) { return }

    # On Windows, npm global bin is directly in the prefix (not prefix/bin)
    $npmBin = $npmPrefix
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not ($userPath -split ";" | Where-Object { $_ -ieq $npmBin })) {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$npmBin", "User")
        Refresh-Path
        Write-Host "[!] Added $npmBin to user PATH" -ForegroundColor Yellow
    }
}

function Resolve-CastleBin {
    # Check if castle is on PATH
    if (Get-Command castle -ErrorAction SilentlyContinue) {
        return (Get-Command castle).Source
    }

    Refresh-Path

    if (Get-Command castle -ErrorAction SilentlyContinue) {
        return (Get-Command castle).Source
    }

    # Check common npm global locations
    $npmPrefix = $null
    try { $npmPrefix = (npm config get prefix 2>$null).Trim() } catch {}
    if ($npmPrefix -and (Test-Path (Join-Path $npmPrefix "castle.cmd"))) {
        return (Join-Path $npmPrefix "castle.cmd")
    }

    # Check AppData roaming npm
    $roamingNpm = Join-Path $env:APPDATA "npm"
    if (Test-Path (Join-Path $roamingNpm "castle.cmd")) {
        return (Join-Path $roamingNpm "castle.cmd")
    }

    return $null
}

# --- Existing installation ----------------------------------------------------

function Check-ExistingCastle {
    try {
        $null = Get-Command castle -ErrorAction Stop
        Write-Host "[*] Existing Castle installation detected" -ForegroundColor Yellow
        return $true
    } catch {
        return $false
    }
}

# --- Install Castle -----------------------------------------------------------

function Install-Castle {
    $installSpec = "@castlekit/castle@$Version"

    # Check if already installed with matching version
    $resolvedVersion = $null
    try {
        $resolvedVersion = (npm view $installSpec version 2>$null).Trim()
    } catch {}

    $installedVersion = $null
    try {
        $npmList = npm list -g @castlekit/castle --depth=0 2>$null
        if ($npmList -match '@castlekit/castle@(\S+)') {
            $installedVersion = $Matches[1]
        }
    } catch {}

    if ($resolvedVersion -and ($installedVersion -eq $resolvedVersion)) {
        Write-Host "[OK] Castle $resolvedVersion already installed" -ForegroundColor Green
        return
    }

    if ($resolvedVersion) {
        Write-Host "[*] Installing Castle $resolvedVersion..." -ForegroundColor Yellow
    } else {
        Write-Host "[*] Installing Castle ($Version)..." -ForegroundColor Yellow
    }

    # Suppress npm noise
    $prevLogLevel = $env:NPM_CONFIG_LOGLEVEL
    $prevUpdateNotifier = $env:NPM_CONFIG_UPDATE_NOTIFIER
    $prevFund = $env:NPM_CONFIG_FUND
    $prevAudit = $env:NPM_CONFIG_AUDIT
    $env:NPM_CONFIG_LOGLEVEL = "error"
    $env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
    $env:NPM_CONFIG_FUND = "false"
    $env:NPM_CONFIG_AUDIT = "false"
    try {
        $npmOutput = npm install -g $installSpec 2>&1
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[!] npm install failed" -ForegroundColor Red
            $npmOutput | ForEach-Object { Write-Host $_ }
            Write-Host ""
            Write-Host "Try: npm install -g --force $installSpec" -ForegroundColor Cyan
            exit 1
        }
    } finally {
        $env:NPM_CONFIG_LOGLEVEL = $prevLogLevel
        $env:NPM_CONFIG_UPDATE_NOTIFIER = $prevUpdateNotifier
        $env:NPM_CONFIG_FUND = $prevFund
        $env:NPM_CONFIG_AUDIT = $prevAudit
    }

    Write-Host "[OK] Castle installed" -ForegroundColor Green
}

# --- Main ---------------------------------------------------------------------

function Main {
    if ($Help) {
        Print-Usage
        return
    }

    if ($DryRun) {
        Write-Host "[OK] Dry run" -ForegroundColor Green
        Write-Host "[OK] Version: $Version" -ForegroundColor Green
        if ($NoOnboard) {
            Write-Host "[OK] Onboard: skipped" -ForegroundColor Green
        }
        Write-Host "Dry run complete (no changes made)." -ForegroundColor DarkGray
        return
    }

    # Check PowerShell version
    if ($PSVersionTable.PSVersion.Major -lt 5) {
        Write-Host "Error: PowerShell 5+ required" -ForegroundColor Red
        exit 1
    }

    Write-Host "[OK] Windows detected" -ForegroundColor Green

    # Check for existing installation
    $isUpgrade = Check-ExistingCastle

    # Step 1: Node.js
    if (-not (Check-Node)) {
        Install-Node

        # Verify after install
        if (-not (Check-Node)) {
            Write-Host ""
            Write-Host "Error: Node.js installation may require a terminal restart" -ForegroundColor Red
            Write-Host "Please close this terminal, open a new one, and run this installer again." -ForegroundColor Yellow
            exit 1
        }
    }

    # Step 2: Git check (non-blocking)
    Check-Git | Out-Null

    # Step 3: Ensure npm global bin is on PATH
    Ensure-NpmGlobalOnPath

    # Step 4: Install Castle
    Install-Castle

    # Resolve castle binary
    Refresh-Path
    $castleBin = Resolve-CastleBin

    Write-Host ""
    if ($isUpgrade) {
        $updateMessages = @(
            "The castle walls have been reinforced, my liege."
            "New fortifications in place. The kingdom grows stronger."
            "The royal engineers have been busy. Upgrade complete."
            "Fresh stonework, same castle. Miss me?"
            "The drawbridge has been upgraded. Smoother entry guaranteed."
        )
        Write-Host "Castle upgraded successfully!" -ForegroundColor Green
        Write-Host ($updateMessages | Get-Random) -ForegroundColor DarkGray
    } else {
        $completionMessages = @(
            "The castle has been erected. Long may it stand!"
            "Your fortress is ready, sire. What are your orders?"
            "The court is assembled. Your agents await."
            "A fine castle indeed. Time to rule."
            "Stone by stone, the kingdom begins."
        )
        Write-Host "Castle installed successfully!" -ForegroundColor Green
        Write-Host ($completionMessages | Get-Random) -ForegroundColor DarkGray
    }
    Write-Host ""

    if (-not $castleBin) {
        Write-Host "[!] Castle is not on PATH yet." -ForegroundColor Yellow
        Write-Host "Restart PowerShell, then run: castle setup" -ForegroundColor Cyan
        $npmPrefix = $null
        try { $npmPrefix = (npm config get prefix 2>$null).Trim() } catch {}
        if ($npmPrefix) {
            Write-Host "Expected path: $npmPrefix" -ForegroundColor DarkGray
        }
        return
    }

    # Step 5: Run setup
    if ($NoOnboard) {
        Write-Host "Skipping setup (requested). Run " -NoNewline
        Write-Host "castle setup" -ForegroundColor Cyan -NoNewline
        Write-Host " later."
    } elseif (Test-Path (Join-Path $env:USERPROFILE ".castle\castle.json")) {
        Write-Host "[OK] Castle is already configured" -ForegroundColor Green
        Write-Host "Run " -NoNewline -ForegroundColor DarkGray
        Write-Host "castle setup" -ForegroundColor Cyan -NoNewline
        Write-Host " to reconfigure." -ForegroundColor DarkGray
    } else {
        Write-Host "Starting setup..." -ForegroundColor Cyan
        Write-Host ""
        & $castleBin setup
    }
}

# --- Entry --------------------------------------------------------------------

Print-Banner
Main
