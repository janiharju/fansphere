#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt
fi

echo "Starting ArseFinland FanSphere on http://localhost:8000 ..."
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

