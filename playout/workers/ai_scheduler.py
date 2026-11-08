"""AI Scheduler Worker — DeepSeek fills schedule gaps for all 3 channels."""
import json
import logging
import threading
import time
from datetime import datetime
from playout import config, catalog, schedule as sched, db
from playout.workers import deepseek_client as ds

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a professional TV broadcast scheduler for a 3-channel movie network.
Your job is to fill schedule gaps with appropriate movies from the catalog.
Each channel has a genre focus: match movies to that focus when possible.
Respond ONLY with valid JSON — no explanations, no markdown fences."""


def _pick_movies_for_gap(channel_id: int, genre_focus: str,
                         gap_start: datetime, gap_end: datetime,
                         catalog_movies: list[dict]) -> list[dict]:
    """Ask DeepSeek to select movies from the catalog to fill a gap."""
    gap_duration_secs = int((gap_end - gap_start).total_seconds())
    if gap_duration_secs < 300:
        return []

    catalog_summary = [
        {"id": m["id"], "title": m["title"], "year": m["year"],
         "genre": m["genre"], "duration_mins": round(m["duration_secs"] / 60)}
        for m in catalog_movies
    ]

    user_msg = f"""
Channel {channel_id} ({genre_focus}) has a gap from {gap_start.isoformat()} to {gap_end.isoformat()}.
Gap duration: {gap_duration_secs // 60} minutes.
Available movies:
{json.dumps(catalog_summary, indent=2)}

Select movies to fill this gap. The total duration must not exceed the gap.
Prioritize genre match. You may select 1–3 movies.
Return JSON array of objects: [{{"movie_id": <int>, "reason": "<short reason>"}}]
"""
    try:
        result = ds.chat_json([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user",   "content": user_msg},
        ], temperature=0.3, max_tokens=512)
        if isinstance(result, list):
            return result
    except Exception as exc:
        log.error("AI scheduler error on CH%d: %s", channel_id, exc)
    return []


def run_once() -> dict:
    """Run one scheduling pass across all channels. Returns a summary dict."""
    movies = catalog.all_movies()
    if not movies:
        return {"status": "no_catalog"}

    total_added = 0
    summary = {}

    for ch_cfg in config.CHANNELS:
        ch_id     = ch_cfg["id"]
        genre_foc = ch_cfg["genre_focus"]
        gaps      = sched.gaps(ch_id, hours_ahead=24)

        ch_added = 0
        for gap_start, gap_end in gaps:
            picks = _pick_movies_for_gap(ch_id, genre_foc, gap_start, gap_end, movies)
            cursor = gap_start
            for pick in picks:
                movie = next((m for m in movies if m["id"] == pick.get("movie_id")), None)
                if not movie:
                    continue
                dur = movie["duration_secs"]
                if cursor + __import__("datetime").timedelta(seconds=dur) > gap_end:
                    continue
                sched.schedule_movie(ch_id, movie["id"], cursor, dur)
                sched.write_log(ch_id, "INFO",
                                f"AI scheduled: {movie['title']}",
                                f"reason: {pick.get('reason', '')}")
                log.info("[CH%d] AI scheduled %s at %s", ch_id, movie["title"],
                         cursor.isoformat())
                cursor = cursor + __import__("datetime").timedelta(seconds=dur)
                ch_added += 1

        summary[f"ch{ch_id}"] = ch_added
        total_added += ch_added

    _save_task("scheduler", None, json.dumps(summary))
    return {"status": "ok", "added": total_added, "per_channel": summary}


def _save_task(task_type: str, channel_id, result_json: str):
    c = db.get()
    c.execute(
        "INSERT INTO ai_tasks (task_type, channel_id, status, result, finished_at)"
        " VALUES (?,?,  'done', ?, datetime('now'))",
        (task_type, channel_id, result_json),
    )
    c.commit()


# ── background thread ─────────────────────────────────────────────────────────

_stop = threading.Event()
_thread: threading.Thread | None = None


def start():
    global _thread
    _stop.clear()

    def _loop():
        log.info("AI Scheduler started (interval %d min)", config.AI_SCHEDULER_INTERVAL_MINS)
        # Initial run after 5 s to populate schedule at startup
        time.sleep(5)
        while not _stop.is_set():
            try:
                r = run_once()
                log.info("AI Scheduler pass done: %s", r)
            except Exception as exc:
                log.exception("AI Scheduler unhandled error: %s", exc)
            _stop.wait(config.AI_SCHEDULER_INTERVAL_MINS * 60)
        log.info("AI Scheduler stopped")

    _thread = threading.Thread(target=_loop, name="ai-scheduler", daemon=True)
    _thread.start()


def stop():
    _stop.set()
