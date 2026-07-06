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


def render_invoice_pdf(inv, out_path: str) -> str:
    styles = getSampleStyleSheet()
    h_biz = ParagraphStyle("biz", parent=styles["Normal"], fontSize=9, leading=12)
    h_title = ParagraphStyle("title", parent=styles["Title"], fontSize=22,
                             textColor=BRAND_TEAL, alignment=2)  # right
    small = ParagraphStyle("small", parent=styles["Normal"], fontSize=8,
                           textColor=colors.grey)
    bold = ParagraphStyle("bold", parent=styles["Normal"], fontSize=9,
                          leading=12, fontName="Helvetica-Bold")

    doc = SimpleDocTemplate(out_path, pagesize=letter,
                            topMargin=18 * mm, bottomMargin=18 * mm,
                            leftMargin=18 * mm, rightMargin=18 * mm)
    biz = inv.business
    elems = []

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

    header = Table(
        [[logo_cell, Paragraph("INVOICE", h_title)]],
        colWidths=[95 * mm, 75 * mm],
    )
    header.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(header)
    elems.append(Spacer(1, 6 * mm))

    # ---- Business block + invoice meta ----
    biz_html = (
        f"<b>{biz['legal_name']}</b><br/>"
        + "<br/>".join(biz["address_lines"])
        + f"<br/>{biz['phone']}<br/>{biz['email']}<br/>{biz['website']}"
        + f"<br/><b>Tax ID:</b> {biz['tax_id']}"
    )
    meta_html = (
        f"<b>Invoice #:</b> {inv.invoice_number}<br/>"
        f"<b>Date:</b> {inv.issue_date.isoformat()}<br/>"
        f"<b>Currency:</b> {inv.currency}"
    )
    info = Table([[Paragraph(biz_html, h_biz), Paragraph(meta_html, h_biz)]],
                 colWidths=[110 * mm, 60 * mm])
    info.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    elems.append(info)
    elems.append(Spacer(1, 5 * mm))

    # ---- Bill to ----
    g = inv.guest
    elems.append(Paragraph("BILL TO", bold))
    elems.append(Paragraph(
        f"{g.name}<br/>{g.email}<br/>{g.phone}", h_biz))
    elems.append(Spacer(1, 5 * mm))

    # ---- Package info ----
    if inv.package_title or inv.included_amenities or inv.check_in or inv.check_out:
        elems.append(Paragraph("PACKAGE INFORMATION", bold))
        # Stay and Package on the same line
        stay_text = ""
        if inv.check_in and inv.check_out:
            stay_text = f"<b>Stay:</b> {inv.check_in} to {inv.check_out}"
        package_text = ""
        if inv.package_title:
            package_text = f"<b>Package:</b> {inv.package_title}"
        if stay_text and package_text:
            pkg_row = Table(
                [[Paragraph(stay_text, h_biz), Paragraph(package_text, h_biz)]],
                colWidths=[90 * mm, 85 * mm]
            )
            pkg_row.setStyle(TableStyle([( "VALIGN", (0, 0), (-1, -1), "TOP" ),
                                          ( "LEFTPADDING", (0, 0), (-1, -1), 0 ),
                                          ( "RIGHTPADDING", (0, 0), (-1, -1), 0 ),]))
            elems.append(pkg_row)
        elif stay_text:
            elems.append(Paragraph(stay_text, h_biz))
        elif package_text:
            elems.append(Paragraph(package_text, h_biz))
        # Blank line before Included
        if inv.included_amenities:
            elems.append(Spacer(1, 4 * mm))
            elems.append(Paragraph("<b>Package Details:</b>", h_biz))
            elems.append(Paragraph(inv.included_amenities, h_biz))
        elems.append(Spacer(1, 5 * mm))

    # ---- Line items table ----
    head = ["Description", "Nights", "Net", "Total"]
    rows = [head]
    for li in inv.lines:
        rows.append([
            Paragraph(li.label, h_biz),
            f"{li.quantity:g}",
            _money(li.net),
            _money(li.gross),
        ])
    col_w = [95 * mm, 20 * mm, 30 * mm, 30 * mm]
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
    elems.append(Spacer(1, 5 * mm))

    # ---- VAT summary (left) + Totals block (right) ----
    subtotal = inv.subtotal_net
    acc_amt = subtotal * inv.accommodation_allocation
    svc_amt = subtotal * inv.services_allocation
    acc_vat = acc_amt * 0.10
    svc_vat = svc_amt * 0.15

    vat_rows = [
        ["Subtotal:", _money(subtotal)],
        ["Accommodation VAT:", f"{_money(acc_amt)} * 10% = {_money(acc_vat)}"],
        ["Services VAT:", f"{_money(svc_amt)} * 15% = {_money(svc_vat)}"],
        ["Total VAT:", _money(inv.total_vat)],
    ]
    vat_table = Table(vat_rows, colWidths=[42 * mm, 57 * mm])
    vat_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 2),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2),
        ("LEFTPADDING", (0, 0), (0, -1), 4),
        ("RIGHTPADDING", (1, 0), (1, -1), 4),
        ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND_TEAL),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, -1), (-1, -1), BRAND_TEAL),
        ("BOX", (0, 0), (-1, -1), 1, colors.HexColor("#cccccc")),
    ]))

    # Label above the boxed VAT data.
    elems.append(Paragraph("Dominica VAT Summary:", bold))
    elems.append(Spacer(1, 1.5 * mm))

    left_inner = Table([[vat_table]], colWidths=[110 * mm])
    left_inner.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))

    tot_rows = [["Subtotal (net)", _money(inv.subtotal_net)]]
    label_map = {"accommodation": "VAT 10% (Accommodation)",
                 "standard": "VAT 15% (Services)"}
    for cls, amt in inv.vat_by_class.items():
        tot_rows.append([label_map.get(cls, f"VAT ({cls})"), _money(amt)])
    tot_rows.append(["Total VAT", _money(inv.total_vat)])
    if inv.property_fee:
        fee_pct = int(round(inv.property_fee_rate * 100))
        tot_rows.append([f"Property fee ({fee_pct}%)", _money(inv.property_fee)])
    tot_rows.append(["TOTAL DUE", _money(inv.total)])

    totals = Table(tot_rows, colWidths=[50 * mm, 30 * mm], hAlign="RIGHT")
    totals.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
        ("LINEABOVE", (0, -1), (-1, -1), 1, BRAND_TEAL),
        ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, -1), (-1, -1), BRAND_TEAL),
        ("TOPPADDING", (0, 0), (-1, -1), 3),
    ]))

    parent = Table([[left_inner, totals]], colWidths=[110 * mm, 70 * mm])
    parent.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    elems.append(parent)
    elems.append(Spacer(1, 8 * mm))

    terms = ParagraphStyle("terms", parent=styles["Normal"], fontSize=9,
                           leading=13, textColor=colors.HexColor("#333333"),
                           alignment=0)  # left aligned
    elems.append(Paragraph(
        "<b>Payment Terms:</b> A 50% deposit is processed upon booking and the "
        "remaining balance will be processed 30 days prior to arrival. You will "
        "receive a payment link by email for the deposit payment within a few days.",
        terms))
    elems.append(Spacer(1, 5 * mm))

    elems.append(Paragraph(
        inv.notes or "Thank you for booking with Wanderlust Caribbean. "
        "Come as guests, leave as friends.", small))

    doc.build(elems)
    return out_path
