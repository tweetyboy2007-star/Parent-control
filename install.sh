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

# ── 3. N_m3u8DL-RE — download binary from GitHub releases ─────────────────────
if ! command -v N_m3u8DL-RE &>/dev/null; then
  info "Installing N_m3u8DL-RE from GitHub releases…"

  ARCH="$(uname -m)"
  if [ "$ARCH" = "arm64" ]; then
    # Releases use either osx-arm64 or macOS-arm64 depending on version
    ASSET_PATTERN="arm64"
  else
    ASSET_PATTERN="x64\|x86_64"
  fi

  # Get latest release download URL (macOS .tar.gz assets only)
  RELEASE_JSON=$(curl -fsSL https://api.github.com/repos/nilaoda/N_m3u8DL-RE/releases/latest)
  DOWNLOAD_URL=$(echo "$RELEASE_JSON" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | grep -o 'https://[^"]*' \
    | grep "osx\|macOS\|mac" \
    | grep -i "${ASSET_PATTERN}" \
    | grep '\.tar\.gz$' \
    | head -1)

  if [ -z "$DOWNLOAD_URL" ]; then
    fail "Could not find N_m3u8DL-RE release for ${ASSET_PATTERN}. Check https://github.com/nilaoda/N_m3u8DL-RE/releases"
  fi

  TMPDIR_DL=$(mktemp -d)
  ARCHIVE="$TMPDIR_DL/n_m3u8dl.tar.gz"

  info "Downloading $DOWNLOAD_URL"
  curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE"

  tar -xzf "$ARCHIVE" -C "$TMPDIR_DL"
  BINARY=$(find "$TMPDIR_DL" -name "N_m3u8DL-RE" -type f | head -1)

  if [ -z "$BINARY" ]; then
    fail "Binary not found in archive. Archive contents:"
  fi

  INSTALL_DIR="/usr/local/bin"
  if [ -d /opt/homebrew/bin ]; then
    INSTALL_DIR="/opt/homebrew/bin"
  fi

  cp "$BINARY" "$INSTALL_DIR/N_m3u8DL-RE"
  chmod +x "$INSTALL_DIR/N_m3u8DL-RE"
  rm -rf "$TMPDIR_DL"

  # macOS Gatekeeper — remove quarantine flag
  xattr -d com.apple.quarantine "$INSTALL_DIR/N_m3u8DL-RE" 2>/dev/null || true
fi
ok "N_m3u8DL-RE $(N_m3u8DL-RE --version 2>&1 | head -1 || echo 'installed')"

# ── 4. shaka-packager — download binary from GitHub releases ──────────────────
install_shaka() {
  local pattern="$1"
  local release_json
  release_json=$(curl -fsSL --retry 3 \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/repos/shaka-project/shaka-packager/releases/latest 2>/dev/null)

  local url
  url=$(echo "$release_json" \
    | grep -o '"browser_download_url": *"[^"]*"' \
    | grep -o 'https://[^"]*' \
    | grep -iE "$pattern" \
    | grep -vE '\.(sha1|sha256|sig)$' \
    | head -1)

  [ -z "$url" ] && return 1

  local install_dir="/usr/local/bin"
  [ -d /opt/homebrew/bin ] && install_dir="/opt/homebrew/bin"

  info "Downloading shaka-packager from $url"
  curl -fsSL --retry 3 "$url" -o "$install_dir/shaka-packager" || return 1
  chmod +x "$install_dir/shaka-packager"
  xattr -d com.apple.quarantine "$install_dir/shaka-packager" 2>/dev/null || true
  return 0
}

if ! command -v shaka-packager &>/dev/null; then
  info "Installing shaka-packager from GitHub releases…"
  ARCH="$(uname -m)"
  if [ "$ARCH" = "arm64" ]; then
    # Try native arm64 first; fall back to x64 (Rosetta runs it fine on Apple Silicon)
    install_shaka "osx-arm64|mac-arm64|macos-arm64" \
      || install_shaka "osx-x64|mac-x64|macos-x64" \
      || fail "Could not download shaka-packager. Download manually from https://github.com/shaka-project/shaka-packager/releases and put it in /usr/local/bin/shaka-packager"
  else
    install_shaka "osx-x64|mac-x64|macos-x64" \
      || fail "Could not download shaka-packager. Download manually from https://github.com/shaka-project/shaka-packager/releases and put it in /usr/local/bin/shaka-packager"
  fi
fi
ok "shaka-packager $(shaka-packager --version 2>&1 | head -1 || echo 'installed')"

# ── 5. ffmpeg ──────────────────────────────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  info "Installing ffmpeg…"
  brew install ffmpeg
fi
ok "ffmpeg $(ffmpeg -version 2>&1 | head -1 | awk '{print $3}')"

# ── 6. Python 3 ───────────────────────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
  info "Installing Python 3…"
  brew install python
fi
ok "Python $(python3 --version)"

# ── 6a. openai-whisper (auto-subtitles) ────────────────────────────────────────
if ! python3 -c "import whisper" 2>/dev/null; then
  info "Installing openai-whisper…"
  pip3 install -q openai-whisper
fi
ok "openai-whisper ready"

# ── 6b. edge-tts (auto background voice) ──────────────────────────────────────
if ! command -v edge-tts &>/dev/null && ! python3 -m edge_tts --help &>/dev/null 2>&1; then
  info "Installing edge-tts…"
  pip3 install -q edge-tts
fi
ok "edge-tts ready"

# ── 8. npm install ─────────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  info "Installing Node dependencies…"
  npm install --silent
fi
ok "Node modules ready"

# ── 9. Desktop launcher ────────────────────────────────────────────────────────
LAUNCHER="$HOME/Desktop/N_m3u8DL-RE Downloader.command"
cat > "$LAUNCHER" <<LAUNCHER_EOF
#!/usr/bin/env bash
cd "$DIR"
./start.sh
LAUNCHER_EOF
chmod +x "$LAUNCHER"
ok "Launcher created on Desktop → double-click to start"

echo ""
echo -e "${BOLD}  All done! Starting the app…${NC}"
echo ""

exec node server.js
