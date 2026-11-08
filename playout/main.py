#!/usr/bin/env python3
"""
Movie Playout Automation — 3-Channel System with DeepSeek AI Workers
Entry point: python -m playout.main  (from repo root)
            or: python playout/main.py
"""
import logging
import signal
import sys
import threading
from pathlib import Path

# ── make sure repo root is on path ───────────────────────────────────────────
ROOT = Path(__file__).parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)-5s] %(name)s — %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("playout.main")


def main():
    from playout import db, catalog, channels, config
    from playout.workers import ai_scheduler, ai_metadata, ai_monitor
    from playout.web import server

    log.info("=" * 60)
    log.info(" Movie Playout Automation  |  3 Channels")
    log.info(" DeepSeek model : %s", config.DEEPSEEK_MODEL)
    log.info(" API key set    : %s", bool(config.DEEPSEEK_API_KEY))
    log.info(" Dashboard      : http://%s:%d", config.WEB_HOST or "localhost", config.WEB_PORT)
    log.info("=" * 60)

    # ── Initialise database ───────────────────────────────────────────────
    db.init()
    catalog.seed_if_empty()
    log.info("Database ready: %s", config.DB_PATH)

    # ── Start channel supervisor ──────────────────────────────────────────
    channels.start_supervisor()
    log.info("Channel supervisor running")

    # ── Start AI workers ──────────────────────────────────────────────────
    ai_scheduler.start()
    ai_metadata.start()
    ai_monitor.start()
    log.info("AI workers started (scheduler / metadata / monitor)")

    # ── Graceful shutdown ─────────────────────────────────────────────────
    def _shutdown(sig, frame):
        log.info("Shutting down…")
        channels.stop_supervisor()
        ai_scheduler.stop()
        ai_metadata.stop()
        ai_monitor.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # ── Start web server (blocks until shutdown) ──────────────────────────
    server.run()


if __name__ == "__main__":
    main()
