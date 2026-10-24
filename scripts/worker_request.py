#!/usr/bin/env python3
"""Bounded worker HTTP requests, with explicit safe retries and redacted diagnostics."""
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

SAFE_HEADERS = {
    "retry-after", "server", "content-type", "cf-ray", "cf-cache-status",
    "rndr-id", "x-render-origin-server", "x-request-id",
}


def retry_after(value):
    """Return seconds, honoring both Retry-After forms. Invalid values use backoff."""
    try:
        return max(0, int(value))
    except ValueError:
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return 0


def request(url, *, token=None, budget=360, timeout=180, delays=(30, 60, 120)):
    if token is not None and (not token or any(c in token for c in '\r\n')):
        raise RuntimeError("Worker trigger token is missing or invalid")
    deadline = time.monotonic() + budget
    with tempfile.TemporaryDirectory(prefix="prosepect-worker-") as directory:
        headers_path = Path(directory) / "headers"
        body_path = Path(directory) / "body"
        for attempt in range(len(delays) + 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            duration = min(timeout, remaining)
            command = [
                "curl", "--silent", "--show-error", "--proto", "=http,https",
                "--connect-timeout", str(min(20, duration)), "--max-time", str(duration),
                "--max-filesize", "16384", "--dump-header", str(headers_path),
                "--output", str(body_path), "--write-out", "%{http_code}",
                "--request", "POST" if token is not None else "GET", url,
            ]
            # Pass credentials over stdin, not command-line arguments or log output.
            config = ""
            if token is not None:
                command.extend(["--config", "-"])
                config = "header = " + json.dumps("Authorization: Bearer " + token) + "\n"
            headers_path.write_text("")
            result = subprocess.run(command, input=config, text=True, capture_output=True, timeout=duration + 5)
            status = result.stdout.strip()
            headers = {}
            for line in headers_path.read_text().splitlines():
                name, separator, value = line.partition(":")
                if separator and name.lower() in SAFE_HEADERS:
                    headers[name.lower()] = value.strip().replace(token, "<redacted>")[:256] if token else value.strip()[:256]
            print(json.dumps({"attempt": attempt + 1, "http_status": status,
                              "curl_exit": result.returncode, "headers": headers}), flush=True)
            if result.returncode == 0 and status == "200":
                body = json.loads(body_path.read_text())
                if not isinstance(body, dict):
                    raise RuntimeError("Endpoint returned an unexpected success response")
                if token is None:
                    valid = body.get("status") == "ready"
                else:
                    valid = type(body.get("enqueued")) is int and type(body.get("processed")) is bool
                if not valid:
                    raise RuntimeError("Endpoint returned an unexpected success response")
                return
            # A POST timeout/5xx can mean work started: do not replay it. Only an
            # explicit 429 is retried for POST. GET readiness can retry transient failures.
            can_retry = status == "429" and result.returncode == 0
            if token is None:
                can_retry = can_retry or status in {"408", "500", "502", "503", "504"} or result.returncode in {5, 6, 7, 18, 28, 35, 52, 55, 56}
            if not can_retry or attempt == len(delays):
                raise RuntimeError(f"Endpoint failed (HTTP {status}, curl exit {result.returncode})")
            wait = max(delays[attempt], retry_after(headers.get("retry-after", "")))
            if wait >= deadline - time.monotonic():
                break
            print(f"Retrying after {wait:g}s", flush=True)
            time.sleep(wait)
    raise RuntimeError("Endpoint retry budget exhausted")


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {"run", "ready"}:
        raise RuntimeError("Usage: worker_request.py run|ready")
    if sys.argv[1] == "run":
        request("https://api.prosepect.com/internal/synchronization/run",
                token=os.environ.get("WORKER_TRIGGER_TOKEN", ""))
    else:
        request("https://api.prosepect.com/ready", budget=150, timeout=30)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as error:
        # Never print a provider response body, raw headers or credential config.
        print(f"::error::{type(error).__name__}: worker HTTP check failed; see status diagnostics above", file=sys.stderr)
        sys.exit(1)
