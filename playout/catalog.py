"""Movie catalog: add, list, update, search."""
import json
import logging
from datetime import datetime
from playout import db

log = logging.getLogger(__name__)

SAMPLE_MOVIES = [
    # Action / Thriller
    ("The Dark Knight",        2008, "Action/Thriller",   9120, 8.9),
    ("Mad Max: Fury Road",     2015, "Action/Thriller",   7200, 8.1),
    ("Heat",                   1995, "Action/Thriller",   10560, 8.3),
    ("John Wick",              2014, "Action/Thriller",   6120, 7.4),
    ("The Bourne Identity",    2002, "Action/Thriller",   6900, 7.9),
    # Drama / Romance
    ("The Shawshank Redemption", 1994, "Drama",           8220, 9.3),
    ("Forrest Gump",           1994, "Drama/Romance",     8220, 8.8),
    ("Titanic",                1997, "Drama/Romance",     11460, 7.9),
    ("A Beautiful Mind",       2001, "Drama",             7920, 8.2),
    ("Schindler's List",       1993, "Drama",             11580, 9.0),
    # Comedy / Family
    ("The Grand Budapest Hotel", 2014, "Comedy",          5940, 8.1),
    ("Home Alone",             1990, "Comedy/Family",     5760, 7.7),
    ("The Princess Bride",     1987, "Comedy/Family",     6120, 8.1),
    ("Paddington 2",           2017, "Comedy/Family",     5940, 7.8),
    ("Toy Story",              1995, "Comedy/Family",     4920, 8.3),
]


def seed_if_empty():
    c = db.get()
    count = c.execute("SELECT COUNT(*) FROM movies").fetchone()[0]
    if count == 0:
        c.executemany(
            "INSERT INTO movies (title, year, genre, duration_secs, rating) VALUES (?,?,?,?,?)",
            SAMPLE_MOVIES,
        )
        c.commit()
        log.info("Seeded %d sample movies", len(SAMPLE_MOVIES))


def all_movies() -> list[dict]:
    rows = db.get().execute(
        "SELECT * FROM movies ORDER BY title"
    ).fetchall()
    return [dict(r) for r in rows]


def get_movie(movie_id: int) -> dict | None:
    row = db.get().execute("SELECT * FROM movies WHERE id=?", (movie_id,)).fetchone()
    return dict(row) if row else None


def movies_by_genre(genre_keyword: str) -> list[dict]:
    rows = db.get().execute(
        "SELECT * FROM movies WHERE genre LIKE ? ORDER BY rating DESC",
        (f"%{genre_keyword}%",),
    ).fetchall()
    return [dict(r) for r in rows]


def add_movie(title: str, year: int, genre: str,
              duration_secs: int, file_path: str = "", rating: float = 0.0) -> int:
    c = db.get()
    cur = c.execute(
        "INSERT INTO movies (title, year, genre, duration_secs, file_path, rating)"
        " VALUES (?,?,?,?,?,?)",
        (title, year, genre, duration_secs, file_path, rating),
    )
    c.commit()
    return cur.lastrowid


def update_movie_metadata(movie_id: int, description: str, genre: str,
                          rating: float, ai_enriched: bool = True):
    c = db.get()
    c.execute(
        "UPDATE movies SET description=?, genre=?, rating=?, ai_enriched=? WHERE id=?",
        (description, genre, rating, int(ai_enriched), movie_id),
    )
    c.commit()


def unenriched_movies() -> list[dict]:
    rows = db.get().execute(
        "SELECT * FROM movies WHERE ai_enriched=0 ORDER BY id LIMIT 10"
    ).fetchall()
    return [dict(r) for r in rows]
