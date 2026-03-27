FROM python:3.12-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
COPY src/ src/

RUN pip install --no-cache-dir .

RUN mkdir -p /data

ENV WORKER_HOST=0.0.0.0
ENV WORKER_PORT=8080
ENV WORKER_STORAGE_ROOT=/data

EXPOSE 8080

CMD ["python", "-m", "audio_worker.cli", "--host", "0.0.0.0", "--port", "8080"]
