#!/bin/bash
# ============================================================
# DVR VPS Setup Script
# Run this on your cloud VPS (Ubuntu 22.04 / Debian 12)
# Usage: bash setup-vps.sh YOUR_PC_PUBLIC_IP YOUR_DOMAIN
# ============================================================
set -e

PC_IP="${1:-}"
DOMAIN="${2:-}"
VPS_WG_IP="10.8.0.1"
PC_WG_IP="10.8.0.2"
WG_PORT=51820
DVR_PORT=7000

echo "=== DVR VPS Setup ==="
echo "PC IP: ${PC_IP:-<not set, WireGuard still configured>}"
echo "Domain: ${DOMAIN:-<not set, use IP instead>}"
echo ""

# Install packages
apt-get update -qq
apt-get install -y wireguard nginx certbot python3-certbot-nginx ufw

# --- WireGuard Server Setup ---
echo "[+] Configuring WireGuard..."

# Generate keys if not exist
if [ ! -f /etc/wireguard/server_priv.key ]; then
  wg genkey | tee /etc/wireguard/server_priv.key | wg pubkey > /etc/wireguard/server_pub.key
  wg genkey | tee /etc/wireguard/pc_priv.key | wg pubkey > /etc/wireguard/pc_pub.key
  chmod 600 /etc/wireguard/server_priv.key /etc/wireguard/pc_priv.key
fi

SERVER_PRIV=$(cat /etc/wireguard/server_priv.key)
SERVER_PUB=$(cat /etc/wireguard/server_pub.key)
PC_PRIV=$(cat /etc/wireguard/pc_priv.key)
PC_PUB=$(cat /etc/wireguard/pc_pub.key)
VPS_PUBLIC_IP=$(curl -s https://api.ipify.org || hostname -I | awk '{print $1}')

cat > /etc/wireguard/wg0.conf << EOF
[Interface]
Address = ${VPS_WG_IP}/24
PrivateKey = ${SERVER_PRIV}
ListenPort = ${WG_PORT}
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -A FORWARD -o wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -D FORWARD -o wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
# Your PC / Local DVR Server
PublicKey = ${PC_PUB}
AllowedIPs = ${PC_WG_IP}/32
EOF

systemctl enable wg-quick@wg0
systemctl restart wg-quick@wg0

# Generate PC WireGuard config
cat > /root/dvr-pc-wg0.conf << EOF
[Interface]
Address = ${PC_WG_IP}/24
PrivateKey = ${PC_PRIV}
DNS = 1.1.1.1

[Peer]
# VPS Server
PublicKey = ${SERVER_PUB}
Endpoint = ${VPS_PUBLIC_IP}:${WG_PORT}
AllowedIPs = ${VPS_WG_IP}/32
PersistentKeepalive = 25
EOF

echo "[+] PC WireGuard config saved to /root/dvr-pc-wg0.conf"
echo "    Copy this file to your PC as /etc/wireguard/wg0.conf"

# --- Nginx Reverse Proxy ---
echo "[+] Configuring Nginx..."

NGINX_CONF="/etc/nginx/sites-available/dvr"
SERVER_NAME="${DOMAIN:-${VPS_PUBLIC_IP}}"

cat > "${NGINX_CONF}" << EOF
# DVR Nginx Reverse Proxy
# PC DVR server is reachable via WireGuard at ${PC_WG_IP}:${DVR_PORT}

map \$http_upgrade \$connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    server_name ${SERVER_NAME};

    # Rate limiting: 60 req/min per IP
    limit_req_zone \$binary_remote_addr zone=dvr:10m rate=60r/m;
    limit_req zone=dvr burst=20 nodelay;

    # Basic auth (optional — uncomment and run htpasswd -c /etc/nginx/.htpasswd dvr)
    # auth_basic "DVR Access";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://${PC_WG_IP}:${DVR_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300;
        proxy_send_timeout 300;
    }

    # WebSocket support
    location /ws {
        proxy_pass http://${PC_WG_IP}:${DVR_PORT}/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_read_timeout 3600;
    }

    # HLS live streams — no buffering
    location /live/ {
        proxy_pass http://${PC_WG_IP}:${DVR_PORT}/live/;
        proxy_buffering off;
        add_header Cache-Control "no-cache, no-store";
        add_header Access-Control-Allow-Origin *;
    }

    # Recorded files
    location /recordings/ {
        proxy_pass http://${PC_WG_IP}:${DVR_PORT}/recordings/;
        proxy_read_timeout 600;
    }
}
EOF

ln -sf "${NGINX_CONF}" /etc/nginx/sites-enabled/dvr
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

# --- Firewall ---
echo "[+] Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow ${WG_PORT}/udp
ufw --force enable

# --- SSL (optional) ---
if [ -n "${DOMAIN}" ] && [ "${DOMAIN}" != "localhost" ]; then
  echo "[+] Requesting SSL certificate for ${DOMAIN}..."
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos -m admin@${DOMAIN} || echo "SSL failed — set DNS first, then run: certbot --nginx -d ${DOMAIN}"
fi

echo ""
echo "=== VPS Setup Complete ==="
echo ""
echo "VPS Public IP:   ${VPS_PUBLIC_IP}"
echo "WireGuard VPS:   ${VPS_WG_IP}"
echo "WireGuard PC:    ${PC_WG_IP}"
echo ""
echo "NEXT STEPS:"
echo "1. Copy /root/dvr-pc-wg0.conf to your PC"
echo "2. Run setup-pc.sh on your PC"
echo "3. Test: ping ${VPS_WG_IP} from PC (should work)"
echo "4. Access DVR at: http://${SERVER_NAME}"
echo ""
echo "Server pubkey (for PC config): ${SERVER_PUB}"
