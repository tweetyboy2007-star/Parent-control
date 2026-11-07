# ChatGPT Worker Prompt: Push Notifications to Android

Paste this prompt into ChatGPT o1 or GPT-4o:

---

You are a mobile backend engineer. Add Firebase Cloud Messaging (FCM) push notifications to a DVR system.

## Context

- DVR server: Node.js/Express running on local PC, accessible via VPS reverse proxy
- Android app: React Native using `@notifee/react-native`
- Events are logged to SQLite and POST to `http://localhost:7000/api/events`

## Task

Extend the DVR Node.js server to send push notifications when events occur.

### 1. Backend Changes (server/notifications.js)

Create a module that:
- Initializes `firebase-admin` with a service account JSON
- Provides `sendMotionAlert(deviceToken, channelName, eventType, thumbnailUrl)` function
- Sends FCM data notification with:
  ```json
  {
    "notification": { "title": "Motion Detected", "body": "CH3 - Back Yard" },
    "data": { "channelId": "3", "timestamp": "1705123456", "type": "person" },
    "android": { "priority": "high", "ttl": "60s" }
  }
  ```

### 2. Device Token Management (server/tokens.js)

Create endpoints:
- `POST /api/devices/register` — save FCM token + device name to SQLite
- `DELETE /api/devices/:token` — remove token
- `GET /api/devices` — list registered devices (admin)

Add SQLite table:
```sql
CREATE TABLE device_tokens (
  id INTEGER PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  device_name TEXT,
  registered_at INTEGER DEFAULT (unixepoch())
);
```

### 3. Android App Changes

In React Native app, add FCM registration:
```typescript
// On app start:
import messaging from '@react-native-firebase/messaging';
const token = await messaging().getToken();
await fetch(`${SERVER}/api/devices/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, deviceName: 'My Phone' })
});

// Handle incoming notification:
messaging().onMessage(async remoteMessage => {
  // Show local notification with notifee
  await notifee.displayNotification({
    title: remoteMessage.notification?.title,
    body: remoteMessage.notification?.body,
  });
});
```

### 4. Event-Triggered Notifications

Modify the existing `POST /api/events` route to call `sendMotionAlert` after saving the event.

## Deliverables

1. `server/notifications.js` — complete FCM module
2. `server/tokens.js` — device token routes
3. Changes to `server/index.js` to integrate both
4. Android `google-services.json` setup instructions
5. Firebase project setup steps (which exact console pages to visit)
