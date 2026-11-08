"""AI Monitor Worker — DeepSeek analyses playout logs and writes health reports."""
import json
import logging
import threading
import time
from playout import config, schedule as sched, db
from playout.workers import deepseek_client as ds

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a broadcast operations engineer monitoring a 3-channel movie playout system.
Analyse the provided playout logs and produce a concise health report.
Respond ONLY with valid JSON — no explanations, no markdown fences."""


def run_once() -> dict:
    """Read recent logs across all channels and ask DeepSeek for a health report."""
    logs = sched.recent_log(channel_id=None, limit=100)
    if not logs:
        return {"status": "no_logs"}

    log_text = "\n".join(
        f"[{r['ts']}] CH{r['channel_id'] or '?'} {r['level']} {r['event']} {r['detail'] or ''}"
        for r in reversed(logs)
    )

    user_msg = f"""
Recent playout logs (newest at bottom):
{log_text}

Analyse and return JSON with keys:
  "severity": "OK" | "WARN" | "ERROR",
  "summary": "One-sentence overall health statement",
  "issues": ["list of specific problems detected, if any"],
  "recommendations": ["list of actionable recommendations"]
"""
    result = ds.chat_json([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_msg},
    ], temperature=0.2, max_tokens=512)

    if not isinstance(result, dict):
        raise ValueError(f"Unexpected response: {type(result)}")

    severity = result.get("severity", "OK")
    summary  = result.get("summary", "")
    detail   = json.dumps(result)

    c = db.get()
    c.execute(
        "INSERT INTO health_reports (summary, severity, detail) VALUES (?,?,?)",
        (summary, severity, detail),
    )
    c.execute(
        "INSERT INTO ai_tasks (task_type, status, result, finished_at)"
        " VALUES ('monitor', 'done', ?, datetime('now'))",
        (detail,),
    )
    c.commit()

    if severity != "OK":
        log.warning("AI Monitor: %s — %s", severity, summary)
    else:
        log.info("AI Monitor: %s", summary)

    return {"status": "ok", "severity": severity, "summary": summary}


def latest_report() -> dict | None:
    row = db.get().execute(
        "SELECT * FROM health_reports ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if not row:
        return None
    report = dict(row)
    try:
        report["detail_parsed"] = json.loads(report["detail"])
    except Exception:
        pass
    return report


# ── background thread ─────────────────────────────────────────────────────────

_stop   = threading.Event()
_thread: threading.Thread | None = None


def start():
    global _thread
    _stop.clear()

    def _loop():
        log.info("AI Monitor started (interval %d min)", config.AI_MONITOR_INTERVAL_MINS)
        time.sleep(30)
        while not _stop.is_set():
            try:
                r = run_once()
                log.info("AI Monitor pass: %s", r)
            except Exception as exc:
                log.exception("AI Monitor unhandled error: %s", exc)
            _stop.wait(config.AI_MONITOR_INTERVAL_MINS * 60)
        log.info("AI Monitor stopped")

    _thread = threading.Thread(target=_loop, name="ai-monitor", daemon=True)
    _thread.start()


def stop():
    _stop.set()
