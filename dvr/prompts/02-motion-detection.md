# ChatGPT Worker Prompt: Motion Detection & AI Events

Paste this prompt into ChatGPT o1 or GPT-4o:

---

You are a Python computer vision engineer. Add motion detection and AI person detection to a 16-channel DVR system.

## Context

The DVR server is Node.js, recording RTSP streams with FFmpeg. There is a SQLite database with an `events` table. The server exposes:

- `GET /api/channels` → list of active channels with RTSP URLs
- `POST /api/events` via internal call to log an event: `{ channelId, channelName, eventType, timestamp, thumbnailPath, metadata }`

The database has this events table:
```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER,
  channel_name TEXT,
  event_type TEXT,
  timestamp INTEGER,
  thumbnail_path TEXT,
  metadata TEXT
);
```

## Task

Build a Python microservice (`motion_detector.py`) that:

### 1. Connects to multiple RTSP streams
- Reads config.json (same format as DVR server) to get RTSP URLs
- Uses OpenCV `cv2.VideoCapture` for each enabled channel
- Runs each channel in its own thread

### 2. Motion Detection
- Background subtraction using `cv2.createBackgroundSubtractorMOG2`
- Trigger when >500 changed pixels in a frame
- Cooldown: don't re-trigger for 10 seconds after first motion
- Save a thumbnail JPEG on motion

### 3. Person Detection (optional, enable with --ai flag)
- Use YOLOv8 nano model (`ultralytics` package)
- Classify detected objects: person, car, animal
- Only trigger event if detected object is in `watchClasses` from config

### 4. Event Reporting
- POST to DVR server: `http://localhost:7000/api/events` (internal)
- Include: channelId, eventType ("motion" or "person" or "vehicle"), timestamp, thumbnailPath

### 5. Performance Requirements
- Use sub-stream (480p) RTSP URL to reduce CPU load
- Skip frames: analyze only every 5th frame
- Target: 16 channels on a 6-core CPU with <40% CPU total

## Deliverables

1. `motion_detector.py` — complete working script
2. `requirements.txt` — Python deps
3. `dvr-motion.service` — systemd unit file
4. Instructions to run alongside Node.js DVR server

## Example Event POST

```json
{
  "channelId": 3,
  "channelName": "Back Yard",
  "eventType": "person",
  "timestamp": 1705123456,
  "thumbnailPath": "/mnt/ssd/recordings/ch3/2024-01-13/thumb_14-30-00.jpg",
  "metadata": { "confidence": 0.87, "objects": ["person"] }
}
```
