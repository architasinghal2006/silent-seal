# Single-service image: builds the PWA, then serves it from the FastAPI backend.
# Used by render.yaml. docker-compose still builds backend/Dockerfile (API only).

# --- 1. Build the frontend ---------------------------------------------------
FROM node:20-alpine AS frontend
WORKDIR /build/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Baked into the browser bundle at build time (not a secret). Render passes service
# env vars as build args, so setting VITE_UNLOCK_SEQUENCE there overrides this default.
# The starting sequence for a phone that has not chosen its own yet. Each survivor picks
# a private one during setup, so this only ever opens first-time setup.
ARG VITE_UNLOCK_SEQUENCE=1379
ENV VITE_UNLOCK_SEQUENCE=${VITE_UNLOCK_SEQUENCE}
RUN npm run build

# --- 2. Backend + built frontend ---------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST=/srv/frontend_dist

WORKDIR /srv

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# Schema migrations. The app applies them itself on every start.
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini
COPY --from=frontend /build/frontend/dist ./frontend_dist

# appuser owns /srv so the SQLite fallback (no DATABASE_URL) can write its file.
RUN useradd --create-home appuser && chown appuser /srv
USER appuser

# Render sets $PORT; locally this falls back to 8000.
EXPOSE 8000
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*'"]
