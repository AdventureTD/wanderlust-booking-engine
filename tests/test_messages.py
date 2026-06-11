"""
Tests for booking_engine/messages.py — table-driven booking page messages.
Run: python3 tests/test_messages.py
"""

from datetime import date
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from booking_engine.messages import Message, MessageStore


def test_message_no_dates_always_visible():
    m = Message(title="Welcome", body="Book your adventure today!", display_page="search")
    assert m.is_visible_on("search", today=date(2026, 1, 1))
    assert m.is_visible_on("search", today=date(2027, 12, 31))
    print("PASS: test_message_no_dates_always_visible")


def test_message_page_filter():
    m = Message(title="Search tip", body="Try 7+ nights for a discount", display_page="search")
    assert m.is_visible_on("search")
    assert not m.is_visible_on("detail")
    print("PASS: test_message_page_filter")


def test_message_inactive():
    m = Message(title="Expired promo", body="Summer 2025", is_active=False)
    assert not m.is_visible_on("search", today=date(2026, 1, 1))
    print("PASS: test_message_inactive")


def test_message_date_range_enforced():
    m = Message(
        title="Off-season",
        body="Hotel closed July 15–31.",
        start_date=date(2026, 7, 15),
        end_date=date(2026, 7, 31),
    )
    assert not m.is_visible_on("search", today=date(2026, 7, 10))  # before
    assert m.is_visible_on("search", today=date(2026, 7, 15))      # start boundary
    assert m.is_visible_on("search", today=date(2026, 7, 20))      # middle
    assert m.is_visible_on("search", today=date(2026, 7, 31))      # end boundary
    assert not m.is_visible_on("search", today=date(2026, 8, 1))  # after
    print("PASS: test_message_date_range_enforced")


def test_store_add_and_get():
    store = MessageStore()
    m = Message(title="A", body="B", display_page="search")
    added = store.add(m)
    assert added.id.startswith("MSG-")
    fetched = store.get(added.id)
    assert fetched.title == "A"
    print("PASS: test_store_add_and_get")


def test_store_update():
    store = MessageStore()
    m = store.add(Message(title="Old", body="Old body", display_page="search"))
    updated = store.update(m.id, title="New", body="New body")
    assert updated.title == "New"
    assert updated.updated_at != ""
    print("PASS: test_store_update")


def test_store_delete():
    store = MessageStore()
    m = store.add(Message(title="X", body="Y", display_page="search"))
    store.delete(m.id)
    try:
        store.get(m.id)
        assert False
    except KeyError:
        pass
    print("PASS: test_store_delete")


def test_store_active_for_priority_sort():
    """Higher priority messages should come first."""
    store = MessageStore()
    store.add(Message(title="General", body="...", priority=0, display_page="search"))
    store.add(Message(title="Urgent", body="...", priority=10, display_page="search"))
    store.add(Message(title="Other page", body="...", priority=100, display_page="detail"))

    active = store.active_for("search", today=date(2026, 1, 1))
    assert len(active) == 2
    assert active[0].title == "Urgent"  # priority 10 > 0
    print("PASS: test_store_active_for_priority_sort")


def test_store_active_filters_by_date():
    store = MessageStore()
    store.add(Message(title="Always", body="...", display_page="search"))
    store.add(Message(title="July only", body="Closed in July",
                      start_date=date(2026, 7, 1), end_date=date(2026, 7, 31),
                      display_page="search"))
    active_june = store.active_for("search", today=date(2026, 6, 15))
    assert len(active_june) == 1
    assert active_june[0].title == "Always"

    active_july = store.active_for("search", today=date(2026, 7, 15))
    assert len(active_july) == 2
    print("PASS: test_store_active_filters_by_date")


def test_real_world_offseason_message():
    """An admin configures an off-season closure message."""
    store = MessageStore()
    store.add(Message(
        title="Off-Season Closure",
        body="Wanderlust Caribbean will be closed for off-season from July 15 to October 15. "
             "We look forward to welcoming you back in October!",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 10, 15),
        display_page="search",
        priority=100,
    ))
    # In early June (before closure) it should warn guests
    early_june = store.active_for("search", today=date(2026, 6, 1))
    assert len(early_june) == 1
    assert "closed" in early_june[0].body.lower()
    # In November (after reopening) it should not show
    november = store.active_for("search", today=date(2026, 11, 1))
    assert len(november) == 0
    print("PASS: test_real_world_offseason_message")


if __name__ == "__main__":
    test_message_no_dates_always_visible()
    test_message_page_filter()
    test_message_inactive()
    test_message_date_range_enforced()
    test_store_add_and_get()
    test_store_update()
    test_store_delete()
    test_store_active_for_priority_sort()
    test_store_active_filters_by_date()
    test_real_world_offseason_message()
    print("\n=== All 10 message tests passed ===")
