"""
Wanderlust Booking Engine — table-driven messages for the booking page.

The admin creates/edits messages in the admin console (orWix Content Manager).
Messages show on the guest booking page (e.g. above the date-picker) when:
- is_active = True
- today is between start_date and end_date (inclusive; null = no limit)
- display_page matches the current page (e.g. "search")

Fields:
  id, title, body, start_date, end_date, is_active, display_page, priority,
  created_at, updated_at

Usage:
  msgs = MessageStore()
  msgs.add(Message(...))
  active = msgs.active_for("search", today=date(2026,7,15))
"""

from dataclasses import dataclass, field, asdict
from datetime import date
from typing import List, Optional
import itertools


@dataclass
class Message:
    id: str = ""
    title: str = ""
    body: str = ""       # the message text (supports plain text; caller can HTML-escape)
    start_date: Optional[date] = None   # inclusive; None = no start limit
    end_date: Optional[date] = None     # inclusive; None = no end limit
    is_active: bool = True
    display_page: str = "search"        # which page this message targets
    priority: int = 0                   # higher = shown first
    created_at: str = ""                # ISO date string
    updated_at: str = ""                # ISO date string

    def to_dict(self) -> dict:
        return asdict(self)

    def is_visible_on(self, page: str, today: date = None) -> bool:
        """Does this message currently show on the given page?"""
        if not self.is_active:
            return False
        if self.display_page != page:
            return False
        today = today or date.today()
        if self.start_date and today < self.start_date:
            return False
        if self.end_date and today > self.end_date:
            return False
        return True


class MessageStore:
    """In-memory store for messages. On Wix, this becomes a Data collection."""

    def __init__(self):
        self._messages: dict[str, Message] = {}
        self._counter = itertools.count(1)

    def _next_id(self) -> str:
        return f"MSG-{next(self._counter):04d}"

    def add(self, msg: Message) -> Message:
        if not msg.id:
            msg.id = self._next_id()
        if not msg.created_at:
            from datetime import datetime
            msg.created_at = datetime.now().isoformat()[:19]
        self._messages[msg.id] = msg
        return msg

    def get(self, msg_id: str) -> Message:
        if msg_id not in self._messages:
            raise KeyError(f"No message {msg_id}")
        return self._messages[msg_id]

    def update(self, msg_id: str, **kwargs) -> Message:
        msg = self.get(msg_id)
        for k, v in kwargs.items():
            if hasattr(msg, k):
                setattr(msg, k, v)
        from datetime import datetime
        msg.updated_at = datetime.now().isoformat()[:19]
        return msg

    def delete(self, msg_id: str) -> None:
        if msg_id not in self._messages:
            raise KeyError(f"No message {msg_id}")
        del self._messages[msg_id]

    def all(self) -> List[Message]:
        return list(self._messages.values())

    def active_for(self, page: str, today: date = None) -> List[Message]:
        """Return messages visible on `page`, sorted by priority desc."""
        today = today or date.today()
        visible = [m for m in self._messages.values() if m.is_visible_on(page, today)]
        visible.sort(key=lambda m: (-m.priority, m.id))
        return visible
