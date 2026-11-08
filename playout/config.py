import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

DEEPSEEK_API_KEY  = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1"
DEEPSEEK_MODEL    = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

CHANNELS = [
    {"id": 1, "name": "Movie Channel 1", "genre_focus": "Action / Thriller"},
    {"id": 2, "name": "Movie Channel 2", "genre_focus": "Drama / Romance"},
    {"id": 3, "name": "Movie Channel 3", "genre_focus": "Comedy / Family"},
]

DB_PATH    = Path(__file__).parent / "data" / "playout.db"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", "./media")).expanduser()
HLS_ROOT   = Path(os.environ.get("HLS_ROOT", "/tmp/playout_hls"))
WEB_HOST   = os.environ.get("WEB_HOST", "0.0.0.0")
WEB_PORT   = int(os.environ.get("WEB_PORT", "7700"))

AI_SCHEDULER_INTERVAL_MINS = 60
AI_METADATA_INTERVAL_MINS  = 30
AI_MONITOR_INTERVAL_MINS   = 15
