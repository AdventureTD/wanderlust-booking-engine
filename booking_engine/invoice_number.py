"""
Wanderlust Booking Engine — sequential invoice numbering.

Produces invoice numbers like WBE-INV-0001, WBE-INV-0002, ... backed by a
persistent counter file. In the live Wix deployment this counter should live in
a Wix `Counters` collection and be incremented atomically; this file-based
version is the reference implementation the external service uses.
"""

import os
import json
import threading

COUNTER_PATH = os.environ.get(
    "WBE_COUNTER_PATH",
    "/home/wanderlust/wanderlust-booking-engine/data/invoice_counter.json",
)
PREFIX = "WBE-INV-"
PAD = 4

_lock = threading.Lock()


def _read():
    if not os.path.exists(COUNTER_PATH):
        return 0
    try:
        return int(json.load(open(COUNTER_PATH)).get("last", 0))
    except Exception:
        return 0


def _write(n):
    os.makedirs(os.path.dirname(COUNTER_PATH), exist_ok=True)
    with open(COUNTER_PATH, "w") as f:
        json.dump({"last": n}, f)


def next_invoice_number() -> str:
    """Atomically increment and return the next invoice number."""
    with _lock:
        n = _read() + 1
        _write(n)
        return f"{PREFIX}{n:0{PAD}d}"


def peek_last() -> str:
    n = _read()
    return f"{PREFIX}{n:0{PAD}d}" if n else "(none issued yet)"
