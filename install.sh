#!/bin/bash
set -euo pipefail

# Castle Installer for macOS and Linux
# Usage: curl -fsSL --proto '=https' --tlsv1.2 https://castlekit.com/install.sh | bash

BOLD='\033[1m'
ACCENT='\033[38;2;59;130;246m'
ACCENT_DIM='\033[38;2;37;99;235m'
INFO='\033[38;2;96;165;250m'
SUCCESS='\033[38;2;34;197;94m'
WARN='\033[38;2;245;158;11m'
ERROR='\033[38;2;239;68;68m'
MUTED='\033[38;2;113;113;122m'
NC='\033[0m' # No Color

DEFAULT_TAGLINE="The multi-agent workspace."

ORIGINAL_PATH="${PATH:-}"

TMPFILES=()
cleanup_tmpfiles() {
    local f
    for f in "${TMPFILES[@]:-}"; do
        rm -f "$f" 2>/dev/null || true
    done
}
trap cleanup_tmpfiles EXIT

mktempfile() {
    local f
    f="$(mktemp)"
    TMPFILES+=("$f")
    echo "$f"
}

DOWNLOADER=""
detect_downloader() {
    if command -v curl &> /dev/null; then
        DOWNLOADER="curl"
        return 0
    fi
    if command -v wget &> /dev/null; then
        DOWNLOADER="wget"
        return 0
    fi
    echo -e "${ERROR}Error: Missing downloader (curl or wget required)${NC}"
    exit 1
}

download_file() {
    local url="$1"
    local output="$2"
    if [[ -z "$DOWNLOADER" ]]; then
        detect_downloader
    fi
    if [[ "$DOWNLOADER" == "curl" ]]; then
        curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 1 --retry-connrefused -o "$output" "$url"
        return
    fi
    wget -q --https-only --secure-protocol=TLSv1_2 --tries=3 --timeout=20 -O "$output" "$url"
}

run_remote_bash() {
    local url="$1"
    local tmp
    tmp="$(mktempfile)"
    download_file "$url" "$tmp"
    /bin/bash "$tmp"
}

# ─── Taglines ────────────────────────────────────────────────────────────────

TAGLINES=()
TAGLINES+=("Your kingdom awaits, sire.")
TAGLINES+=("The throne room is ready.")
TAGLINES+=("A fortress for your AI agents.")
TAGLINES+=("All hail the command center.")
TAGLINES+=("Knights of the round terminal.")
TAGLINES+=("Raise the drawbridge, lower the latency.")
TAGLINES+=("By royal decree, your agents are assembled.")
TAGLINES+=("The court is now in session.")
TAGLINES+=("From castle walls to API calls.")
TAGLINES+=("Forged in code, ruled by you.")
TAGLINES+=("Every king needs a castle.")
TAGLINES+=("Where agents serve and dragons compile.")
TAGLINES+=("The siege of busywork ends here.")
TAGLINES+=("Hear ye, hear ye — your agents await.")
TAGLINES+=("A castle built on open source bedrock.")
TAGLINES+=("One does not simply walk in without a CLI.")
TAGLINES+=("The moat is deep but the docs are deeper.")
TAGLINES+=("Fear not the dark mode, for it is default.")
TAGLINES+=("In the land of AI, the castlekeeper wears a hoodie.")
TAGLINES+=("Your agents kneel before the terminal.")
TAGLINES+=("Excalibur was a sword. This is better.")
TAGLINES+=("npm install --save-the-kingdom.")
TAGLINES+=("The Round Table, but make it a dashboard.")
TAGLINES+=("Dragons? Handled. Bugs? Working on it.")
TAGLINES+=("A quest to automate the mundane.")

pick_tagline() {
    local count=${#TAGLINES[@]}
    if [[ "$count" -eq 0 ]]; then
        echo "$DEFAULT_TAGLINE"
        return
    fi
    if [[ -n "${CASTLE_TAGLINE_INDEX:-}" ]]; then
        if [[ "${CASTLE_TAGLINE_INDEX}" =~ ^[0-9]+$ ]]; then
            local idx=$((CASTLE_TAGLINE_INDEX % count))
            echo "${TAGLINES[$idx]}"
            return
        fi
    fi
    local idx=$((RANDOM % count))
    echo "${TAGLINES[$idx]}"
}

TAGLINE=$(pick_tagline)

# ─── Options ─────────────────────────────────────────────────────────────────

NO_ONBOARD=${CASTLE_NO_ONBOARD:-0}
NO_PROMPT=${CASTLE_NO_PROMPT:-0}
DRY_RUN=${CASTLE_DRY_RUN:-0}
CASTLE_VERSION=${CASTLE_VERSION:-latest}
VERBOSE="${CASTLE_VERBOSE:-0}"
NPM_LOGLEVEL="${CASTLE_NPM_LOGLEVEL:-error}"
NPM_SILENT_FLAG="--silent"
CASTLE_BIN=""
HELP=0

print_usage() {
    cat <<EOF
Castle installer (macOS + Linux)

Usage:
  curl -fsSL --proto '=https' --tlsv1.2 https://castlekit.com/install.sh | bash -s -- [options]

Options:
  --version <version>    npm version to install (default: latest)
  --no-onboard           Skip setup wizard after install
  --no-prompt            Disable prompts (for CI/automation)
  --dry-run              Print what would happen (no changes)
  --verbose              Print debug output
  --help, -h             Show this help

Environment variables:
  CASTLE_VERSION=latest|<semver>
  CASTLE_NO_ONBOARD=0|1
  CASTLE_NO_PROMPT=1
  CASTLE_DRY_RUN=1
  CASTLE_VERBOSE=1
  CASTLE_NPM_LOGLEVEL=error|warn|notice

Examples:
  curl -fsSL --proto '=https' --tlsv1.2 https://castlekit.com/install.sh | bash
  curl -fsSL --proto '=https' --tlsv1.2 https://castlekit.com/install.sh | bash -s -- --no-onboard
EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --no-onboard)
                NO_ONBOARD=1
                shift
                ;;
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            --verbose)
                VERBOSE=1
                shift
                ;;
            --no-prompt)
                NO_PROMPT=1
                shift
                ;;
            --help|-h)
                HELP=1
                shift
                ;;
            --version)
                if [[ -z "${2:-}" ]]; then
                    echo "Error: --version requires a value"
                    exit 1
                fi
                CASTLE_VERSION="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done
}

configure_verbose() {
    if [[ "$VERBOSE" != "1" ]]; then
        return 0
    fi
    if [[ "$NPM_LOGLEVEL" == "error" ]]; then
        NPM_LOGLEVEL="notice"
    fi
    NPM_SILENT_FLAG=""
    set -x
}

is_promptable() {
    if [[ "$NO_PROMPT" == "1" ]]; then
        return 1
    fi
    if [[ -r /dev/tty && -w /dev/tty ]]; then
        return 0
    fi
    return 1
}

# ─── System detection ────────────────────────────────────────────────────────

is_root() {
    [[ "$(id -u)" -eq 0 ]]
}

maybe_sudo() {
    if is_root; then
        if [[ "${1:-}" == "-E" ]]; then
            shift
        fi
        "$@"
    else
        sudo "$@"
    fi
}

require_sudo() {
    if [[ "$OS" != "linux" ]]; then
        return 0
    fi
    if is_root; then
        return 0
    fi
    if command -v sudo &> /dev/null; then
        return 0
    fi
    echo -e "${ERROR}Error: sudo is required for system installs on Linux${NC}"
    echo "Install sudo or re-run as root."
    exit 1
}

# ─── Homebrew ────────────────────────────────────────────────────────────────

install_homebrew() {
    if [[ "$OS" == "macos" ]]; then
        if ! command -v brew &> /dev/null; then
            echo -e "${WARN}→${NC} Installing Homebrew..."
            run_remote_bash "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"

            if [[ -f "/opt/homebrew/bin/brew" ]]; then
                eval "$(/opt/homebrew/bin/brew shellenv)"
            elif [[ -f "/usr/local/bin/brew" ]]; then
                eval "$(/usr/local/bin/brew shellenv)"
            fi
            echo -e "${SUCCESS}✓${NC} Homebrew installed"
        else
            echo -e "${SUCCESS}✓${NC} Homebrew already installed"
        fi
    fi
}

# ─── Node.js ─────────────────────────────────────────────────────────────────

check_node() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_VERSION" -ge 22 ]]; then
            echo -e "${SUCCESS}✓${NC} Node.js v$(node -v | cut -d'v' -f2) found"
            return 0
        else
            echo -e "${WARN}→${NC} Node.js $(node -v) found, but v22+ required"
            return 1
        fi
    else
        echo -e "${WARN}→${NC} Node.js not found"
        return 1
    fi
}

install_node() {
    if [[ "$OS" == "macos" ]]; then
        echo -e "${WARN}→${NC} Installing Node.js via Homebrew..."
        brew install node@22
        brew link node@22 --overwrite --force 2>/dev/null || true
        echo -e "${SUCCESS}✓${NC} Node.js installed"
    elif [[ "$OS" == "linux" ]]; then
        echo -e "${WARN}→${NC} Installing Node.js via NodeSource..."
        require_sudo
        if command -v apt-get &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://deb.nodesource.com/setup_22.x" "$tmp"
            maybe_sudo -E bash "$tmp"
            maybe_sudo apt-get install -y nodejs
        elif command -v dnf &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            maybe_sudo bash "$tmp"
            maybe_sudo dnf install -y nodejs
        elif command -v yum &> /dev/null; then
            local tmp
            tmp="$(mktempfile)"
            download_file "https://rpm.nodesource.com/setup_22.x" "$tmp"
            maybe_sudo bash "$tmp"
            maybe_sudo yum install -y nodejs
        else
            echo -e "${ERROR}Error: Could not detect package manager${NC}"
            echo "Please install Node.js 22+ manually: https://nodejs.org"
            exit 1
        fi
        echo -e "${SUCCESS}✓${NC} Node.js installed"
    fi
}

# ─── Git ─────────────────────────────────────────────────────────────────────

check_git() {
    if command -v git &> /dev/null; then
        echo -e "${SUCCESS}✓${NC} Git already installed"
        return 0
    fi
    echo -e "${WARN}→${NC} Git not found"
    return 1
}

install_git() {
    echo -e "${WARN}→${NC} Installing Git..."
    if [[ "$OS" == "macos" ]]; then
        brew install git
    elif [[ "$OS" == "linux" ]]; then
        require_sudo
        if command -v apt-get &> /dev/null; then
            maybe_sudo apt-get update -y
            maybe_sudo apt-get install -y git
        elif command -v dnf &> /dev/null; then
            maybe_sudo dnf install -y git
        elif command -v yum &> /dev/null; then
            maybe_sudo yum install -y git
        else
            echo -e "${ERROR}Error: Could not detect package manager for Git${NC}"
            exit 1
        fi
    fi
    echo -e "${SUCCESS}✓${NC} Git installed"
}

# ─── npm permissions ─────────────────────────────────────────────────────────

fix_npm_permissions() {
    if [[ "$OS" != "linux" ]]; then
        return 0
    fi

    local npm_prefix
    npm_prefix="$(npm config get prefix 2>/dev/null || true)"
    if [[ -z "$npm_prefix" ]]; then
        return 0
    fi

    if [[ -w "$npm_prefix" || -w "$npm_prefix/lib" ]]; then
        return 0
    fi

    echo -e "${WARN}→${NC} Configuring npm for user-local installs..."
    mkdir -p "$HOME/.npm-global"
    npm config set prefix "$HOME/.npm-global"

    # shellcheck disable=SC2016
    local path_line='export PATH="$HOME/.npm-global/bin:$PATH"'
    for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
        if [[ -f "$rc" ]] && ! grep -q ".npm-global" "$rc"; then
            echo "$path_line" >> "$rc"
        fi
    done

    export PATH="$HOME/.npm-global/bin:$PATH"
    echo -e "${SUCCESS}✓${NC} npm configured for user installs"
}

# ─── PATH helpers ────────────────────────────────────────────────────────────

npm_global_bin_dir() {
    local prefix=""
    prefix="$(npm prefix -g 2>/dev/null || true)"
    if [[ -n "$prefix" ]]; then
        if [[ "$prefix" == /* ]]; then
            echo "${prefix%/}/bin"
            return 0
        fi
    fi

    prefix="$(npm config get prefix 2>/dev/null || true)"
    if [[ -n "$prefix" && "$prefix" != "undefined" && "$prefix" != "null" ]]; then
        if [[ "$prefix" == /* ]]; then
            echo "${prefix%/}/bin"
            return 0
        fi
    fi

    echo ""
    return 1
}

refresh_shell_command_cache() {
    hash -r 2>/dev/null || true
}

path_has_dir() {
    local path="$1"
    local dir="${2%/}"
    if [[ -z "$dir" ]]; then
        return 1
    fi
    case ":${path}:" in
        *":${dir}:"*) return 0 ;;
        *) return 1 ;;
    esac
}

warn_shell_path_missing_dir() {
    local dir="${1%/}"
    local label="$2"
    if [[ -z "$dir" ]]; then
        return 0
    fi
    if path_has_dir "$ORIGINAL_PATH" "$dir"; then
        return 0
    fi

    echo ""
    echo -e "${WARN}→${NC} PATH warning: missing ${label}: ${INFO}${dir}${NC}"
    echo -e "This can make ${INFO}castle${NC} show as \"command not found\" in new terminals."
    echo -e "Fix (zsh: ~/.zshrc, bash: ~/.bashrc):"
    echo -e "  export PATH=\"${dir}:\$PATH\""
}

ensure_npm_global_bin_on_path() {
    local bin_dir=""
    bin_dir="$(npm_global_bin_dir || true)"
    if [[ -n "$bin_dir" ]]; then
        export PATH="${bin_dir}:$PATH"
    fi
}

maybe_nodenv_rehash() {
    if command -v nodenv &> /dev/null; then
        nodenv rehash >/dev/null 2>&1 || true
    fi
}

source_node_version_manager() {
    # Source nvm if available (curl|bash subshells don't have it loaded)
    if [[ -z "${NVM_DIR:-}" ]]; then
        if [[ -d "$HOME/.nvm" ]]; then
            export NVM_DIR="$HOME/.nvm"
        fi
    fi
    if [[ -n "${NVM_DIR:-}" && -s "${NVM_DIR}/nvm.sh" ]]; then
        source "${NVM_DIR}/nvm.sh" 2>/dev/null || true
    fi

    # Source fnm if available
    if command -v fnm &> /dev/null; then
        eval "$(fnm env 2>/dev/null)" || true
    fi
}

resolve_castle_bin() {
    refresh_shell_command_cache
    local resolved=""
    resolved="$(type -P castle 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    # Source nvm/fnm in case we're in a curl|bash subshell
    source_node_version_manager
    refresh_shell_command_cache
    resolved="$(type -P castle 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    ensure_npm_global_bin_on_path
    refresh_shell_command_cache
    resolved="$(type -P castle 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    local npm_bin=""
    npm_bin="$(npm_global_bin_dir || true)"
    if [[ -n "$npm_bin" && -x "${npm_bin}/castle" ]]; then
        echo "${npm_bin}/castle"
        return 0
    fi

    # Brute force: check common global bin locations
    local common_paths=(
        "$HOME/.nvm/versions/node/$(node -v 2>/dev/null || echo v0)/bin/castle"
        "$HOME/.npm-global/bin/castle"
        "/usr/local/bin/castle"
        "/opt/homebrew/bin/castle"
    )
    for p in "${common_paths[@]}"; do
        if [[ -x "$p" ]]; then
            echo "$p"
            return 0
        fi
    done

    maybe_nodenv_rehash
    refresh_shell_command_cache
    resolved="$(type -P castle 2>/dev/null || true)"
    if [[ -n "$resolved" && -x "$resolved" ]]; then
        echo "$resolved"
        return 0
    fi

    echo ""
    return 1
}

warn_castle_not_found() {
    echo -e "${WARN}→${NC} Installed, but ${INFO}castle${NC} is not discoverable on PATH in this shell."
    echo -e "Try: ${INFO}hash -r${NC} (bash) or ${INFO}rehash${NC} (zsh), then retry."
    local npm_bin=""
    npm_bin="$(npm_global_bin_dir 2>/dev/null || true)"
    if [[ -n "$npm_bin" ]]; then
        echo -e "npm bin dir: ${INFO}${npm_bin}${NC}"
        echo -e "If needed: ${INFO}export PATH=\"${npm_bin}:\$PATH\"${NC}"
    fi
}

# ─── Install Castle ──────────────────────────────────────────────────────────

install_castle() {
    local install_spec="@castlekit/castle@${CASTLE_VERSION}"

    local resolved_version=""
    resolved_version="$(npm view "${install_spec}" version 2>/dev/null || true)"
    if [[ -n "$resolved_version" ]]; then
        echo -e "${WARN}→${NC} Installing Castle ${INFO}${resolved_version}${NC}..."
    else
        echo -e "${WARN}→${NC} Installing Castle (${INFO}${CASTLE_VERSION}${NC})..."
    fi

    if ! npm --loglevel "$NPM_LOGLEVEL" ${NPM_SILENT_FLAG:+$NPM_SILENT_FLAG} --no-fund --no-audit install -g "$install_spec"; then
        echo -e "${ERROR}npm install failed${NC}"
        echo -e "Try: ${INFO}npm install -g --force ${install_spec}${NC}"
        exit 1
    fi

    echo -e "${SUCCESS}✓${NC} Castle installed"
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
    if [[ "$HELP" == "1" ]]; then
        print_usage
        return 0
    fi

    if [[ "$DRY_RUN" == "1" ]]; then
        echo -e "${SUCCESS}✓${NC} Dry run"
        echo -e "${SUCCESS}✓${NC} Version: ${CASTLE_VERSION}"
        echo -e "${MUTED}Dry run complete (no changes made).${NC}"
        return 0
    fi

    # Check for existing installation
    local is_upgrade=false
    if [[ -n "$(type -P castle 2>/dev/null || true)" ]]; then
        echo -e "${WARN}→${NC} Existing Castle installation detected"
        is_upgrade=true
    fi

    # Step 1: Homebrew (macOS only)
    install_homebrew

    # Step 2: Node.js
    if ! check_node; then
        install_node
    fi

    # Step 3: Git
    if ! check_git; then
        install_git
    fi

    # Step 4: npm permissions (Linux)
    fix_npm_permissions

    # Step 5: Install Castle
    install_castle

    CASTLE_BIN="$(resolve_castle_bin || true)"

    echo ""
    echo -e "${SUCCESS}${BOLD}🏰 Castle installed successfully!${NC}"

    if [[ "$is_upgrade" == "true" ]]; then
        local update_messages=(
            "The castle walls have been reinforced, my liege."
            "New fortifications in place. The kingdom grows stronger."
            "The royal engineers have been busy. Upgrade complete."
            "Fresh stonework, same castle. Miss me?"
            "The drawbridge has been upgraded. Smoother entry guaranteed."
        )
        local update_message
        update_message="${update_messages[RANDOM % ${#update_messages[@]}]}"
        echo -e "${MUTED}${update_message}${NC}"
    else
        local completion_messages=(
            "The castle has been erected. Long may it stand!"
            "Your fortress is ready, sire. What are your orders?"
            "The court is assembled. Your agents await."
            "A fine castle indeed. Time to rule."
            "Stone by stone, the kingdom begins."
        )
        local completion_message
        completion_message="${completion_messages[RANDOM % ${#completion_messages[@]}]}"
        echo -e "${MUTED}${completion_message}${NC}"
    fi
    echo ""

    # Step 6: Run onboarding
    if [[ "$NO_ONBOARD" == "1" ]]; then
        echo -e "Skipping setup (requested). Run ${INFO}castle setup${NC} later."
    else
        if [[ -r /dev/tty && -w /dev/tty ]]; then
            echo -e "Starting setup..."
            echo ""
            exec </dev/tty
            if [[ -n "$CASTLE_BIN" ]]; then
                exec "$CASTLE_BIN" setup
            else
                # Fallback: run the installed file directly (no PATH needed)
                local pkg_dir
                pkg_dir="$(npm prefix -g)/lib/node_modules/@castlekit/castle"
                if [[ -f "$pkg_dir/bin/castle.js" ]]; then
                    exec node --import tsx "$pkg_dir/bin/castle.js" setup
                else
                    echo -e "${WARN}→${NC} Could not locate castle binary."
                    echo -e "Run ${INFO}castle setup${NC} manually."
                fi
            fi
        else
            echo -e "${WARN}→${NC} No TTY available; skipping setup."
            echo -e "Run ${INFO}castle setup${NC} later."
        fi
    fi
}

# ─── Entry ───────────────────────────────────────────────────────────────────

# ASCII castle banner with blue-to-purple gradient (ANSI 256-color)
print_banner() {
    local lines=(
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
        '     ____--`~    '"'"'--~~__|.    |+++++__|----~    ~`---,              ___'
        '-~--~                   ~---__|,--~'"'"'                  ~~----_____-~'"'"'   `~----~~'
    )
    # Blue-to-purple gradient using ANSI 256-color codes
    local gradient=(27 27 33 33 63 63 99 99 135 135 141 141 177 177 177 176 176 176)
    local i=0
    echo ""
    for line in "${lines[@]}"; do
        local color=${gradient[$i]}
        echo -e "\033[38;5;${color}m${line}\033[0m"
        ((i++)) || true
    done
    echo ""
    echo -e "  ${ACCENT}${BOLD}Castle${NC} ${MUTED}— The multi-agent workspace${NC}"
    echo -e "  ${MUTED}${TAGLINE}${NC}"
    echo ""
}

print_banner

# Detect OS
OS="unknown"
if [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ -n "${WSL_DISTRO_NAME:-}" ]]; then
    OS="linux"
fi

if [[ "$OS" == "unknown" ]]; then
    echo -e "${ERROR}Error: Unsupported operating system${NC}"
    echo "This installer supports macOS and Linux (including WSL)."
    exit 1
fi

echo -e "${SUCCESS}✓${NC} Detected: $OS"

parse_args "$@"
configure_verbose
main
