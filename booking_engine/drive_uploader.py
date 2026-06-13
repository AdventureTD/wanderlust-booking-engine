"""
Wanderlust Booking Engine — Google Drive PDF uploader.

Uses a Google Cloud Service Account (not OAuth) to upload invoice PDFs
to a shared Drive folder. Returns a webViewLink URL that can be stored
in the Wix Bookings collection as invoiceUrl.

Setup:
  1. Create a Service Account in Google Cloud Console
  2. Download its JSON key
  3. Share the target Drive folder with the service account email
  4. Base64-encode the JSON key and store as GOOGLE_SERVICE_ACCOUNT_B64 in Render

Usage:
  from booking_engine.drive_uploader import upload_invoice_pdf
  url = upload_invoice_pdf(pdf_path, invoice_number)
"""

import os
import json
import base64
import tempfile
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

# Folder ID from the user's Drive folder (set via env var)
DRIVE_FOLDER_ID = os.environ.get("WBE_INVOICE_FOLDER_ID", "")

# Service account key (JSON) decoded from base64 env var
SERVICE_ACCOUNT_B64 = os.environ.get("GOOGLE_SERVICE_ACCOUNT_B64", "")

_SCOPES = ["https://www.googleapis.com/auth/drive"]


def _decode_service_account() -> dict:
    """Decode the base64-encoded service account JSON from env."""
    if not SERVICE_ACCOUNT_B64:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_B64 is not set. "
            "Create a Service Account in Google Cloud Console, download its JSON key, "
            "base64-encode it, and add it to Render Environment Variables."
        )
    try:
        json_bytes = base64.b64decode(SERVICE_ACCOUNT_B64)
        return json.loads(json_bytes.decode("utf-8"))
    except Exception as e:
        raise RuntimeError(f"Failed to decode GOOGLE_SERVICE_ACCOUNT_B64: {e}")


def _get_drive_service():
    """Build an authorized Drive API client from the service account."""
    sa_info = _decode_service_account()
    credentials = service_account.Credentials.from_service_account_info(
        sa_info, scopes=_SCOPES
    )
    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def upload_invoice_pdf(pdf_path: str, invoice_number: str) -> str:
    """
    Upload a PDF invoice to the configured Google Drive folder.
    Returns the webViewLink (public-ish shareable URL).
    """
    if not DRIVE_FOLDER_ID:
        raise RuntimeError(
            "WBE_INVOICE_FOLDER_ID is not set. Paste the Google Drive folder ID "
            "(from the URL: drive.google.com/drive/folders/<ID>) into Render Environment Variables."
        )

    if not os.path.exists(pdf_path):
        raise FileNotFoundError(f"PDF not found at {pdf_path}")

    service = _get_drive_service()

    file_metadata = {
        "name": f"{invoice_number}.pdf",
        "parents": [DRIVE_FOLDER_ID],
        "mimeType": "application/pdf",
    }

    media = MediaFileUpload(pdf_path, mimetype="application/pdf", resumable=True)

    file = service.files().create(
        body=file_metadata,
        media_body=media,
        fields="id, name, webViewLink, webContentLink"
    ).execute()

    # Make it viewable by anyone with the link (hotel staff + guest)
    service.permissions().create(
        fileId=file["id"],
        body={"role": "reader", "type": "anyone"},
        fields="id"
    ).execute()

    # Refresh to get the public webViewLink after permission change
    file = service.files().get(
        fileId=file["id"],
        fields="webViewLink, webContentLink"
    ).execute()

    return file.get("webViewLink", "")
