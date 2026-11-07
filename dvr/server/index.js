const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { EventEmitter } = require('events');

// Load config
const configPath = process.env.DVR_CONFIG || path.join(__dirname, 'config.json');
if (!fs.existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`);
  console.error(`Copy config.sample.json to config.json and edit your camera RTSP URLs.`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

const db = require('./database');
const StorageManager = require('./storage');
const ChannelRecorder = require('./recorder');

// Init
const dbPath = path.join(config.storage.recordingsDir, 'dvr.db');
db.init(dbPath);

const storage = new StorageManager(config);
const events = new EventEmitter();
events.setMaxListeners(50);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../web')));

// Serve HLS live streams
const streamsDir = config.storage.streamsDir;
if (!fs.existsSync(streamsDir)) fs.mkdirSync(streamsDir, { recursive: true });
app.use('/live', express.static(streamsDir));

// Serve recorded files
app.use('/recordings', express.static(config.storage.recordingsDir));

// ─── Recorders ────────────────────────────────────────────────────────────────
const recorders = {};
config.channels.forEach(ch => {
  recorders[ch.id] = new ChannelRecorder(ch, config, storage, events);
});

// ─── WebSocket broadcast ───────────────────────────────────────────────────────
function broadcast(type, data) {
  const msg = JSON.stringify({ type, data, ts: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

events.on('channelStatus', (data) => broadcast('channelStatus', data));

wss.on('connection', (ws) => {
  // Send current state on connect
  const statuses = Object.values(recorders).map(r => r.getStatus());
  ws.send(JSON.stringify({ type: 'init', data: { channels: statuses }, ts: Date.now() }));

  ws.on('error', (err) => console.warn('[WS] Client error:', err.message));
});

// ─── API Routes ────────────────────────────────────────────────────────────────

// GET /api/channels — list all channels with status
app.get('/api/channels', (req, res) => {
  const channels = Object.values(recorders).map(r => r.getStatus());
  res.json({ channels });
});

// GET /api/channels/:id/live — get live HLS URL for a channel
app.get('/api/channels/:id/live', (req, res) => {
  const r = recorders[parseInt(req.params.id)];
  if (!r) return res.status(404).json({ error: 'Channel not found' });
  res.json({ url: r.getStatus().liveUrl, channel: r.getStatus() });
});

// GET /api/search — search recordings
// Query: ?channel=1,2&from=2024-01-01T00:00:00Z&to=2024-01-01T23:59:59Z&limit=50
app.get('/api/search', (req, res) => {
  try {
    const channelIds = req.query.channel
      ? req.query.channel.split(',').map(Number).filter(Boolean)
      : null;
    const fromTime = req.query.from ? Math.floor(new Date(req.query.from).getTime() / 1000) : null;
    const toTime = req.query.to ? Math.floor(new Date(req.query.to).getTime() / 1000) : null;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const rows = db.searchRecordings({ channelIds, fromTime, toTime, limit, offset });
    const result = rows.map(r => ({
      ...r,
      url: '/recordings/' + path.relative(config.storage.recordingsDir, r.file_path).replace(/\\/g, '/'),
      startTimeISO: new Date(r.start_time * 1000).toISOString(),
      endTimeISO: r.end_time ? new Date(r.end_time * 1000).toISOString() : null,
    }));

    res.json({ recordings: result, count: result.length, limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/recordings/:id — get a single recording
app.get('/api/recordings/:id', (req, res) => {
  const row = db.getRecordingById(parseInt(req.params.id));
  if (!row) return res.status(404).json({ error: 'Not found' });
  const url = '/recordings/' + path.relative(config.storage.recordingsDir, row.file_path).replace(/\\/g, '/');
  res.json({ ...row, url });
});

// GET /api/events — search motion/detection events
app.get('/api/events', (req, res) => {
  const channelIds = req.query.channel
    ? req.query.channel.split(',').map(Number).filter(Boolean)
    : null;
  const fromTime = req.query.from ? Math.floor(new Date(req.query.from).getTime() / 1000) : null;
  const toTime = req.query.to ? Math.floor(new Date(req.query.to).getTime() / 1000) : null;
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const offset = parseInt(req.query.offset) || 0;

  const rows = db.searchEvents({ channelIds, fromTime, toTime, limit, offset });
  res.json({ events: rows, count: rows.length });
});

// GET /api/calendar/:channelId — dates with recordings
app.get('/api/calendar/:channelId', (req, res) => {
  const channelId = parseInt(req.params.channelId);
  const dates = storage.getDatesWithRecordings(channelId);
  res.json({ channelId, dates });
});

// GET /api/storage — disk usage stats
app.get('/api/storage', (req, res) => {
  const disk = storage.getDiskUsage();
  const dbStats = db.getStorageStats();
  res.json({ disk, database: dbStats });
});

// POST /api/channels/:id/snapshot — take a snapshot
app.post('/api/channels/:id/snapshot', async (req, res) => {
  const ch = config.channels.find(c => c.id === parseInt(req.params.id));
  if (!ch) return res.status(404).json({ error: 'Channel not found' });

  const { spawn } = require('child_process');
  const snapPath = path.join(streamsDir, `ch${ch.id}`, 'snap.jpg');

  const ff = spawn('ffmpeg', [
    '-loglevel', 'error',
    '-rtsp_transport', 'tcp',
    '-i', ch.rtspSub || ch.rtsp,
    '-vframes', '1',
    '-q:v', '2',
    '-y', snapPath,
  ]);

  ff.on('close', (code) => {
    if (code === 0 && fs.existsSync(snapPath)) {
      res.sendFile(snapPath);
    } else {
      res.status(500).json({ error: 'Snapshot failed' });
    }
  });

  ff.on('error', () => res.status(500).json({ error: 'FFmpeg not available' }));
});

// GET /api/channels/:id/snapshot — serve latest snapshot
app.get('/api/channels/:id/snapshot', (req, res) => {
  const snapPath = path.join(streamsDir, `ch${req.params.id}`, 'snap.jpg');
  if (fs.existsSync(snapPath)) {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(snapPath);
  } else {
    res.status(404).json({ error: 'No snapshot' });
  }
});

// ─── Maintenance Cron Jobs ─────────────────────────────────────────────────────
// Run retention cleanup every hour
cron.schedule('0 * * * *', async () => {
  console.log('[Cron] Running retention cleanup...');
  await storage.enforceRetention();
  await storage.enforceDiskLimit();
});

// Take snapshots for all online channels every 10 seconds
cron.schedule('*/10 * * * * *', () => {
  Object.values(recorders).forEach(r => {
    if (r.status === 'online') {
      const ch = r.channel;
      const snapPath = path.join(streamsDir, `ch${ch.id}`, 'snap.jpg');
      const { spawn } = require('child_process');
      spawn('ffmpeg', [
        '-loglevel', 'error',
        '-rtsp_transport', 'tcp',
        '-i', ch.rtspSub || ch.rtsp,
        '-vframes', '1',
        '-q:v', '3',
        '-y', snapPath,
      ]);
    }
  });
});

// ─── Start ─────────────────────────────────────────────────────────────────────
const PORT = config.server.port || 7000;

server.listen(PORT, config.server.host || '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(` DVR Server running on port ${PORT}`);
  console.log(` Web UI: http://localhost:${PORT}`);
  console.log(` API:    http://localhost:${PORT}/api`);
  console.log(`==================================================\n`);

  // Start all recorders
  Object.values(recorders).forEach(r => r.start());
  console.log(`Started ${Object.keys(recorders).length} channel recorders`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  Object.values(recorders).forEach(r => r.stop());
  server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
  Object.values(recorders).forEach(r => r.stop());
  server.close(() => process.exit(0));
});
