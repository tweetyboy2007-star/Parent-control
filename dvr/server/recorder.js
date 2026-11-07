const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('./database');

class ChannelRecorder {
  constructor(channel, config, storageManager, eventEmitter) {
    this.channel = channel;
    this.config = config;
    this.storage = storageManager;
    this.emit = (event, data) => eventEmitter.emit(event, data);

    this.recordProc = null;
    this.liveProc = null;
    this.currentRecordingId = null;
    this.currentFilePath = null;
    this.segmentStartTime = null;
    this.status = 'offline';
    this.restartTimer = null;
    this.consecutiveFails = 0;

    this.liveDir = path.join(config.storage.streamsDir, `ch${channel.id}`);
    if (!fs.existsSync(this.liveDir)) fs.mkdirSync(this.liveDir, { recursive: true });
  }

  start() {
    if (!this.channel.enabled) return;
    console.log(`[Ch${this.channel.id}] Starting: ${this.channel.name}`);
    this._startRecording();
    this._startLiveStream();
  }

  stop() {
    this._setStatus('offline');
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this._killProc('recordProc');
    this._killProc('liveProc');
    this._finalizeCurrentRecording();
  }

  _startRecording() {
    const filePath = this.storage.buildSegmentPath(this.channel.id);
    const segmentSeconds = this.config.storage.segmentDurationSeconds || 300;

    this.currentFilePath = filePath;
    this.segmentStartTime = Math.floor(Date.now() / 1000);
    this.currentRecordingId = db.insertRecording({
      channelId: this.channel.id,
      channelName: this.channel.name,
      startTime: this.segmentStartTime,
      filePath,
    });

    const args = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', this.channel.rtsp,
      '-c', 'copy',
      '-t', String(segmentSeconds),
      '-movflags', '+faststart',
      '-y', filePath,
    ];

    this.recordProc = spawn('ffmpeg', args);

    this.recordProc.stderr.on('data', (data) => {
      const msg = data.toString();
      if (msg.includes('Connection refused') || msg.includes('No route') || msg.includes('timeout')) {
        this._handleStreamError('connection_failed');
      }
    });

    this.recordProc.on('close', (code) => {
      this._finalizeCurrentRecording();

      if (code === 0 || code === null) {
        this.consecutiveFails = 0;
        if (this.status !== 'offline') {
          this._startRecording();
        }
      } else {
        this._handleStreamError('ffmpeg_exit');
      }
    });

    this.recordProc.on('error', (err) => {
      console.error(`[Ch${this.channel.id}] Record process error:`, err.message);
      this._handleStreamError('process_error');
    });
  }

  _startLiveStream() {
    const m3u8Path = path.join(this.liveDir, 'live.m3u8');

    const args = [
      '-loglevel', 'warning',
      '-rtsp_transport', 'tcp',
      '-i', this.channel.rtspSub || this.channel.rtsp,
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '6',
      '-hls_flags', 'delete_segments+append_list',
      '-hls_segment_filename', path.join(this.liveDir, 'seg%03d.ts'),
      '-y', m3u8Path,
    ];

    this.liveProc = spawn('ffmpeg', args);

    this.liveProc.on('close', (code) => {
      if (code !== 0 && this.status !== 'offline') {
        setTimeout(() => this._startLiveStream(), 5000);
      }
    });

    this.liveProc.on('error', () => {
      setTimeout(() => this._startLiveStream(), 5000);
    });

    // Mark online after 3s if process is still running
    setTimeout(() => {
      if (this.liveProc && !this.liveProc.killed) {
        this._setStatus('online');
      }
    }, 3000);
  }

  _finalizeCurrentRecording() {
    if (!this.currentRecordingId) return;
    const id = this.currentRecordingId;
    const filePath = this.currentFilePath;
    this.currentRecordingId = null;
    this.currentFilePath = null;

    if (!filePath || !fs.existsSync(filePath)) return;

    const endTime = Math.floor(Date.now() / 1000);
    const fileSize = this.storage.getFileSize(filePath);
    const durationSeconds = endTime - (this.segmentStartTime || endTime);

    db.finalizeRecording(id, { endTime, fileSize, durationSeconds });
  }

  _handleStreamError(reason) {
    this.consecutiveFails++;
    this._setStatus('error');

    const delay = Math.min(5000 * Math.pow(2, this.consecutiveFails - 1), 60000);
    console.warn(`[Ch${this.channel.id}] Stream error (${reason}), retry in ${delay/1000}s`);

    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      if (this.status !== 'offline') {
        this._startRecording();
      }
    }, delay);
  }

  _setStatus(status) {
    if (this.status !== status) {
      this.status = status;
      db.upsertChannelStatus(this.channel.id, this.channel.name, status);
      this.emit('channelStatus', { channelId: this.channel.id, status, name: this.channel.name });
    }
  }

  _killProc(key) {
    if (this[key]) {
      try { this[key].kill('SIGTERM'); } catch {}
      this[key] = null;
    }
  }

  getLiveM3u8Path() {
    return path.join(this.liveDir, 'live.m3u8');
  }

  getStatus() {
    return {
      id: this.channel.id,
      name: this.channel.name,
      status: this.status,
      enabled: this.channel.enabled,
      brand: this.channel.brand,
      liveUrl: `/live/ch${this.channel.id}/live.m3u8`,
    };
  }
}

module.exports = ChannelRecorder;
