"""Flask web server — dashboard + REST API for the 3-channel playout system."""
import json
import logging
from datetime import datetime, timedelta
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pathlib import Path

from playout import channels, catalog, schedule as sched, config
from playout.workers import ai_scheduler, ai_metadata, ai_monitor

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"

app = Flask(__name__, static_folder=str(STATIC))
CORS(app)


# ── Dashboard ─────────────────────────────────────────────────────────────────

@app.get("/")
def index():
    return send_from_directory(STATIC, "index.html")


# ── Channel API ───────────────────────────────────────────────────────────────

@app.get("/api/channels")
def api_channels():
    return jsonify([ch.status() for ch in channels.all_channels()])


@app.get("/api/channels/<int:cid>/schedule")
def api_channel_schedule(cid: int):
    hours = int(request.args.get("hours", 24))
    return jsonify(sched.upcoming(cid, hours=hours))


@app.get("/api/channels/<int:cid>/log")
def api_channel_log(cid: int):
    limit = int(request.args.get("limit", 50))
    return jsonify(sched.recent_log(cid, limit=limit))


# ── Catalog API ───────────────────────────────────────────────────────────────

@app.get("/api/catalog")
def api_catalog():
    return jsonify(catalog.all_movies())


@app.post("/api/catalog")
def api_catalog_add():
    d = request.json or {}
    required = ("title", "duration_secs")
    if not all(k in d for k in required):
        return jsonify({"error": "title and duration_secs required"}), 400
    movie_id = catalog.add_movie(
        title=d["title"],
        year=int(d.get("year", 0)),
        genre=d.get("genre", ""),
        duration_secs=int(d["duration_secs"]),
        file_path=d.get("file_path", ""),
        rating=float(d.get("rating", 0)),
    )
    return jsonify({"id": movie_id}), 201


@app.post("/api/catalog/<int:mid>/enrich")
def api_enrich_movie(mid: int):
    movie = catalog.get_movie(mid)
    if not movie:
        return jsonify({"error": "not found"}), 404
    try:
        meta = ai_metadata.enrich_movie(movie)
        catalog.update_movie_metadata(
            mid,
            description=meta.get("description", ""),
            genre=meta.get("genre", movie["genre"]),
            rating=float(meta.get("rating", movie["rating"])),
        )
        return jsonify({"status": "enriched", "meta": meta})
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


# ── Schedule API ──────────────────────────────────────────────────────────────

@app.post("/api/schedule")
def api_schedule_add():
    d = request.json or {}
    required = ("channel_id", "movie_id", "start_time")
    if not all(k in d for k in required):
        return jsonify({"error": "channel_id, movie_id, start_time required"}), 400
    movie = catalog.get_movie(int(d["movie_id"]))
    if not movie:
        return jsonify({"error": "movie not found"}), 404
    start = datetime.strptime(d["start_time"], "%Y-%m-%dT%H:%M:%S")
    sid = sched.schedule_movie(
        int(d["channel_id"]), int(d["movie_id"]),
        start, movie["duration_secs"],
    )
    return jsonify({"id": sid}), 201


@app.post("/api/schedule/<int:sid>/skip")
def api_skip(sid: int):
    sched.mark_skipped(sid)
    return jsonify({"status": "skipped"})


# ── AI Worker API ─────────────────────────────────────────────────────────────

@app.post("/api/workers/schedule/run")
def api_run_scheduler():
    try:
        result = ai_scheduler.run_once()
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/workers/metadata/run")
def api_run_metadata():
    try:
        result = ai_metadata.run_once()
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.post("/api/workers/monitor/run")
def api_run_monitor():
    try:
        result = ai_monitor.run_once()
        return jsonify(result)
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/api/workers/health")
def api_health():
    report = ai_monitor.latest_report()
    return jsonify(report or {"severity": "OK", "summary": "No report yet"})


@app.get("/api/workers/tasks")
def api_tasks():
    rows = db_get_tasks()
    return jsonify(rows)


def db_get_tasks() -> list[dict]:
    from playout import db
    rows = db.get().execute(
        "SELECT * FROM ai_tasks ORDER BY id DESC LIMIT 20"
    ).fetchall()
    return [dict(r) for r in rows]


# ── Status ────────────────────────────────────────────────────────────────────

@app.get("/api/status")
def api_status():
    return jsonify({
        "system": "Movie Playout Automation",
        "channels": len(config.CHANNELS),
        "time_utc": datetime.utcnow().isoformat(),
        "deepseek_configured": bool(config.DEEPSEEK_API_KEY),
    })


def run():
    log.info("Web server starting on %s:%d", config.WEB_HOST, config.WEB_PORT)
    app.run(host=config.WEB_HOST, port=config.WEB_PORT,
            debug=False, use_reloader=False, threaded=True)
