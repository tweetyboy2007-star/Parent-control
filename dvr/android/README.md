# DVR Android App

React Native app for real-time 16-channel viewing, playback, and push notifications.

## Quick Start

```bash
npx react-native init DVRApp --template react-native-template-typescript
cd DVRApp
npm install @react-native-async-storage/async-storage react-native-video react-native-push-notification @react-navigation/native @react-navigation/stack
```

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `react-native-video` | HLS live stream + MP4 playback |
| `@notifee/react-native` | Push notifications |
| `@react-navigation/stack` | Screen navigation |
| `react-native-async-storage` | Store server URL / auth |
| `react-native-reanimated` | Smooth gesture animations |

## App Structure

```
src/
├── screens/
│   ├── LiveViewScreen.tsx    # 16-channel grid
│   ├── ChannelScreen.tsx     # Single channel fullscreen
│   ├── PlaybackScreen.tsx    # Recording search + playback
│   └── SettingsScreen.tsx    # Server URL, auth
├── components/
│   ├── ChannelGrid.tsx       # 2x2 / 3x3 / 4x4 grid
│   ├── ChannelCell.tsx       # Single channel cell
│   └── Timeline.tsx          # Playback timeline
├── hooks/
│   ├── useWebSocket.ts       # WebSocket for live status
│   └── useChannels.ts        # Channel state management
├── api/
│   └── dvr.ts                # API client
└── App.tsx
```

## API Client (src/api/dvr.ts)

```typescript
const BASE = 'http://YOUR_VPS_IP_OR_DOMAIN';

export async function getChannels() {
  const r = await fetch(`${BASE}/api/channels`);
  return (await r.json()).channels;
}

export async function searchRecordings(params: {
  channel?: number;
  from: string;    // ISO string
  to: string;
  limit?: number;
}) {
  const q = new URLSearchParams(params as any);
  const r = await fetch(`${BASE}/api/search?${q}`);
  return (await r.json()).recordings;
}

export function getLiveUrl(channelId: number) {
  return `${BASE}/live/ch${channelId}/live.m3u8`;
}

export function getSnapshotUrl(channelId: number) {
  return `${BASE}/api/channels/${channelId}/snapshot?_=${Date.now()}`;
}
```

## LiveViewScreen (key logic)

```tsx
import Video from 'react-native-video';

// In fullscreen mode for a channel:
<Video
  source={{ uri: getLiveUrl(channelId) }}
  style={{ flex: 1 }}
  resizeMode="contain"
  muted
  repeat
  onError={(e) => console.warn('Stream error', e)}
/>

// In grid mode (snapshot thumbnails):
<Image
  source={{ uri: getSnapshotUrl(channelId), cache: 'reload' }}
  style={styles.thumbnail}
/>
```

## WebSocket for Real-time Status

```typescript
// hooks/useWebSocket.ts
const ws = new WebSocket('ws://YOUR_VPS/ws');
ws.onmessage = (e) => {
  const { type, data } = JSON.parse(e.data);
  if (type === 'init') setChannels(data.channels);
  if (type === 'channelStatus') updateChannel(data);
};
```

## Camera RTSP URL Reference

| Brand | Subtype 0 (Main) | Subtype 1 (Sub) |
|-------|-----------------|-----------------|
| **Dahua** | `rtsp://user:pass@IP:554/cam/realmonitor?channel=1&subtype=0` | `...subtype=1` |
| **IMOU Ranger** | Same as Dahua | Same as Dahua |
| **Hikvision** | `rtsp://user:pass@IP:554/Streaming/Channels/101` | `.../102` |
| **Generic ONVIF** | `rtsp://user:pass@IP:554/onvif/live` | varies |

## Build for Android

```bash
cd android
./gradlew assembleRelease
# APK at: android/app/build/outputs/apk/release/app-release.apk
```

## Dahua IMOU Ranger RTSP Notes

- Default port: 554
- Default credentials: admin / (blank or admin)
- Enable RTSP in camera web UI: Setup → Network → Advanced → RTSP
- For IMOU Ranger 2: app.imoulife.com or local IP
- Substream (360p) recommended for mobile grid view
- Mainstream (1080p/4MP) for fullscreen
