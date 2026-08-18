"""Production invoice renderer selection and rollback support."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from booking_engine.invoice_pdf import render_invoice_pdf as render_invoice_reportlab_pdf
from booking_engine.invoice_word import render_invoice_word_pdf


def _enabled(value: str) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def render_invoice_pdf_for_service(inv: Any, out_path: str | Path) -> str:
    """Render an invoice PDF and return the renderer actually used.

    Word is the production default. ReportLab remains available as an explicit
    rollback and as a logged emergency fallback during the transition.
    """
    renderer = os.environ.get("WBE_INVOICE_RENDERER", "word").strip().lower()
    if renderer == "reportlab":
        render_invoice_reportlab_pdf(inv, str(out_path))
        return "reportlab"
    if renderer != "word":
        raise ValueError(f"Unsupported WBE_INVOICE_RENDERER: {renderer}")

    try:
        render_invoice_word_pdf(inv, out_path)
        return "word"
    except Exception:
        if not _enabled(os.environ.get("WBE_INVOICE_REPORTLAB_FALLBACK", "1")):
            raise
        print("[WBE-INVOICE] Word renderer failed; using ReportLab fallback", flush=True)
        render_invoice_reportlab_pdf(inv, str(out_path))
        return "reportlab-fallback"
