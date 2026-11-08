"""Schedule engine: manage per-channel programme schedule."""
import logging
from datetime import datetime, timedelta, timezone
from playout import db

log = logging.getLogger(__name__)

FMT = "%Y-%m-%dT%H:%M:%S"


def _now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse(s: str) -> datetime:
    return datetime.strptime(s, FMT)


def _fmt(dt: datetime) -> str:
    return dt.strftime(FMT)


def schedule_movie(channel_id: int, movie_id: int,
                   start: datetime, duration_secs: int) -> int:
    end = start + timedelta(seconds=duration_secs)
    c = db.get()
    cur = c.execute(
        "INSERT INTO schedules (channel_id, movie_id, start_time, end_time)"
        " VALUES (?,?,?,?)",
        (channel_id, movie_id, _fmt(start), _fmt(end)),
    )
    c.commit()
    return cur.lastrowid


def get_current(channel_id: int) -> dict | None:
    now = _fmt(_now_utc())
    row = db.get().execute(
        "SELECT s.*, m.title, m.duration_secs, m.genre, m.rating"
        " FROM schedules s JOIN movies m ON s.movie_id=m.id"
        " WHERE s.channel_id=? AND s.start_time<=? AND s.end_time>?"
        "   AND s.status IN ('scheduled','playing')"
        " ORDER BY s.start_time DESC LIMIT 1",
        (channel_id, now, now),
    ).fetchone()
    return dict(row) if row else None


def get_next(channel_id: int) -> dict | None:
    now = _fmt(_now_utc())
    row = db.get().execute(
        "SELECT s.*, m.title, m.duration_secs, m.genre, m.rating"
        " FROM schedules s JOIN movies m ON s.movie_id=m.id"
        " WHERE s.channel_id=? AND s.start_time>?"
        "   AND s.status='scheduled'"
        " ORDER BY s.start_time ASC LIMIT 1",
        (channel_id, now),
    ).fetchone()
    return dict(row) if row else None


def upcoming(channel_id: int, hours: int = 24) -> list[dict]:
    now = _now_utc()
    until = _fmt(now + timedelta(hours=hours))
    now_s = _fmt(now)
    rows = db.get().execute(
        "SELECT s.*, m.title, m.duration_secs, m.genre"
        " FROM schedules s JOIN movies m ON s.movie_id=m.id"
        " WHERE s.channel_id=? AND s.end_time>? AND s.start_time<?",
        (channel_id, now_s, until),
    ).fetchall()
    return [dict(r) for r in rows]


def gaps(channel_id: int, hours_ahead: int = 24) -> list[tuple[datetime, datetime]]:
    """Return list of (gap_start, gap_end) with no scheduled content."""
    now = _now_utc()
    window_end = now + timedelta(hours=hours_ahead)
    slots = upcoming(channel_id, hours=hours_ahead)
    slots.sort(key=lambda r: r["start_time"])

    result = []
    cursor = now

    for slot in slots:
        s_start = _parse(slot["start_time"])
        s_end   = _parse(slot["end_time"])
        if s_start > cursor + timedelta(minutes=5):
            result.append((cursor, s_start))
        if s_end > cursor:
            cursor = s_end

    if cursor < window_end - timedelta(minutes=5):
        result.append((cursor, window_end))

    return result


def mark_playing(schedule_id: int):
    c = db.get()
    c.execute("UPDATE schedules SET status='playing' WHERE id=?", (schedule_id,))
    c.commit()


def mark_done(schedule_id: int):
    c = db.get()
    c.execute("UPDATE schedules SET status='done' WHERE id=?", (schedule_id,))
    c.commit()


def mark_skipped(schedule_id: int):
    c = db.get()
    c.execute("UPDATE schedules SET status='skipped' WHERE id=?", (schedule_id,))
    c.commit()


def recent_log(channel_id: int | None = None, limit: int = 50) -> list[dict]:
    q = "SELECT * FROM playout_log"
    args: list = []
    if channel_id is not None:
        q += " WHERE channel_id=?"
        args.append(channel_id)
    q += " ORDER BY id DESC LIMIT ?"
    args.append(limit)
    rows = db.get().execute(q, args).fetchall()
    return [dict(r) for r in rows]


def write_log(channel_id: int | None, level: str, event: str, detail: str = ""):
    c = db.get()
    c.execute(
        "INSERT INTO playout_log (channel_id, level, event, detail) VALUES (?,?,?,?)",
        (channel_id, level, event, detail),
    )
    c.commit()
