"""Tests for selecting the production invoice renderer safely."""

from pathlib import Path
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from booking_engine import invoice_renderer


def test_word_renderer_is_default(monkeypatch, tmp_path):
    calls = []
    monkeypatch.delenv("WBE_INVOICE_RENDERER", raising=False)
    monkeypatch.setattr(invoice_renderer, "render_invoice_word_pdf", lambda inv, out: calls.append("word"))
    monkeypatch.setattr(invoice_renderer, "render_invoice_reportlab_pdf", lambda inv, out: calls.append("reportlab"))
    used = invoice_renderer.render_invoice_pdf_for_service(object(), tmp_path / "invoice.pdf")
    assert used == "word"
    assert calls == ["word"]


def test_reportlab_can_be_selected_for_rollback(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("WBE_INVOICE_RENDERER", "reportlab")
    monkeypatch.setattr(invoice_renderer, "render_invoice_word_pdf", lambda inv, out: calls.append("word"))
    monkeypatch.setattr(invoice_renderer, "render_invoice_reportlab_pdf", lambda inv, out: calls.append("reportlab"))
    used = invoice_renderer.render_invoice_pdf_for_service(object(), tmp_path / "invoice.pdf")
    assert used == "reportlab"
    assert calls == ["reportlab"]


def test_word_failure_falls_back_when_enabled(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setenv("WBE_INVOICE_RENDERER", "word")
    monkeypatch.setenv("WBE_INVOICE_REPORTLAB_FALLBACK", "1")

    def fail_word(inv, out):
        calls.append("word")
        raise RuntimeError("conversion failed")

    monkeypatch.setattr(invoice_renderer, "render_invoice_word_pdf", fail_word)
    monkeypatch.setattr(invoice_renderer, "render_invoice_reportlab_pdf", lambda inv, out: calls.append("reportlab"))
    used = invoice_renderer.render_invoice_pdf_for_service(object(), tmp_path / "invoice.pdf")
    assert used == "reportlab-fallback"
    assert calls == ["word", "reportlab"]


def test_word_failure_raises_when_fallback_disabled(monkeypatch, tmp_path):
    monkeypatch.setenv("WBE_INVOICE_RENDERER", "word")
    monkeypatch.setenv("WBE_INVOICE_REPORTLAB_FALLBACK", "0")
    monkeypatch.setattr(
        invoice_renderer,
        "render_invoice_word_pdf",
        lambda inv, out: (_ for _ in ()).throw(RuntimeError("conversion failed")),
    )
    with pytest.raises(RuntimeError, match="conversion failed"):
        invoice_renderer.render_invoice_pdf_for_service(object(), tmp_path / "invoice.pdf")
