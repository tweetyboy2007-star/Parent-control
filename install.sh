#!/usr/bin/env bash
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC}  $1"; }
info() { echo -e "${YELLOW}→${NC}  $1"; }
fail() { echo -e "${RED}✗${NC}  $1"; exit 1; }

echo ""
echo -e "${BOLD}  N_m3u8DL-RE Downloader — Setup${NC}"
echo "  ─────────────────────────────────"
echo ""

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ── 1. Homebrew ────────────────────────────────────────────────────────────────
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for Apple Silicon
  if [ -f /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
ok "Homebrew $(brew --version | head -1)"

# ── 2. Node.js ─────────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  info "Installing Node.js…"
  brew install node
fi
ok "Node.js $(node --version)"

# ── 3. N_m3u8DL-RE ─────────────────────────────────────────────────────────────
if ! command -v N_m3u8DL-RE &>/dev/null; then
  info "Installing N_m3u8DL-RE…"
  brew install n-m3u8dl-re
fi
ok "N_m3u8DL-RE $(N_m3u8DL-RE --version 2>&1 | head -1)"

# ── 4. shaka-packager (required for --use-shaka-packager flag) ─────────────────
if ! command -v shaka-packager &>/dev/null && ! command -v packager &>/dev/null; then
  info "Installing shaka-packager…"
  brew install shaka-packager
fi
ok "shaka-packager ready"

# ── 5. ffmpeg (used by N_m3u8DL-RE for muxing) ────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  info "Installing ffmpeg…"
  brew install ffmpeg
fi
ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"

# ── 6. npm install ─────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "Installing Node dependencies…"
  npm install --silent
fi
ok "Node modules ready"

# ── 7. Create a double-clickable launcher in ~/Desktop ─────────────────────────
LAUNCHER="$HOME/Desktop/N_m3u8DL-RE Downloader.command"
cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env bash
cd "$DIR"
./start.sh
LAUNCHER_EOF
chmod +x "$LAUNCHER"
ok "Launcher created on Desktop"

echo ""
echo -e "${BOLD}  All done! Starting the app…${NC}"
echo ""

exec node server.js
