"""Thin wrapper around the DeepSeek chat completion API."""
import json
import logging
import time
import requests
from playout import config

log = logging.getLogger(__name__)


class DeepSeekError(RuntimeError):
    pass


def chat(messages: list[dict], *,
         temperature: float = 0.4,
         max_tokens: int = 2048) -> str:
    """Send messages to DeepSeek, return the reply content string."""
    if not config.DEEPSEEK_API_KEY:
        raise DeepSeekError("DEEPSEEK_API_KEY is not set")

    payload = {
        "model":       config.DEEPSEEK_MODEL,
        "messages":    messages,
        "temperature": temperature,
        "max_tokens":  max_tokens,
    }
    headers = {
        "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
        "Content-Type":  "application/json",
    }

    for attempt in range(3):
        try:
            resp = requests.post(
                f"{config.DEEPSEEK_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=90,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data["choices"][0]["message"]["content"]
            log.debug("DeepSeek reply (%d chars)", len(content))
            return content
        except requests.HTTPError as exc:
            body = exc.response.text[:300] if exc.response else ""
            log.warning("DeepSeek HTTP %s (attempt %d): %s",
                        exc.response.status_code if exc.response else "?",
                        attempt + 1, body)
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                raise DeepSeekError(f"DeepSeek HTTP error: {exc}") from exc
        except requests.RequestException as exc:
            log.warning("DeepSeek request error (attempt %d): %s", attempt + 1, exc)
            if attempt < 2:
                time.sleep(2 ** attempt)
            else:
                raise DeepSeekError(f"DeepSeek request failed: {exc}") from exc

    raise DeepSeekError("All retry attempts exhausted")


def chat_json(messages: list[dict], **kw) -> dict | list:
    """Like chat() but parse the reply as JSON (strips markdown fences)."""
    raw = chat(messages, **kw)
    # Strip ```json ... ``` or ``` ... ``` fences
    text = raw.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:] if lines[0].startswith("```") else lines
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    return json.loads(text)
