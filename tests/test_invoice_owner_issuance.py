"""Disconnected N3 tests; fixture comes from the actual Admin writer, never a sender."""
import copy
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
from decimal import Decimal

import pytest

REPO = Path(__file__).resolve().parents[1]

@pytest.fixture(scope="session")
def root(tmp_path_factory):
    target = tmp_path_factory.mktemp("owner-root") / "root.json"
    run = subprocess.run(["node", "--experimental-vm-modules", "scripts/verify-essential-email-dispatch.js"],
                         cwd=REPO, env={**os.environ, "N3_ROOT_FIXTURE": str(target)}, capture_output=True, text=True)
    assert run.returncode == 0, run.stderr
    return json.loads(target.read_text(encoding="utf-8"))


def converter():
    assert importlib.util.find_spec("booking_engine.invoice_owner_issuance"), "missing production owner-root adapter"
    return importlib.import_module("booking_engine.invoice_owner_issuance").invoice_from_owner_issuance


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def modified(root, change):
    result = copy.deepcopy(root)
    document = json.loads(result["document"])
    change(document)
    result["document"] = canonical(document)
    result["documentDigest"] = hashlib.sha256(result["document"].encode()).hexdigest()
    return result


@pytest.mark.parametrize("field", ["_id", "documentDigest", "to", "cc", "from", "kind", "actorId"])
def test_root_integrity(root, field):
    value = copy.deepcopy(root)
    value[field] = "tampered"
    if field == "actorId":
        value[field] = False
    with pytest.raises(ValueError):
        converter()(value)


@pytest.mark.parametrize("bad", [None, True, "1", 1.5, -1, -0.0, float("nan"), 2**53])
def test_all_numeric_fields_strict(root, bad):
    doc = json.loads(root["document"])
    paths = [("components", key) for key in doc["financial"]["components"]]
    paths += [("lines", key) for key in doc["financial"]["lines"][0] if key not in ("label", "taxClass")]
    for kind, key in paths:
        def change(d):
            target = d["financial"][kind]
            (target[0] if kind == "lines" else target)[key] = bad
        with pytest.raises(ValueError):
            converter()(modified(root, change))
    with pytest.raises(ValueError):
        converter()(modified(root, lambda d: d.update(payments=[{"datePaid": "2026-09-07", "paymentAmountCents": bad}])))


@pytest.mark.parametrize("change", [
    lambda d: d.update(verified=True),
    lambda d: d["financial"]["components"].update(grandTotalCents=11501),
    lambda d: d["financial"]["lines"][0].update(taxClass="mixed", unitPriceCents=None),
    lambda d: d["financial"]["lines"][0].update(label="<b>room</b>"),
    lambda d: d["financial"]["lines"][0].update(quantity=1000001),
    lambda d: d.update(payments=[{"datePaid":"2026-09-07", "paymentAmountCents":2**53-1}]*2),
])
def test_unsupported_and_contradictory_shapes(root, change):
    with pytest.raises(ValueError):
        converter()(modified(root, change))


def test_raw_parser_and_unicode(root):
    convert = converter()
    good = modified(root, lambda d: d["guest"].update(name='Élodie "旅" \\ sunshine'))
    assert convert(canonical(good)).guest.name == 'Élodie "旅" \\ sunshine'
    for raw in [canonical(root).replace('"kind":"ISSUANCE"', '"kind":"ISSUANCE","kind":"ISSUANCE"'),
                canonical(root).replace('"actorId":"fixture-admin"', '"actorId":null')]:
        with pytest.raises(ValueError):
            convert(raw)
    for token in ['-0', '0.0', '1e0', 'NaN', 'Infinity']:
        bad = copy.deepcopy(root)
        bad["document"] = bad["document"].replace('"discountCents":0', '"discountCents":' + token)
        bad["documentDigest"] = hashlib.sha256(bad["document"].encode()).hexdigest()
        with pytest.raises(ValueError):
            convert(bad)


def representative(root):
    def change(d):
        d["financial"]["components"].update(grossCents=12000, discountCents=2000,
            accommodationVatCents=700, packageVatCents=300)
        d["financial"]["lines"] = [
            dict(label="First duplicate", taxClass="accommodation", quantity=2, roomQuantity=1,
                 unitPriceCents=123, netCents=3000, vatCents=200, grossCents=3200, vatRateBasisPoints=17),
            dict(label="Second duplicate", taxClass="accommodation", quantity=3, roomQuantity=1,
                 unitPriceCents=456, netCents=5000, vatCents=500, grossCents=5500, vatRateBasisPoints=29),
            dict(label="Final services", taxClass="standard", quantity=1, roomQuantity=1,
                 unitPriceCents=789, netCents=2000, vatCents=300, grossCents=2300, vatRateBasisPoints=51)]
        d["payments"] = [{"datePaid":"2026-09-09", "paymentAmountCents":0},
                         {"datePaid":"2026-09-07", "paymentAmountCents":11501}]
    return modified(root, change)


def test_ordered_non_derived_economics(root):
    inv = converter()(representative(root))
    assert [l.net for l in inv.lines] == [Decimal(30), Decimal(50), Decimal(20)]
    assert [l.unit_price for l in inv.lines] == [Decimal("1.23"), Decimal("4.56"), Decimal("7.89")]
    assert inv.explicit_vat_amounts() == (Decimal(7), Decimal(3))
    assert inv.total - sum(p["paymentAmount"] for p in inv.payments) == Decimal("-0.01")
    assert [p["datePaid"] for p in inv.payments] == ["2026-09-09", "2026-09-07"]


def assert_rendered_oracle(text, document, route):
    import re
    tokens = [line.strip() for line in text.splitlines() if line.strip()]
    c = document['financial']['components']
    def money(cents):
        sign = '-' if cents < 0 else ''
        amount = abs(cents)
        return f'{sign}${amount // 100:,}.{amount % 100:02d}'
    def bound(label, cents):
        indices = [i for i, token in enumerate(tokens) if token.casefold() == label.casefold()]
        assert len(indices) == 1, (label, indices, text)
        actual = tokens[indices[0]+1].replace('$-', '-$')
        assert actual == money(cents), (label, actual, money(cents))
    reportlab = route in ('reportlab', 'fallback')
    bound('Adventure Package Fees', c['grossCents'] if reportlab else c['roomTotalCents'])
    if reportlab and c['discountCents']:
        bound('Promo discount', -c['discountCents'])
        bound('Subtotal after discount', c['roomTotalCents'])
    for label, key in [('Total VAT', 'totalVatCents'), ('Property Fee', 'propertyFeeCents'),
                       ('TOTAL DUE', 'grandTotalCents'), ('Subtotal:', 'roomTotalCents'),
                       ('Accommodation VAT:', 'accommodationVatCents'), ('Services VAT:', 'packageVatCents'),
                       ('Total VAT:', 'totalVatCents')]:
        bound(label, c[key])
    payments = document['payments']
    bound('Remaining Balance:', c['grandTotalCents'] - sum(p['paymentAmountCents'] for p in payments))
    # Every monetary output is accounted for; dates bind payment amounts and order.
    observed = re.findall(r'(?m)^(\d{4}-\d{2}-\d{2})\s*\n\s*([-]?\$-?[\d,]+\.\d{2})\s*$', text)
    assert observed == [(p['datePaid'], money(p['paymentAmountCents'])) for p in payments]
    amounts = [t for t in tokens if re.fullmatch(r'-?\$-?[\d,]+\.\d{2}', t)]
    assert len(amounts) == 9 + len(payments) + (2 if reportlab and c['discountCents'] else 0)
    start = tokens.index('Nights') + 1
    expected_rows = [str(v) for row in document['financial']['lines'] for v in (row['label'], row['roomQuantity'], row['quantity'])]
    assert tokens[start:start+len(expected_rows)] == expected_rows
    after = tokens[start+len(expected_rows)]
    assert after.startswith('Payment Terms:') if reportlab else after in ('DOMINICA VAT SUMMARY', 'Subtotal:')
    assert tokens.count('Room(s)') == tokens.count('Qty') == tokens.count('Nights') == 1
    assert tokens.count(f"Stay: {document['checkIn']} to {document['checkOut']}") == 1
    assert document['invoiceNumber'] in tokens or f"Invoice #: {document['invoiceNumber']}" in tokens
    assert document['guest']['name'] in tokens and document['guest']['email'] in tokens and document['guest']['phone'] in tokens
    if reportlab:
        assert f"Date: {document['issueDate']}" in tokens
    else:
        from datetime import date
        assert date.fromisoformat(document['issueDate']).strftime('%B %d, %Y') in tokens


@pytest.mark.parametrize("route", ["docx", "word", "reportlab", "fallback"])
def test_actual_renderer_parity(root, route, tmp_path, monkeypatch):
    import fitz
    from docx import Document
    from booking_engine import invoice_word, invoice_pdf, invoice_renderer
    inv = converter()(representative(root))
    output = tmp_path / (route + (".docx" if route == "docx" else ".pdf"))
    if route == "docx":
        invoice_word.render_invoice_docx(inv, output)
        doc = Document(output)
        text = "\n".join(p.text for p in doc.paragraphs) + "\n" + "\n".join(cell.text for t in doc.tables for row in t.rows for cell in row.cells)
    else:
        if route == "word":
            # Actual LibreOffice conversion, no selector fallback.
            assert invoice_word.find_libreoffice(), "actual LibreOffice dependency missing"
            invoice_word.render_invoice_word_pdf(inv, output)
        elif route == "reportlab":
            invoice_pdf.render_invoice_pdf(inv, str(output))
        else:
            monkeypatch.setenv("WBE_INVOICE_RENDERER", "word")
            monkeypatch.setenv("WBE_INVOICE_REPORTLAB_FALLBACK", "1")
            def fail(*args):
                raise RuntimeError("forced Word failure")
            monkeypatch.setattr(invoice_renderer, "render_invoice_word_pdf", fail)
            assert invoice_renderer.render_invoice_pdf_for_service(inv, output) == "reportlab-fallback"
        with fitz.open(output) as pdf:
            text = "\n".join(page.get_text() for page in pdf)
    assert_rendered_oracle(text, json.loads(representative(root)['document']), route)
    assert "10%" not in text and "15%" not in text


@pytest.mark.parametrize("cents,accepted", [(4000000000000001, True), (9007199254740991, True), (9007199254740990, False)])
def test_representability_boundary(root, cents, accepted):
    def change(d):
        c = d["financial"]["components"]
        c.update({k: 0 for k in c})
        c.update(grossCents=cents, roomTotalCents=cents, grandTotalCents=cents)
        d["financial"]["lines"][0].update(netCents=cents, grossCents=cents, vatCents=0, unitPriceCents=cents)
    value = modified(root, change)
    if accepted:
        assert converter()(value).total == Decimal(cents)/100
    else:
        with pytest.raises(ValueError):
            converter()(value)


@pytest.mark.parametrize("capacity", ["rows", "payments"])
def test_actual_capacity_fallback_complete(root, capacity, tmp_path, monkeypatch):
    import fitz
    from booking_engine import invoice_word, invoice_renderer
    def change(d):
        if capacity == "rows":
            for i in range(5):
                row = dict(d["financial"]["lines"][0])
                row.update(label=f"Extra row {i}", netCents=0, vatCents=0, grossCents=0)
                d["financial"]["lines"].append(row)
        else:
            d["payments"] = [{"datePaid":f"2026-09-{10+i}", "paymentAmountCents":i+1} for i in range(5)]
    inv = converter()(modified(root, change))
    with pytest.raises(ValueError, match="maximum"):
        invoice_word.render_invoice_docx(inv, tmp_path / "denied.docx")
    monkeypatch.setenv("WBE_INVOICE_RENDERER", "word")
    monkeypatch.setenv("WBE_INVOICE_REPORTLAB_FALLBACK", "1")
    output = tmp_path / "complete.pdf"
    assert invoice_renderer.render_invoice_pdf_for_service(inv, output) == "reportlab-fallback"
    with fitz.open(output) as pdf:
        text = "\n".join(p.get_text() for p in pdf)
    assert_rendered_oracle(text, json.loads(modified(root, change)['document']), 'fallback')


def test_missing_fields_and_root_authority(root):
    for field in root:
        bad = copy.deepcopy(root); del bad[field]
        with pytest.raises(ValueError): converter()(bad)
    for field in ['verified', 'actor', 'role', 'component_cents', 'bcc']:
        bad = copy.deepcopy(root); bad[field] = 'forged'
        with pytest.raises(ValueError): converter()(bad)
    with pytest.raises(ValueError): converter()(None)
    doc = json.loads(root['document'])
    for kind in ['components', 'lines']:
        for field in (doc['financial'][kind][0] if kind == 'lines' else doc['financial'][kind]):
            def change(d):
                target = d['financial'][kind]
                del (target[0] if kind == 'lines' else target)[field]
            with pytest.raises(ValueError): converter()(modified(root, change))
    for field in ['datePaid', 'paymentAmountCents']:
        def change(d):
            p = dict(datePaid='2026-09-07', paymentAmountCents=0); del p[field]; d['payments'] = [p]
        with pytest.raises(ValueError): converter()(modified(root, change))
    for change in [lambda d: d['guest'].update(name='bad\ud800'),
                   lambda d: d['financial']['lines'][0].update(roomQuantity=0),
                   lambda d: d['financial']['lines'][0].update(vatRateBasisPoints=10001)]:
        with pytest.raises(ValueError): converter()(modified(root, change))


def test_every_reconciliation_and_full_discount(root):
    for field in json.loads(root['document'])['financial']['components']:
        with pytest.raises(ValueError):
            converter()(modified(root, lambda d: d['financial']['components'].__setitem__(field, d['financial']['components'][field]+1)))
    for field in ['netCents', 'vatCents', 'grossCents']:
        with pytest.raises(ValueError):
            converter()(modified(root, lambda d: d['financial']['lines'][0].__setitem__(field, d['financial']['lines'][0][field]+1)))
    def full(d):
        c=d['financial']['components']; c.update({k:0 for k in c}); c.update(grossCents=10000, discountCents=10000)
        d['financial']['lines'][0].update(netCents=0, vatCents=0, grossCents=0)
        d['payments']=[dict(datePaid='2026-09-07', paymentAmountCents=1)]
    inv=converter()(modified(root, full))
    assert inv.total == 0 and inv.promo_discount_amount == Decimal(100)
    assert inv.total-sum(p['paymentAmount'] for p in inv.payments) == Decimal('-0.01')


def test_semicolonless_entity_preflight_real_pdf(root, tmp_path):
    import fitz
    from booking_engine import invoice_pdf, invoice_word
    from docx import Document
    for index, (label, rendered) in enumerate([
            ('Literal A &amp B', 'Literal A & B'),
            ('Literal A &#65 B', 'Literal A A B'),
            ('Literal A &#x41 B', 'Literal A A B')]):
        value = modified(root, lambda d: d['financial']['lines'][0].update(label=label))
        # Reproduce the unchanged real renderer interpretation independently of preflight.
        inv = converter()(root)
        inv.lines[0].label = label
        output = tmp_path / f'entity-{index}.pdf'
        invoice_pdf.render_invoice_pdf(inv, str(output))
        with fitz.open(output) as pdf:
            text = '\n'.join(p.get_text() for p in pdf)
        assert label not in text and rendered in text
        with pytest.raises(ValueError):
            converter()(value)
    label = 'Literal A & B'
    value = modified(root, lambda d: d['financial']['lines'][0].update(label=label))
    before = canonical(value)
    inv = converter()(value)
    assert canonical(value) == before and inv.lines[0].label == label
    output = tmp_path / 'literal.pdf'
    invoice_pdf.render_invoice_pdf(inv, str(output))
    with fitz.open(output) as pdf:
        assert label in '\n'.join(p.get_text() for p in pdf)
    output = tmp_path / 'literal.docx'
    invoice_word.render_invoice_docx(inv, output)
    assert label in '\n'.join(c.text for t in Document(output).tables for r in t.rows for c in r.cells)


def test_actual_admin_root_maps_exact_invoice(root):
    inv = converter()(root)
    assert inv.total == Decimal("115.00") and type(inv.total) is Decimal
    assert inv.invoice_number == "TEST-OWNER-1"
    assert inv.issue_date.isoformat() == "2026-09-07"
    assert inv.guest.email == root["to"]
    assert inv.explicit_vat_amounts() == (Decimal(10), Decimal(0))
    assert inv.lines[0].label == "Fixture room"
    assert inv.lines[0].quantity == inv.lines[0].room_quantity == 1
    assert inv.lines[0].unit_price == Decimal(100)
    assert inv.check_in == "2026-10-01" and inv.check_out == "2026-10-02"
    assert inv.payments == [] and inv.booking_number == ""
    assert inv.total_guests == 0
    assert not any((inv.package_title, inv.included_amenities, inv.promo_code, inv.notes))
    assert inv.property_fee_rate == inv.promo_discount_rate == Decimal(0)
    assert (inv.guest.name, inv.guest.phone) == ('Fixture Guest', '1234567890')
    supplied = modified(representative(root), lambda d: d.update(bookingNumber='BOOK-EXACT-7'))
    mapped = converter()(supplied)
    assert mapped.booking_number == 'BOOK-EXACT-7'
    source = json.loads(supplied['document'])['financial']['lines']
    assert len(mapped.lines) == len(source)
    for actual, expected in zip(mapped.lines, source):
        assert (actual.label, actual.tax_class, actual.quantity, actual.room_quantity,
                actual.unit_price, actual.net, actual.vat, actual.gross, actual.vat_rate) == (
            expected['label'], expected['taxClass'], expected['quantity'], expected['roomQuantity'],
            Decimal(expected['unitPriceCents'])/100, Decimal(expected['netCents'])/100,
            Decimal(expected['vatCents'])/100, Decimal(expected['grossCents'])/100,
            Decimal(expected['vatRateBasisPoints'])/10000)


@pytest.mark.parametrize('field', ['netCents', 'vatCents'])
def test_accumulated_line_bounds(root, field):
    maximum = 2**53 - 1
    def change(d):
        line = dict(d['financial']['lines'][0])
        line.update(netCents=0, vatCents=0, unitPriceCents=0)
        line[field] = maximum
        line['grossCents'] = maximum
        d['financial']['lines'] = [line, dict(line)]
    value = modified(root, change)
    lines = json.loads(value['document'])['financial']['lines']
    for line in lines:
        assert line['grossCents'] == line['netCents'] + line['vatCents']
        assert all(type(line[k]) is int and 0 <= line[k] <= maximum for k in
                   ['quantity', 'roomQuantity', 'unitPriceCents', 'netCents', 'vatCents', 'grossCents', 'vatRateBasisPoints'])
    assert sum(line[field] for line in lines) > maximum
    with pytest.raises(ValueError) as caught:
        converter()(value)
    # Converter reached the accumulation guard, not fixture construction or later reconciliation.
    import traceback
    assert any(frame.name == '_integer' for frame in traceback.extract_tb(caught.value.__traceback__))
