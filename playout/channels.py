"""Channel state machine — tracks ON_AIR / IDLE / ERROR per channel."""
import logging
import threading
import time
from datetime import datetime, timezone
from playout import config, schedule as sched

log = logging.getLogger(__name__)

class ChannelState:
    IDLE    = "IDLE"
    ON_AIR  = "ON_AIR"
    ERROR   = "ERROR"


class Channel:
    def __init__(self, channel_cfg: dict):
        self.id          = channel_cfg["id"]
        self.name        = channel_cfg["name"]
        self.genre_focus = channel_cfg["genre_focus"]
        self.state       = ChannelState.IDLE
        self.current_schedule_id: int | None = None
        self.current_title: str = ""
        self.error_msg: str = ""
        self._lock       = threading.Lock()

    def tick(self):
        """Called every 10 s by the supervisor loop to advance state."""
        with self._lock:
            current = sched.get_current(self.id)
            if current:
                if self.state != ChannelState.ON_AIR:
                    self.state    = ChannelState.ON_AIR
                    self.current_title = current["title"]
                    self.current_schedule_id = current["id"]
                    sched.mark_playing(current["id"])
                    sched.write_log(self.id, "INFO",
                                    f"ON_AIR: {current['title']}", "")
                    log.info("[CH%d] ON AIR: %s", self.id, current["title"])
                # Check if the item just finished (end_time passed)
                end = datetime.strptime(current["end_time"], "%Y-%m-%dT%H:%M:%S")
                if datetime.utcnow() >= end:
                    sched.mark_done(current["id"])
                    sched.write_log(self.id, "INFO",
                                    f"DONE: {current['title']}", "")
                    log.info("[CH%d] DONE: %s", self.id, current["title"])
                    self.state = ChannelState.IDLE
                    self.current_title = ""
                    self.current_schedule_id = None
            else:
                if self.state == ChannelState.ON_AIR:
                    sched.write_log(self.id, "WARN", "IDLE — no schedule", "")
                    log.warning("[CH%d] went IDLE, no content scheduled", self.id)
                self.state = ChannelState.IDLE
                self.current_title = ""

    def status(self) -> dict:
        current = sched.get_current(self.id)
        nxt     = sched.get_next(self.id)
        progress = 0.0
        elapsed_secs = 0
        remaining_secs = 0
        if current:
            start = datetime.strptime(current["start_time"], "%Y-%m-%dT%H:%M:%S")
            end   = datetime.strptime(current["end_time"],   "%Y-%m-%dT%H:%M:%S")
            now   = datetime.utcnow()
            total = (end - start).total_seconds()
            done  = max(0, (now - start).total_seconds())
            progress       = round(min(done / total, 1.0) * 100, 1) if total else 0
            elapsed_secs   = int(done)
            remaining_secs = max(0, int(total - done))
        return {
            "id":            self.id,
            "name":          self.name,
            "genre_focus":   self.genre_focus,
            "state":         self.state,
            "current":       dict(current) if current else None,
            "next":          dict(nxt)     if nxt     else None,
            "progress_pct":  progress,
            "elapsed_secs":  elapsed_secs,
            "remaining_secs": remaining_secs,
        }


# ── singleton registry ────────────────────────────────────────────────────────

_channels: dict[int, Channel] = {
    cfg["id"]: Channel(cfg) for cfg in config.CHANNELS
}

def get(channel_id: int) -> Channel:
    return _channels[channel_id]

def all_channels() -> list[Channel]:
    return list(_channels.values())


# ── supervisor loop ───────────────────────────────────────────────────────────

_supervisor_thread: threading.Thread | None = None
_stop_event = threading.Event()

def start_supervisor():
    global _supervisor_thread
    _stop_event.clear()

    def _loop():
        log.info("Channel supervisor started (3 channels)")
        while not _stop_event.is_set():
            for ch in _channels.values():
                try:
                    ch.tick()
                except Exception as exc:
                    log.exception("[CH%d] tick error: %s", ch.id, exc)
            _stop_event.wait(10)
        log.info("Channel supervisor stopped")

    _supervisor_thread = threading.Thread(target=_loop, name="ch-supervisor", daemon=True)
    _supervisor_thread.start()

def stop_supervisor():
    _stop_event.set()
