"""
Wanderlust Booking Engine — Seasonal rate calendar.

Instead of one fixed nightly rate per room, each room can have a list of
seasonal RateRules. Each rule covers a date range [start, end] (INCLUSIVE of
both ends, since a rule like "High Season Dec 15 - Apr 15" should include
Apr 15 as a high-season night if occupied), carries a priority, and a nightly
rate.

Per-night resolution:
  - For a given night, collect all rules whose range contains it.
  - The highest-priority rule wins (ties: the more specific / later-added rule;
    we use priority then narrowest range as tiebreaker).
  - If no rule matches, fall back to the room's base_rate.

This makes boundary-crossing stays price correctly night-by-night, and lets a
short holiday spike (high priority) override a broad season (low priority).
"""

from dataclasses import dataclass
from datetime import date, timedelta
from typing import List, Optional, Tuple


@dataclass(frozen=True)
class RateRule:
    name: str            # e.g. "High Season", "Christmas Week"
    start: date          # inclusive
    end: date            # inclusive
    nightly_rate: float  # USD
    priority: int = 0    # higher wins when ranges overlap

    def __post_init__(self):
        if self.end < self.start:
            raise ValueError(f"RateRule '{self.name}': end < start")

    def contains(self, night: date) -> bool:
        return self.start <= night <= self.end

    def span_days(self) -> int:
        return (self.end - self.start).days + 1


class RateCalendar:
    """Holds seasonal rate rules per room_code and resolves nightly rates."""

    def __init__(self):
        self._rules = {}  # room_code -> List[RateRule]

    def add_rule(self, room_code: str, rule: RateRule) -> None:
        self._rules.setdefault(room_code, []).append(rule)

    def rules_for(self, room_code: str) -> List[RateRule]:
        return self._rules.get(room_code, [])

    def rate_for_night(self, room_code: str, night: date,
                       base_rate: float) -> Tuple[float, str]:
        """Return (nightly_rate, season_name) for a single night."""
        matching = [r for r in self.rules_for(room_code) if r.contains(night)]
        if not matching:
            return base_rate, "Base"
        # highest priority wins; tiebreak: narrowest span (more specific)
        best = sorted(matching, key=lambda r: (-r.priority, r.span_days()))[0]
        return best.nightly_rate, best.name

    def price_stay(self, room_code: str, check_in: date, check_out: date,
                   base_rate: float) -> dict:
        """
        Resolve each night [check_in, check_out) and return a breakdown:
          {
            total_room_charge, nights,
            per_night: [ {date, rate, season}, ... ],
            grouped: [ {season, nights, rate, subtotal}, ... ]  # collapsed
          }
        """
        if check_out <= check_in:
            raise ValueError("check_out must be after check_in")

        per_night = []
        n = (check_out - check_in).days
        for i in range(n):
            night = check_in + timedelta(days=i)
            rate, season = self.rate_for_night(room_code, night, base_rate)
            per_night.append({"date": night.isoformat(), "rate": rate,
                              "season": season})

        # Collapse consecutive same (season, rate) runs for a clean display.
        grouped = []
        for pn in per_night:
            if grouped and grouped[-1]["season"] == pn["season"] \
                    and grouped[-1]["rate"] == pn["rate"]:
                grouped[-1]["nights"] += 1
                grouped[-1]["subtotal"] = round(
                    grouped[-1]["nights"] * grouped[-1]["rate"], 2)
            else:
                grouped.append({"season": pn["season"], "rate": pn["rate"],
                                "nights": 1, "subtotal": round(pn["rate"], 2)})

        total = round(sum(pn["rate"] for pn in per_night), 2)
        return {"total_room_charge": total, "nights": n,
                "per_night": per_night, "grouped": grouped}
