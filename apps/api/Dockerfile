FROM python:3.11-slim

# Keep logs unbuffered and the image free of bytecode; /tmp holds any scratch.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HOME=/tmp

WORKDIR /app

RUN groupadd --system app \
    && useradd --system --gid app --no-create-home app

COPY apps/api/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY apps/api/ ./apps/api/
COPY data/ ./data/

# The SQLite file lives on a mounted volume; ownership is inherited by an
# empty named volume, so the non-root process can write to it.
RUN mkdir -p /app/state && chown -R app:app /app /app/state

USER app
WORKDIR /app/apps/api

EXPOSE 8000

# Access logging is handled by RequestContextMiddleware so request ids line up.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--proxy-headers"]
