"""The retired calendar debug URL must never dispatch calendar writes."""

from pathlib import Path
import sys
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import invoice_service


@pytest.mark.parametrize(
    "query,headers",
    [
        ("", {}),
        ("?guest_name=Test&check_in=2099-01-01&check_out=2099-01-02", {}),
        ("?debug=true&secret=invalid", {"X-WBE-Secret": "invalid"}),
        ("?force=true", {"X-WBE-Secret": "test-only-shared-secret"}),
        ("?arbitrary=value", {"Authorization": "Bearer invalid", "X-Debug": "true"}),
    ],
    ids=["anonymous", "booking-query", "invalid-secret", "valid-secret", "arbitrary-headers"],
)
def test_calendar_debug_is_not_found_without_calendar_calls(monkeypatch, query, headers):
    monkeypatch.setattr(invoice_service, "SHARED_SECRET", "test-only-shared-secret")
    calendar = Mock(return_value=None)
    monkeypatch.setattr(invoice_service, "create_calendar_event", calendar)

    with TestClient(invoice_service.app) as client:
        response = client.get("/calendar-debug" + query, headers=headers)

    # A combined observation makes both the unsafe status and dispatch visible in RED.
    assert (response.status_code, calendar.call_count) == (404, 0)
