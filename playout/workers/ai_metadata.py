"""AI Metadata Worker — DeepSeek enriches movie descriptions, genre, rating."""
import json
import logging
import threading
import time
from playout import config, catalog, db
from playout.workers import deepseek_client as ds

log = logging.getLogger(__name__)

SYSTEM_PROMPT = """\
You are a professional film database curator.
Given a movie title and year, provide accurate metadata.
Respond ONLY with valid JSON — no explanations, no markdown fences."""


def enrich_movie(movie: dict) -> dict:
    """Ask DeepSeek to generate metadata for one movie. Returns updated fields."""
    user_msg = f"""
Movie: "{movie['title']}" ({movie.get('year', 'unknown')})
Current genre tag: {movie.get('genre', 'unknown')}

Return JSON with keys:
  "description": "2–3 sentence plot summary (no spoilers)",
  "genre": "primary genre / subgenre tag (e.g. Action/Thriller)",
  "rating": float 1.0–10.0 (IMDb-style audience score)
"""
    result = ds.chat_json([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user",   "content": user_msg},
    ], temperature=0.3, max_tokens=256)

    if not isinstance(result, dict):
        raise ValueError(f"Unexpected response type: {type(result)}")
    return result


def run_once() -> dict:
    """Enrich up to 10 unenriched movies per pass."""
    movies = catalog.unenriched_movies()
    if not movies:
        return {"status": "nothing_to_enrich"}

    enriched = 0
    errors   = 0
    for movie in movies:
        try:
            meta = enrich_movie(movie)
            catalog.update_movie_metadata(
                movie["id"],
                description=meta.get("description", ""),
                genre=meta.get("genre", movie.get("genre", "")),
                rating=float(meta.get("rating", movie.get("rating", 0))),
            )
            log.info("Enriched: %s (%d)", movie["title"], movie["id"])
            enriched += 1
        except Exception as exc:
            log.error("Enrich failed for %s: %s", movie["title"], exc)
            errors += 1
        time.sleep(0.5)  # polite pacing

    result = {"status": "ok", "enriched": enriched, "errors": errors}
    _save_task(json.dumps(result))
    return result


def _save_task(result_json: str):
    c = db.get()
    c.execute(
        "INSERT INTO ai_tasks (task_type, status, result, finished_at)"
        " VALUES ('metadata', 'done', ?, datetime('now'))",
        (result_json,),
    )
    c.commit()


# ── background thread ─────────────────────────────────────────────────────────

_stop   = threading.Event()
_thread: threading.Thread | None = None


def start():
    global _thread
    _stop.clear()

    def _loop():
        log.info("AI Metadata enricher started (interval %d min)",
                 config.AI_METADATA_INTERVAL_MINS)
        time.sleep(10)
        while not _stop.is_set():
            try:
                r = run_once()
                log.info("AI Metadata pass: %s", r)
            except Exception as exc:
                log.exception("AI Metadata unhandled error: %s", exc)
            _stop.wait(config.AI_METADATA_INTERVAL_MINS * 60)
        log.info("AI Metadata enricher stopped")

    _thread = threading.Thread(target=_loop, name="ai-metadata", daemon=True)
    _thread.start()


def stop():
    _stop.set()
