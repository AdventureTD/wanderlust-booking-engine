"""Offline actual-calculator -> actual-renderer tests, never purchase authority."""
import copy
from datetime import date
from decimal import Decimal
import importlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from booking_engine.invoice import Guest, Invoice
from booking_engine.invoice_word import build_invoice_context, render_invoice_docx
from test_invoice_explicit_components import rendered_pdf_text, assert_pdf_amount


def calculation(**overrides):
    factors = dict(v=1, nights=3, totalPerPerson=.05, penthouseRoomFee=None,
                   propertyFeeRate=.05, taxRateAccommodation=.10, taxRateStandard=.15,
                   promoDiscountRate=0, priceGroups=[
                       dict(roomCode="adventure_suite", quantity=1, guests=2),
                       dict(roomCode="adventure_suite", quantity=1, guests=2)])
    factors.update(overrides)
    # Only local real pure sources are evaluated; no Wix, key, clock or SDK.
    script = r'''
const fs = require('fs');
const groupSource = fs.readFileSync('velo/backend/guestBookingPriceGroups.js','utf8');
const canonicalize = new Function(groupSource.replace('export function ', 'function ') +
    '\nreturn canonicalizeGuestBookingPriceGroups;')();
const source = fs.readFileSync('velo/backend/guestBookingFinancialCalculation.js','utf8')
    .replace(/^import .*;\r?\n/, '').replace('export function ', 'function ');
const calculate = new Function('canonicalizeGuestBookingPriceGroups', source +
    '\nreturn calculateGuestBookingFinancials;')(canonicalize);
process.stdout.write(JSON.stringify(calculate(JSON.parse(fs.readFileSync(0,'utf8')))));
'''
    run = subprocess.run(["node", "-e", script], input=json.dumps(factors),
                         text=True, capture_output=True, cwd=ROOT, timeout=20, check=True)
    result = json.loads(run.stdout)
    assert result != "DENIED"
    return result


def metadata():
    return dict(nights=3, check_in="2026-09-10", check_out="2026-09-13",
                package_title="Offline fixture package", promo_code="")


def adapt(result, **overrides):
    name = "booking_engine.invoice_original_groups"
    assert importlib.util.find_spec(name) is not None, "original-group Invoice adapter missing"
    kwargs = dict(invoice_number="OFFLINE-GROUPS", issue_date=date(2026, 9, 6),
                  guest=Guest("Local Fixture", "fixture@example.invalid", "+15555550100"),
                  display=metadata())
    kwargs.update(overrides)
    return importlib.import_module(name).invoice_from_original_groups(result, **kwargs)


def test_original_duplicates_reach_actual_invoice_and_docx(tmp_path):
    result = calculation()
    assert result["totals"]["grandTotalCents"] == 26
    inv = adapt(result)
    assert isinstance(inv, Invoice)
    assert inv.total == Decimal("0.26")
    assert len(inv.lines) == 2
    assert [(x.net, x.vat, x.gross, x.room_quantity, x.quantity) for x in inv.lines] == [
        (Decimal(".10"), Decimal(".02"), Decimal(".12"), 1, 3)] * 2
    assert all(x.tax_class == "mixed" and x.vat_rate is None and x.unit_price is None for x in inv.lines)
    assert inv.total_guests == 4
    context = build_invoice_context(inv)
    assert context["total_due"] == "$0.26"
    assert [r["name"] for r in context["rooms"]] == ["Adventure Suite"] * 2
    output = tmp_path / "original.docx"
    render_invoice_docx(inv, output)
    with ZipFile(output) as archive:
        text = archive.read("word/document.xml").decode()
    assert "$0.26" in text and text.count("Adventure Suite") == 2
    assert "{{" not in text


@pytest.fixture
def numerical_result():
    return calculation()


@pytest.mark.parametrize("target,key,value", [
    ("root", "v", True), ("root", "v", 2), ("root", "currency", "EUR"),
    ("root", "rounding", "merged"), ("root", "verified", True),
    ("group", "index", 1), ("group", "index", False),
    ("group", "quantity", 0), ("group", "quantity", 2),
    ("group", "quantity", True), ("group", "guests", 3),
    ("group", "roomCode", "unknown"), ("group", "extra", 1),
    ("group", "grossCents", 11), ("group", "discountCents", 1),
    ("group", "roomTotalCents", 9), ("group", "propertyFeeCents", 0),
    ("group", "accommodationVatCents", 0), ("group", "packageVatCents", 0),
    ("group", "grandTotalCents", 12), ("group", "grossCents", 10.0),
    ("group", "grossCents", "10"), ("group", "grossCents", True),
    ("group", "grossCents", -1), ("group", "grossCents", 2**53),
    ("totals", "totalRooms", 1), ("totals", "totalGuests", 2),
    ("totals", "totalGuests", 4.0), ("totals", "extra", 0),
])
def test_full_result_rejects_invalid_fields(numerical_result, target, key, value):
    obj = numerical_result if target == "root" else (
        numerical_result["groups"][0] if target == "group" else numerical_result["totals"])
    obj[key] = value
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_group_component_transfer_cannot_hide_behind_valid_totals(numerical_result):
    # Aggregate-only Invoice validation cannot detect these inconsistent groups.
    numerical_result["groups"][0]["propertyFeeCents"] = 0
    numerical_result["groups"][1]["propertyFeeCents"] = 2
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


@pytest.mark.parametrize("key,value", [
    ("nights", True), ("nights", 0), ("nights", 4), ("nights", 3.0),
    ("check_in", "2026-02-30"), ("check_in", "20260910"),
    ("check_out", "2026-09-09"), ("check_out", "2026-09-13T00:00:00"),
    ("package_title", "<b>Injected</b>"), ("package_title", "A\x00B"),
    ("package_title", "x" * 257), ("promo_code", "x" * 257),
    ("promo_code", "A&B"), ("promo_code", None),
    ("verified", True), ("total", 0), ("payments", []),
])
def test_display_metadata_is_bounded_and_cannot_override_money(numerical_result, key, value):
    display = metadata()
    display[key] = value
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result, display=display)


@pytest.mark.parametrize("key,value", [("invoice_number", "<img/>"),
    ("invoice_number", ""), ("invoice_number", "x" * 65),
    ("issue_date", "2026-09-06"), ("guest", None)])
def test_header_metadata_rejects_unsafe_values(numerical_result, key, value):
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result, **{key: value})


def test_guest_display_rejects_markup(numerical_result):
    guest = Guest("<b>Guest</b>", "fixture@example.invalid", "+15555550100")
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result, guest=guest)


@pytest.mark.parametrize("route", ["word", "reportlab", "fallback"])
@pytest.mark.parametrize("scenario", ["duplicates", "penthouse", "full_discount", "four_rooms", "zero"])
def test_actual_calculator_money_reaches_all_pdf_routes(route, scenario, tmp_path, monkeypatch):
    settings = {}
    expected = (20, 0, 20, 2, 2, 2, 26)
    if scenario in ("penthouse", "full_discount"):
        settings = dict(totalPerPerson=123.45, penthouseRoomFee=10.005,
                        promoDiscountRate=1 if scenario == "full_discount" else .10,
                        priceGroups=[dict(roomCode="penthouse_apartment", quantity=1, guests=2)])
        expected = (27692, 27692, 0, 0, 0, 0, 0) if scenario == "full_discount" else (
            27692, 2769, 24923, 1246, 1246, 1869, 29284)
    elif scenario == "four_rooms":
        settings = dict(totalPerPerson=100, penthouseRoomFee=10,
                        priceGroups=[dict(roomCode="two_bedroom_apartment", quantity=1, guests=3),
                                     dict(roomCode="adventure_suite", quantity=2, guests=2),
                                     dict(roomCode="penthouse_apartment", quantity=1, guests=2)])
        expected = (93000, 0, 93000, 4650, 4650, 6975, 109275)
    elif scenario == "zero":
        settings = dict(totalPerPerson=0)
        expected = (0, 0, 0, 0, 0, 0, 0)
    result = calculation(**settings)
    keys = ("grossCents", "discountCents", "roomTotalCents", "propertyFeeCents",
            "accommodationVatCents", "packageVatCents", "grandTotalCents")
    assert tuple(result["totals"][k] for k in keys) == expected
    inv = adapt(result)
    assert dict(inv._component_cents) == {k: v for k, v in result["totals"].items()
                                       if k not in ("totalRooms", "totalGuests")}
    if scenario == "four_rooms":
        assert inv.total_guests == 9
        assert [line.room_quantity for line in inv.lines] == [1, 2, 1]
        assert [line.label for line in inv.lines] == ["Two Bedroom Apartment", "Adventure Suite", "Penthouse Apartment"]
        assert [line.net for line in inv.lines] == [Decimal("300"), Decimal("400"), Decimal("230")]
    text = rendered_pdf_text(inv, route, tmp_path, monkeypatch)
    for label, cents in [("TOTAL DUE", expected[6]), ("Accommodation VAT:", expected[4]),
                         ("Services VAT:", expected[5]), ("Remaining Balance:", expected[6])]:
        assert_pdf_amount(text, label, f"${Decimal(cents) / 100:,.2f}")
    if route == "word" or expected[3]:
        assert_pdf_amount(text, "Property Fee" if route == "word" else "Property fee",
                          f"${Decimal(expected[3]) / 100:,.2f}")
    else:  # Unchanged ReportLab template omits the zero-fee row.
        assert "Property fee" not in text
    assert_pdf_amount(text, "Adventure Package Fees",
                      f"${Decimal(expected[2] if route == 'word' else expected[0]) / 100:,.2f}")
    if route != "word" and expected[1]:
        assert_pdf_amount(text, "Promo discount", f"-${Decimal(expected[1]) / 100:,.2f}")
    assert "10%" not in text and "15%" not in text
    positions = [text.index(label) for label in dict.fromkeys(line.label for line in inv.lines)]
    assert positions == sorted(positions)
    if scenario == "duplicates":
        assert text.count("Adventure Suite") == 2


def test_caller_mutation_cannot_change_projection(numerical_result):
    display = metadata()
    guest = Guest("Original Guest", "fixture@example.invalid", "+15555550100")
    before = copy.deepcopy(numerical_result)
    inv = adapt(numerical_result, display=display, guest=guest)
    assert numerical_result == before
    numerical_result["groups"].reverse()
    numerical_result["groups"][0]["roomTotalCents"] = 5000
    numerical_result["totals"]["grandTotalCents"] = 9999
    display["package_title"] = "Changed"
    guest.name = "Changed"
    assert inv.guest.name == "Original Guest"
    assert inv.package_title == "Offline fixture package"
    assert inv.lines[0].net == Decimal(".10")
    assert build_invoice_context(inv)["total_due"] == "$0.26"


@pytest.mark.parametrize("location", ["root", "group", "totals", "display"])
def test_every_required_field_must_be_present(numerical_result, location):
    source = {"root": numerical_result, "group": numerical_result["groups"][0],
              "totals": numerical_result["totals"], "display": metadata()}[location]
    for key in source:
        result, display = copy.deepcopy(numerical_result), metadata()
        target = {"root": result, "group": result["groups"][0], "totals": result["totals"],
                  "display": display}[location]
        del target[key]
        with pytest.raises(ValueError, match="original-group"):
            adapt(result, display=display)


@pytest.mark.parametrize("value", [True, 1.0, "1", -1, 2**53, None])
def test_every_component_is_a_bounded_builtin_integer(numerical_result, value):
    for location in ("group", "totals"):
        source = numerical_result["groups"][0] if location == "group" else numerical_result["totals"]
        for key in [key for key in source if key.endswith("Cents")]:
            result = copy.deepcopy(numerical_result)
            target = result["groups"][0] if location == "group" else result["totals"]
            target[key] = value
            with pytest.raises(ValueError, match="original-group"):
                adapt(result)


@pytest.mark.parametrize("value", [None, [], "DENIED", {}, 1])
def test_invalid_top_level_shapes(value):
    with pytest.raises(ValueError, match="original-group"):
        adapt(value)


@pytest.mark.parametrize("value", [[], (), [None], [dict()]])
def test_invalid_group_vectors(numerical_result, value):
    numerical_result["groups"] = value
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_builtin_subclasses_are_not_coerced(numerical_result):
    class Hostile(dict):
        def keys(self):
            raise AssertionError("caller hook invoked")
    with pytest.raises(ValueError, match="original-group"):
        adapt(Hostile(numerical_result))
    numerical_result["groups"][0] = Hostile(numerical_result["groups"][0])
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


@pytest.mark.parametrize("code,count,guests", [("adventure_suite", 4, 2),
    ("penthouse_apartment", 2, 2), ("two_bedroom_apartment", 2, 4)])
def test_reconciled_but_over_capacity_groups_are_denied(numerical_result, code, count, guests):
    group = numerical_result["groups"][0]
    group.update(roomCode=code, quantity=count, guests=guests)
    numerical_result["totals"].update(totalRooms=count+1, totalGuests=count*guests+2)
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_actual_four_guest_occupancy():
    result = calculation(totalPerPerson=100, priceGroups=[
        dict(roomCode="two_bedroom_apartment", quantity=1, guests=4)])
    inv = adapt(result)
    assert inv.total_guests == 4 and inv.lines[0].net == Decimal("400")


@pytest.mark.parametrize("field,maximum", [("name", 256), ("email", 254), ("phone", 64)])
def test_guest_text_bounds(numerical_result, field, maximum):
    guest = Guest("Boundary", "fixture@example.invalid", "+155****0100")
    valid = "x" * maximum
    if field == "email":
        valid = "x" * (maximum - len("@example.invalid")) + "@example.invalid"
    elif field == "phone":
        valid = "1" * maximum
    setattr(guest, field, valid)
    assert getattr(adapt(numerical_result, guest=guest).guest, field) == valid
    for invalid in (valid + "x", "", " ", "a\nB", "A&B", None):
        setattr(guest, field, invalid)
        with pytest.raises(ValueError, match="original-group"):
            adapt(numerical_result, guest=guest)


def test_metadata_positive_boundaries_and_full_detachment(numerical_result):
    display = metadata()
    display.update(package_title="P" * 256, promo_code="D" * 256)
    guest = Guest("Boundary", "fixture@example.invalid", "+155****0100")
    inv = adapt(numerical_result, invoice_number="I" * 64, guest=guest, display=display)
    other = adapt(numerical_result, guest=guest, display=display)
    assert inv.invoice_number == "I" * 64
    assert inv.package_title == "P" * 256 and inv.promo_code == "D" * 256
    snapshot = copy.deepcopy(vars(inv.lines[0]))
    cents = dict(inv._component_cents)
    numerical_result.clear()
    display.clear()
    guest.email = "changed@example.invalid"
    guest.phone = "9999999999"
    other.lines[0].net = Decimal("999")
    other.vat_by_class.clear()
    other.payments.append({"amount": 999})
    assert vars(inv.lines[0]) == snapshot
    assert dict(inv._component_cents) == cents
    assert inv.guest.email == "fixture@example.invalid" and inv.guest.phone == "+155****0100"
    assert inv.check_in == "2026-09-10" and inv.check_out == "2026-09-13"
    assert inv.payments == [] and inv.booking_number == ""
    assert build_invoice_context(inv)["total_due"] == "$0.26"
    with pytest.raises(TypeError):
        inv._component_cents["grandTotalCents"] = 999


def test_distinct_same_class_original_order_and_no_unit_inference():
    result = calculation(priceGroups=[
        dict(roomCode="adventure_suite", quantity=2, guests=2),
        dict(roomCode="adventure_suite", quantity=1, guests=2)])
    inv = adapt(result)
    assert len(inv.lines) == 2 and inv.total_guests == 6
    assert [(line.room_quantity, line.quantity, line.net, line.vat, line.gross)
            for line in inv.lines] == [(2, 3, Decimal('.20'), Decimal('.03'), Decimal('.23')),
                                       (1, 3, Decimal('.10'), Decimal('.02'), Decimal('.12'))]
    assert all(line.unit_price is None and line.vat_rate is None for line in inv.lines)


@pytest.mark.parametrize("key", ["grossCents", "discountCents", "roomTotalCents",
    "propertyFeeCents", "accommodationVatCents", "packageVatCents", "grandTotalCents", "totalVatCents"])
def test_each_total_must_reconcile_at_adapter_boundary(numerical_result, key):
    numerical_result["totals"][key] += 1
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_group_gross_transfer_cannot_hide_behind_valid_totals(numerical_result):
    numerical_result["groups"][0]["grossCents"] -= 1
    numerical_result["groups"][1]["grossCents"] += 1
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_total_guest_count_is_quantity_weighted():
    result = calculation(priceGroups=[dict(roomCode="adventure_suite", quantity=3, guests=2)])
    assert adapt(result).total_guests == 6
    result["totals"]["totalGuests"] = 2
    with pytest.raises(ValueError, match="original-group"):
        adapt(result)


def test_public_four_room_cap_is_independent_of_class_caps(numerical_result):
    group = numerical_result["groups"][0]
    group.update(quantity=3)
    second = numerical_result["groups"][1]
    second.update(roomCode="penthouse_apartment")
    third = dict(group, index=2, roomCode="two_bedroom_apartment", quantity=1, guests=3)
    numerical_result["groups"].append(third)
    for key in numerical_result["totals"]:
        if key.endswith("Cents") and key != "totalVatCents":
            numerical_result["totals"][key] = sum(g[key] for g in numerical_result["groups"])
    numerical_result["totals"].update(totalVatCents=6, totalRooms=5, totalGuests=11)
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


@pytest.mark.parametrize("location", ["totals", "display", "groups", "integer", "string"])
def test_nested_builtin_subclasses_are_denied(numerical_result, location):
    class DictSubclass(dict):
        pass
    class ListSubclass(list):
        pass
    class IntSubclass(int):
        pass
    class StrSubclass(str):
        pass
    display = metadata()
    if location in ("totals", "groups"):
        constructor = DictSubclass if location == "totals" else ListSubclass
        numerical_result[location] = constructor(numerical_result[location])
    elif location == "display":
        display = DictSubclass(display)
    elif location == "integer":
        numerical_result["v"] = IntSubclass(1)
    else:
        numerical_result["currency"] = StrSubclass("USD")
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result, display=display)


@pytest.mark.parametrize("cents,expected", [(4000000000000001, "$40,000,000,000,000.01"),
    (2**53 - 1, "$90,071,992,547,409.91"), (2**53 - 2, None), (2**53, None)])
def test_large_consistent_cents_are_exact_or_denied_not_approximated(cents, expected):
    # Internal consistency fixture, not a claim the JS calculator issued these facts.
    result = calculation(totalPerPerson=0, priceGroups=[
        dict(roomCode="adventure_suite", quantity=1, guests=2)])
    for record in (result["groups"][0], result["totals"]):
        record.update(grossCents=cents, roomTotalCents=cents, grandTotalCents=cents)
    if expected is not None:
        inv = adapt(result)
        assert inv.total == Decimal(cents) / 100
        assert inv.lines[0].net == inv.total and inv.lines[0].gross == inv.total
        assert build_invoice_context(inv)["total_due"] == expected
    else:
        # MAX_SAFE_INTEGER-1 is inside the DTO bound but its .90 rounds to .91
        # in the unchanged float-format admission check. Never approximate it.
        with pytest.raises(ValueError, match="components|original-group"):
            adapt(result)


@pytest.mark.parametrize("code,guests", [("adventure_suite", 1), ("adventure_suite", 3),
    ("penthouse_apartment", 1), ("penthouse_apartment", 3),
    ("two_bedroom_apartment", 2), ("two_bedroom_apartment", 5)])
def test_reconciled_invalid_occupancies_are_denied(numerical_result, code, guests):
    numerical_result["groups"][0].update(roomCode=code, guests=guests)
    numerical_result["totals"]["totalGuests"] = guests + 2
    with pytest.raises(ValueError, match="original-group"):
        adapt(numerical_result)


def test_no_production_importer_or_transport_in_adapter():
    source = ROOT / "booking_engine/invoice_original_groups.py"
    import ast
    tree = ast.parse(source.read_text(encoding="utf-8"))
    imports = [n.module for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
    assert imports == ["datetime", "decimal", "booking_engine.invoice"]
    assert not any(isinstance(n, ast.Import) for n in ast.walk(tree))
    for path in [ROOT / "invoice_service.py", * (ROOT / "booking_engine").glob("*.py")]:
        if path != source:
            assert "invoice_original_groups" not in path.read_text(encoding="utf-8")
