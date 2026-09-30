FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.lock .
RUN pip install --no-cache-dir --require-hashes -r requirements.lock

COPY backend ./backend
COPY frontend ./frontend
COPY LICENSE.md EULA.md VERSION ./

EXPOSE 8000

CMD ["sh", "-c", "if [ \"${WEB_CONCURRENCY:-1}\" -gt 1 ] && [ -z \"${AWUN_MEDIA_SECRET:-}\" ]; then echo 'AWUN_MEDIA_SECRET is required with multiple workers' >&2; exit 1; fi; exec uvicorn backend.api.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WEB_CONCURRENCY:-1}"]
