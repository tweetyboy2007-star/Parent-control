# ChatGPT Worker Prompt: Build DVR Android App

Paste this prompt into ChatGPT o1 or GPT-4o:

---

You are a senior React Native developer. Build a complete Android app for a 16-channel IP camera DVR system.

## Context

The DVR server runs at `http://YOUR_VPS_IP` with these REST API endpoints:

- `GET /api/channels` → `{ channels: [{ id, name, status, liveUrl, enabled }] }`
- `GET /api/search?channel=1&from=ISO&to=ISO&limit=100` → `{ recordings: [{ id, channel_id, channel_name, start_time, end_time, url, duration_seconds, file_size }] }`
- `GET /api/channels/{id}/snapshot` → JPEG image
- `GET /live/ch{id}/live.m3u8` → HLS live stream
- `WS /ws` → real-time channel status events

## Requirements

Build the following screens using React Native + TypeScript:

### 1. LiveViewScreen
- 4×4 grid of 16 camera thumbnails (snapshot image, refreshed every 5 seconds)
- Color-coded status border: green=online, red=offline, yellow=error
- Tap any cell → open fullscreen HLS player
- Bottom tab: grid size toggle (16 / 9 / 4 / 1)
- Top bar: connection indicator dot (green/red)

### 2. ChannelScreen (fullscreen)
- Full HLS video using `react-native-video`
- Channel name + status overlay
- "Snapshot" button (saves to gallery)
- Swipe left/right to switch channels
- Double-tap to toggle controls

### 3. PlaybackScreen
- Date picker + channel picker + time range
- Calls `/api/search` and shows results list
- Tap result → plays MP4 with `react-native-video`
- Download button
- Shows recording duration + file size

### 4. SettingsScreen
- Server URL input field (saved with AsyncStorage)
- Username/password (Basic Auth header)
- Test Connection button
- Notification toggle

## Technical Requirements

- Use `react-native-video` v6+ for HLS playback
- Use `@notifee/react-native` for local notifications
- Use `@react-navigation/bottom-tabs` for navigation
- Use WebSocket hook for real-time status
- Handle network errors gracefully with retry
- Dark theme matching: background #0d0d0d, accent #00b4d8
- Support Android 8+ (API 26+)

## Deliverables

1. Complete `src/` folder structure with all files
2. `package.json` dependencies
3. `android/` configuration changes needed
4. Build instructions

Start with App.tsx, then navigation, then each screen.
