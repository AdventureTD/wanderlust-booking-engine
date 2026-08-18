FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    LIBREOFFICE_PATH=/usr/bin/soffice

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       libreoffice-writer \
       fonts-liberation \
       fonts-dejavu-core \
       fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements-deploy.txt .
RUN pip install --no-cache-dir -r requirements-deploy.txt

COPY . .

RUN chmod +x /app/start.sh \
    && python -m py_compile invoice_service.py booking_engine/invoice_word.py booking_engine/invoice_renderer.py \
    && test -f /app/invoice_template.docx \
    && soffice --version

CMD ["bash", "/app/start.sh"]