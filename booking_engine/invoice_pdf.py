"""
Wanderlust Booking Engine — PDF invoice generator (reportlab).

Renders an Invoice (from invoice.py) to a professional PDF:
  - Logo (if a logo image path/URL is configured; otherwise a text placeholder)
  - Business identity + Tax ID
  - Invoice number + date
  - Bill-to (guest name, email, phone)
  - Package info (check-in, check-out, package title, included amenities)
  - Itemized line table: description, qty, net, gross
  - VAT summary by class (10% accommodation / 15% standard)
  - Total VAT and grand total

Usage:
  from booking_engine.invoice_pdf import render_invoice_pdf
  render_invoice_pdf(invoice, "/path/out.pdf")
"""

import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image,
)

BRAND_TEAL = colors.HexColor("#0b6b6b")
LIGHT = colors.HexColor("#f0f6f6")


def _money(x, currency="USD"):
    return f"${x:,.2f}"


def _dominica_vat_summary_elems(inv, h_biz, bold):
    """Build left-justified Dominica VAT summary elements for placement at the bottom."""
    subtotal = inv.subtotal_net
    acc_amt = subtotal * inv.accommodation_allocation
    svc_amt = subtotal * inv.services_allocation
    acc_vat = acc_amt * 0.10
    svc_vat = svc_amt * 0.15

    vat_table = Table([
        ["Subtotal:", _money(subtotal)],
        ["Accommodation VAT:", f"{_money(acc_amt)} * 10% = {_money(acc_vat)}"],
        ["Services VAT:", f"{_money(svc_amt)} * 15% = {_money(svc_vat)}"],
        ["Total VAT:", _money(inv.total_vat)],
    ], colWidths=[42 * mm, 57 * mm], hAlign="LEFT")
    vat_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND_TEAL),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, -1), (-1, -1), BRAND_TEAL),
    ]))
    return [
        Paragraph("Dominica VAT Summary:", bold),
        Spacer(1, 1.5 * mm),
        vat_table,
    ]


def render_invoice_pdf(inv, out_path: str) -> str:
    styles = getSampleStyleSheet()
    h_biz = ParagraphStyle("biz", parent=styles["Normal"], fontSize=9, leading=12, alignment=0)
    p_left = ParagraphStyle("left-para", parent=styles["Normal"], fontSize=10,
                            leading=13, alignment=0)
    h_title = ParagraphStyle("title", parent=styles["Title"], fontSize=22,
                             textColor=BRAND_TEAL, alignment=0)  # left
    h_guest = ParagraphStyle("guest", parent=styles["Normal"], fontSize=16,
                             leading=20, fontName="Helvetica-Bold",
                             textColor=BRAND_TEAL)
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8,
                           textColor=colors.grey)
    bold = ParagraphStyle("bold", parent=styles["Normal"], fontSize=9,
                          leading=12, fontName="Helvetica-Bold")

    doc = SimpleDocTemplate(out_path, pagesize=letter,
                            topMargin=2 * mm, bottomMargin=18 * mm,
                            leftMargin=18 * mm, rightMargin=18 * mm)
    biz = inv.business
    elems = []

    # ---- Business block + invoice meta ----
    biz_html = (
        f"<b>{biz['legal_name']}</b><br/>"
        + "<br/>".join(biz["address_lines"])
        + f"<br/>{biz['phone']}<br/>{biz['email']}<br/>{biz['website']}"
        + f"<br/><b>Tax ID:</b> {biz['tax_id']}"
    )

    # ---- Header: logo (left) + INVOICE title (right) ----
    logo_cell = None
    logo_path = biz.get("logo_path") or ""
    if logo_path and os.path.exists(logo_path):
        try:
            from reportlab.lib.utils import ImageReader
            iw, ih = ImageReader(logo_path).getSize()
            target_w = 70 * mm
            target_h = target_w * (ih / iw)
            max_h = 30 * mm
            if target_h > max_h:
                target_h = max_h
                target_w = target_h * (iw / ih)
            logo_cell = Image(logo_path, width=target_w, height=target_h)
        except Exception:
            logo_cell = Paragraph("<b>Wanderlust Caribbean</b>", h_biz)
    else:
        logo_cell = Paragraph(
            "<b>WANDERLUST CARIBBEAN</b><br/>"
            "<font size=7 color='#888'>[logo image not yet configured]</font>",
            h_biz,
        )

    # ---- Header: logo + INVOICE title (left), address/invoice#/BILL TO (right) ----
    # Use the full available width. Left column = logo width; right column consumes the rest
    # so the address/BILL TO stack sits flush against the right margin while remaining
    # left-justified internally.
    available_w = letter[0] - doc.leftMargin - doc.rightMargin  # points
    left_col_w = 120 * mm
    right_col_w = available_w - left_col_w

    bill_to_html = (
        f"<b>BILL TO</b><br/>{inv.guest.name}<br/>"
        f"{inv.guest.email}<br/>{inv.guest.phone}"
    )
    right_block = Table([
        [Paragraph(biz_html, h_biz)],
        [Paragraph(" ", h_biz)],
        [Paragraph(bill_to_html, h_biz)],
    ], colWidths=[right_col_w])
    right_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    meta_html = (
        f"<b>Invoice #:</b> {inv.invoice_number}<br/>"
        f"<b>Date:</b> {inv.issue_date.isoformat()}<br/>"
        f"<b>Currency:</b> {inv.currency}"
    )
    left_block = Table([
        [logo_cell],
        [Paragraph("INVOICE", h_title)],
        [Paragraph(inv.guest.name, h_guest)],
        [Paragraph(meta_html, h_biz)],
    ], colWidths=[left_col_w])
    left_block.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))

    header_table = Table([[left_block, right_block]], colWidths=[left_col_w, right_col_w])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(header_table)
    elems.append(Spacer(1, 8 * mm))

    # ---- Package info ----
    if inv.package_title or inv.included_amenities or inv.check_in or inv.check_out:
        elems.append(Spacer(1, 2 * mm))
        elems.append(Paragraph("PACKAGE INFORMATION", bold))
        # Stay and Package on separate lines, left-justified.
        if inv.check_in and inv.check_out:
            elems.append(Paragraph(f"<b>Stay:</b> {inv.check_in} to {inv.check_out}", p_left))
        if inv.package_title:
            elems.append(Paragraph(f"<b>Package:</b> {inv.package_title}", p_left))
        elems.append(Spacer(1, 3 * mm))

    # ---- Line items table ----
    head = ["Room(s)", "Qty", "Nights", "Package Total"]
    rows = [head]
    for li in inv.lines:
        rows.append([
            Paragraph(li.label, h_biz),
            f"{li.room_quantity:g}",
            f"{li.quantity:g}",
            _money(li.gross),
        ])
    col_w = [90 * mm, 15 * mm, 20 * mm, 55 * mm]
    tbl = Table(rows, colWidths=col_w, repeatRows=1)
    tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), BRAND_TEAL),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cccccc")),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]))
    elems.append(tbl)
    elems.append(Spacer(1, 3 * mm))

    # ---- Financial summary (right-aligned, directly under the table) ----
    tot_rows = [["Subtotal (net)", _money(inv.subtotal_net + inv.promo_discount_amount)]]
    if inv.promo_discount_amount > 0 and inv.promo_code:
        pct = int(round(inv.promo_discount_rate * 100))
        tot_rows.append([f"Promo Code — {pct}% off", "-" + _money(inv.promo_discount_amount)])
        tot_rows.append(["Subtotal after discount", _money(inv.subtotal_net)])
    tot_rows.append(["Total VAT", _money(inv.total_vat)])
    if inv.property_fee:
        fee_pct = int(round(inv.property_fee_rate * 100))
        tot_rows.append([f"Property fee ({fee_pct}%)", _money(inv.property_fee)])
    tot_rows.append(["TOTAL DUE", _money(inv.total)])

    totals = Table(tot_rows, colWidths=[125 * mm, 55 * mm])
    totals.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("RIGHTPADDING", (1, 0), (1, -1), 6),
        ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND_TEAL),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, -1), (-1, -1), BRAND_TEAL),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]))
    elems.append(totals)
    elems.append(Spacer(1, 8 * mm))

    # Dominica VAT summary is rendered at the bottom of the invoice.


    terms = ParagraphStyle("terms", parent=styles["Normal"], fontSize=9,
                           leading=13, textColor=colors.HexColor("#333333"),
                           alignment=0)  # left aligned
    elems.append(Paragraph(
        "<b>Payment Terms:</b> A 50% deposit is processed upon booking and the "
        "remaining balance will be processed 30 days prior to arrival. You will "
        "receive a payment link by email for the deposit payment within a few days.",
        terms))
    elems.append(Spacer(1, 5 * mm))

    # Package Details block removed; included amenities are shown in Package Information.

    terms_text = (
        "<b>Charge will show on your credit card as Caribbean Appalachia, Ltd.</b><br/><br/>"
        "<b>Cancellation Policy:</b> A full refund (minus credit card fees) will be provided for guest cancellations requested 31 days or more before scheduled arrival. Reservation cancellations within 30 days of arrival do not qualify for a refund.<br/><br/>"
        "<b>Private Group Bookings:</b> Cancellations made within 90 days of the scheduled arrival date are not eligible for a refund.<br/><br/>"
        "Guests can re-schedule their vacation with the full reservation deposit applied to the new reservation. The re-scheduled vacation must occur within two (2) years of the initial arrival day and can be booked for any available dates except December 15th - January 7th when special rates apply."
    )
    elems.append(Paragraph(terms_text, terms))
    elems.append(Spacer(1, 5 * mm))

    elems.append(Spacer(1, 4 * mm))
    elems.extend(_dominica_vat_summary_elems(inv, h_biz, bold))
    elems.append(Spacer(1, 5 * mm))

    elems.append(Paragraph(
        inv.notes or "Thank you for booking with Wanderlust Caribbean. "
        "Come as guests, leave as friends.", small))

    doc.build(elems)
    return out_path
