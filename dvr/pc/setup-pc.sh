#!/bin/bash
# ============================================================
# DVR Local PC Setup Script
# Run this on your Windows PC (via WSL2) or Linux PC
# Ubuntu/Debian only. For Windows native, see README.
# ============================================================
set -e

DVR_DIR="${DVR_DIR:-/opt/dvr}"
SSD_MOUNT="${SSD_MOUNT:-/mnt/ssd}"
NODE_VERSION="20"

echo "=== DVR Local PC Setup ==="
echo "DVR install dir: ${DVR_DIR}"
echo "SSD mount path:  ${SSD_MOUNT}"
echo ""

# --- Dependencies ---
apt-get update -qq
apt-get install -y curl git ffmpeg wireguard nodejs npm sqlite3 net-tools

# Install Node.js via nvm if needed
if ! node --version 2>/dev/null | grep -q "v${NODE_VERSION}"; then
  echo "[+] Installing Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi

echo "Node: $(node --version)"
echo "FFmpeg: $(ffmpeg -version 2>&1 | head -1)"

# --- SSD Storage ---
echo "[+] Setting up storage directories..."
mkdir -p "${SSD_MOUNT}/recordings"
mkdir -p /tmp/dvr-streams

# --- Install DVR Server ---
echo "[+] Installing DVR server..."
cp -r "$(dirname "$0")/../server" "${DVR_DIR}"
cd "${DVR_DIR}"
npm install

# Copy sample config if not exists
if [ ! -f "${DVR_DIR}/config.json" ]; then
  cp "${DVR_DIR}/config.sample.json" "${DVR_DIR}/config.json"
  sed -i "s|/mnt/ssd/recordings|${SSD_MOUNT}/recordings|g" "${DVR_DIR}/config.json"
  echo "[!] IMPORTANT: Edit ${DVR_DIR}/config.json and add your camera RTSP URLs!"
fi

# --- Systemd Service ---
cat > /etc/systemd/system/dvr.service << EOF
[Unit]
Description=DVR 16-Channel Recording Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${DVR_DIR}
Environment=DVR_CONFIG=${DVR_DIR}/config.json
ExecStart=/usr/bin/node ${DVR_DIR}/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable dvr

# --- WireGuard Client ---
echo ""
echo "=== WireGuard Setup ==="
echo "Copy the VPS-generated wg0.conf to /etc/wireguard/wg0.conf"
echo "Then run:"
echo "  systemctl enable wg-quick@wg0"
echo "  systemctl start wg-quick@wg0"
echo ""
echo "If you got /root/dvr-pc-wg0.conf from VPS setup:"
echo "  cp /path/to/dvr-pc-wg0.conf /etc/wireguard/wg0.conf"
echo "  systemctl enable --now wg-quick@wg0"

echo ""
echo "=== PC Setup Complete ==="
echo ""
echo "NEXT STEPS:"
echo "1. Edit ${DVR_DIR}/config.json — add your camera RTSP URLs"
echo "2. Set up WireGuard (see above)"
echo "3. Start DVR: systemctl start dvr"
echo "4. Watch logs: journalctl -u dvr -f"
echo "5. Local access: http://localhost:7000"
