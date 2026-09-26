# Multi-platform production-ready Dockerfile for Google Cloud (Cloud Run / GKE)
FROM python:3.12-slim

# Set environment variables
# - PYTHONUNBUFFERED=1: Stream logs directly to stdout/stderr for Google Cloud Logging
# - PYTHONDONTWRITEBYTECODE=1: Avoid writing .pyc files
# - PORT=8080: Default container port provided by Cloud Run
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8080

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and static assets
COPY app/ ./app/
COPY static/ ./static/

# Create a non-root system user for security compliance and assign ownership
RUN adduser --disabled-password --gecos "" --uid 10001 appuser && \
    chown -R appuser:appuser /app

# Switch to non-root user
USER appuser

# Expose default Cloud Run port
EXPOSE 8080

# Launch uvicorn server binding to 0.0.0.0 and the dynamically assigned $PORT
# 'exec' replaces the shell process so uvicorn receives SIGTERM directly for graceful termination
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
