"""Pure disconnected owner-document integrity conversion, NOT authentication.

Only a future trusted journal reader may establish provenance. No incoming
production consumer is authorized until independent N3 byte/parity review.
"""
import hashlib
import json
import re
from datetime import date
from decimal import Decimal

from .invoice import Guest, Invoice

MAX = 2**53 - 1
HOTEL = "info@wanderlustcaribbean.com"
COMPONENTS = {"grossCents", "discountCents", "roomTotalCents", "propertyFeeCents",
              "accommodationVatCents", "packageVatCents", "totalVatCents", "grandTotalCents"}
UUID = r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"
META = {"_createdDate", "_updatedDate", "_owner"}


def _deny(*_):
    raise ValueError("Invalid or unsupported owner invoice document")


def _shape(value, required, optional=()):
    if type(value) is not dict or not set(required) <= value.keys() or value.keys() - set(required) - set(optional):
        _deny()


def _integer(value):
    if type(value) is not int or not 0 <= value <= MAX:
        _deny()
    return value


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            _deny()
        result[key] = value
    return result


def _parse(raw):
    def integer(token):
        if token == "-0":
            _deny()
        return _integer(int(token))
    try:
        return json.loads(raw, object_pairs_hook=_pairs, parse_int=integer,
                          parse_float=_deny, parse_constant=_deny)
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Invalid owner JSON") from exc


def _canonical(value):
    try:
        return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise ValueError("Invalid owner canonical JSON") from exc


def _hash(raw):
    try:
        return hashlib.sha256(raw.encode("utf-8", errors="strict")).hexdigest()
    except UnicodeError as exc:
        raise ValueError("Invalid owner Unicode") from exc


def _text(value, limit=256, display=False):
    if type(value) is not str or not value.strip() or re.search(r"[\x00-\x1f\x7f\ud800-\udfff]", value):
        _deny()
    if len(value.encode("utf-16-le")) // 2 > limit:
        _deny()
    # ReportLab Paragraph interprets tags/entities, unlike Word autoescaping.
    if display and ("<" in value or re.search(r"&(?:#\w+|[A-Za-z][A-Za-z0-9]*)", value)):
        _deny()


def _day(value):
    if type(value) is not str or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        _deny()
    parsed = date.fromisoformat(value)
    if parsed.isoformat() != value:
        _deny()
    return parsed


def invoice_from_owner_issuance(root):
    """Validate immutable application bytes and return a fresh exact Invoice.

    Accept a journal root dict or strict raw JSON. Matching a digest establishes
    integrity only; this function never authenticates external caller JSON.
    """
    if type(root) in (str, bytes):
        root = _parse(root)
    fields = {"_id", "kind", "actorId", "document", "documentDigest", "purpose", "to", "cc", "from"}
    _shape(root, fields, META)
    _text(root["actorId"])
    if root["kind"] != "ISSUANCE" or type(root["document"]) is not str:
        _deny()
    raw = root["document"]
    if _hash(raw) != root["documentDigest"]:
        _deny()
    d = _parse(raw)
    _shape(d, {"schema", "invoiceNumber", "revision", "issueDate", "guest", "checkIn", "checkOut", "roomCode", "purpose", "payments", "financial"},
           {"bookingNumber", "parentIssuanceId", "reissueReason"})
    if d["schema"] != "owner-invoice-document/v1" or _canonical(d) != raw:
        _deny()
    if len(raw.encode()) > 160000 or len(_canonical({k: root[k] for k in fields}).encode()) > 160000:
        _deny()
    _text(d["invoiceNumber"], 100)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", d["invoiceNumber"]) or type(d["revision"]) is not str or not re.fullmatch(UUID, d["revision"]):
        _deny()
    if root["_id"] != _hash(_canonical(["owner-invoice-revision/v1", d["invoiceNumber"], d["revision"]])):
        _deny()
    issued = _day(d["issueDate"])
    if _day(d["checkOut"]) <= _day(d["checkIn"]):
        _deny()
    _text(d["roomCode"], 2000)
    _shape(d["guest"], {"name", "email", "phone"})
    for key, value in d["guest"].items():
        _text(value, 254 if key == "email" else 256, display=True)
    if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}", d["guest"]["email"]):
        _deny()
    if len(re.sub(r"[^0-9]", "", d["guest"]["phone"])) < 7:
        _deny()
    if d["purpose"] not in ("guest_invoice", "owner_copy"):
        _deny()
    owner = d["purpose"] == "owner_copy"
    if (root["purpose"], root["to"], root["cc"], root["from"]) != (d["purpose"], HOTEL if owner else d["guest"]["email"], "" if owner else HOTEL, HOTEL):
        _deny()
    if "bookingNumber" in d:
        _text(d["bookingNumber"], 100, display=True)
    if "parentIssuanceId" in d or "reissueReason" in d:
        if type(d.get("parentIssuanceId")) is not str or not re.fullmatch(r"[a-f0-9]{64}", d["parentIssuanceId"]) or d["parentIssuanceId"] == root["_id"]:
            _deny()
        _text(d.get("reissueReason"), 2000)
    f = d["financial"]
    _shape(f, {"currency", "components", "lines"})
    if f["currency"] != "USD":
        _deny()
    c = f["components"]
    _shape(c, COMPONENTS)
    for value in c.values():
        _integer(value)
    if c["grossCents"] != c["discountCents"] + c["roomTotalCents"] or c["totalVatCents"] != c["accommodationVatCents"] + c["packageVatCents"] or c["grandTotalCents"] != c["roomTotalCents"] + c["propertyFeeCents"] + c["totalVatCents"]:
        _deny()
    if type(f["lines"]) is not list or not 1 <= len(f["lines"]) <= 1000:
        _deny()
    money = lambda n: Decimal(n) / Decimal(100)
    lines, net, vat = [], 0, {"accommodation": 0, "standard": 0}
    numeric = {"quantity", "roomQuantity", "unitPriceCents", "netCents", "vatCents", "grossCents", "vatRateBasisPoints"}
    for line in f["lines"]:
        _shape(line, numeric | {"label", "taxClass"})
        _text(line["label"], 2000, display=True)
        for key in numeric:
            _integer(line[key])
        if line["taxClass"] not in vat or not line["quantity"] or not line["roomQuantity"] or line["vatRateBasisPoints"] > 10000 or line["grossCents"] != line["netCents"] + line["vatCents"]:
            _deny()
        for key in ("quantity", "roomQuantity"):
            if Decimal(format(line[key], "g")) != line[key] or Decimal(format(float(line[key]), "g")) != line[key]:
                _deny()
        net = _integer(net + line["netCents"])
        vat[line["taxClass"]] = _integer(vat[line["taxClass"]] + line["vatCents"])
        lines.append(dict(label=line["label"], tax_class=line["taxClass"], quantity=line["quantity"], room_quantity=line["roomQuantity"],
                          unit_price=money(line["unitPriceCents"]), net=money(line["netCents"]), vat=money(line["vatCents"]), gross=money(line["grossCents"]), vat_rate=Decimal(line["vatRateBasisPoints"])/10000))
    if (net, vat["accommodation"], vat["standard"]) != (c["roomTotalCents"], c["accommodationVatCents"], c["packageVatCents"]):
        _deny()
    if type(d["payments"]) is not list or len(d["payments"]) > 1000:
        _deny()
    payments, paid = [], 0
    for p in d["payments"]:
        _shape(p, {"datePaid", "paymentAmountCents"})
        _day(p["datePaid"])
        paid = _integer(paid + _integer(p["paymentAmountCents"]))
        payments.append(dict(datePaid=p["datePaid"], paymentAmount=money(p["paymentAmountCents"])))
    quote = dict(currency="USD", subtotal_net=money(c["roomTotalCents"]), property_fee=money(c["propertyFeeCents"]),
                 total_vat=money(c["totalVatCents"]), total=money(c["grandTotalCents"]), promo_discount_amount=money(c["discountCents"]),
                 vat_by_class={"accommodation":money(c["accommodationVatCents"]), "standard":money(c["packageVatCents"])},
                 line_items=lines, payments=payments, booking_number=d.get("bookingNumber", ""), check_in=d["checkIn"], check_out=d["checkOut"],
                 package_title="", included_amenities="", promo_code="", notes="", total_guests=0, property_fee_rate=Decimal(0), promo_discount_rate=Decimal(0))
    invoice = Invoice.from_quote(d["invoiceNumber"], issued, Guest(**d["guest"]), quote, component_cents=dict(c))
    invoice.explicit_vat_amounts()
    return invoice
