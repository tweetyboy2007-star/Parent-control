# 16-Channel DVR System

Self-hosted IP camera DVR with 24/7 SSD recording, remote VPS access, web dashboard, and Android app.

## Architecture

```
[Dahua / IMOU / Hikvision Cameras]
        │  RTSP streams
        ▼
[Local PC — NVR Server]
 ├── FFmpeg records each channel → SSD segments (5 min MP4)
 ├── FFmpeg serves live HLS streams
 ├── SQLite tracks recordings + events
 └── Express API + WebSocket (port 7000)
        │
        │  WireGuard VPN tunnel
        ▼
[Cloud VPS — Nginx Reverse Proxy]
        │  HTTPS (port 80/443)
        ▼
[Web Browser] + [Android App]
```

## Quick Start

### 1. Local PC Setup

```bash
# Install Node.js 20 + FFmpeg
sudo bash dvr/pc/setup-pc.sh

# Or with Docker:
cd dvr
cp server/config.sample.json server/config.json
# Edit config.json — add your camera RTSP URLs
docker compose up -d
```

### 2. Configure Cameras

Edit `dvr/server/config.json`:

```json
{
  "channels": [
    {
      "id": 1,
      "name": "Front Door",
      "enabled": true,
      "rtsp": "rtsp://admin:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0",
      "rtspSub": "rtsp://admin:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=1",
      "brand": "dahua"
    }
  ]
}
```

**Dahua/IMOU RTSP format:**
- Main stream: `rtsp://USER:PASS@IP:554/cam/realmonitor?channel=1&subtype=0`
- Sub stream:  `rtsp://USER:PASS@IP:554/cam/realmonitor?channel=1&subtype=1`

**IMOU Ranger specific:**
- Username: `admin`
- Password: set in IMOU Life app → Device Settings → Password
- Port: 554 (default)

### 3. VPS Setup (Remote Access)

```bash
# On your VPS:
bash dvr/vps/setup-vps.sh YOUR_VPS_IP your-domain.com

# Copy generated WireGuard config to PC:
scp root@VPS:/root/dvr-pc-wg0.conf /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0
```

### 4. Access

| URL | Description |
|-----|-------------|
| `http://YOUR_VPS/` | 16-channel live view |
| `http://YOUR_VPS/playback.html` | Search + playback |
| `http://localhost:7000/api/channels` | API (local) |

## Storage Sizing Guide

| Cameras | Resolution | Bitrate | 30 days storage |
|---------|-----------|---------|-----------------|
| 16 × 1080p | 1080p | ~1 Mbps each | ~5.4 TB |
| 16 × 720p  | 720p  | ~0.5 Mbps    | ~2.7 TB |
| 16 × substream | 480p | ~0.3 Mbps | ~1.6 TB |

**Recommended SSD:** 4TB–8TB for 16 cameras × 30-day retention.

## Android App

See `android/README.md` for React Native setup.

For a ready-built app: use the ChatGPT prompt in `prompts/01-android-app.md`.

## Add-ons via ChatGPT Prompts

| File | Feature |
|------|---------|
| `prompts/01-android-app.md` | Complete React Native Android app |
| `prompts/02-motion-detection.md` | Python motion + AI person detection |
| `prompts/03-push-notifications.md` | Firebase FCM push to Android |

## Camera Brand Support

| Brand | Protocol | Notes |
|-------|---------|-------|
| **Dahua** | RTSP / ONVIF | Default port 554 |
| **IMOU Ranger** | RTSP (Dahua-based) | Same URL format as Dahua |
| **Hikvision** | RTSP / ONVIF | URL: `/Streaming/Channels/101` |
| **Generic ONVIF** | ONVIF | Use ONVIF Device Manager to find URL |
| **Any RTSP camera** | RTSP | Just paste the URL in config |

## Folder Structure

```
dvr/
├── server/           Node.js NVR backend (runs on PC)
│   ├── index.js      Main server + API
│   ├── recorder.js   Per-channel FFmpeg manager
│   ├── storage.js    SSD management + cleanup
│   ├── database.js   SQLite recordings + events
│   └── config.json   Your camera config (create from .sample)
├── web/              Web dashboard (served by backend)
│   ├── index.html    16-channel live view
│   └── playback.html Recording search + playback
├── vps/              VPS setup scripts
│   └── setup-vps.sh  WireGuard + Nginx on VPS
├── pc/               Local PC setup
│   └── setup-pc.sh   Node.js + WireGuard on PC
├── android/          Android app guide
├── docker-compose.yml
└── prompts/          ChatGPT worker prompts
```
