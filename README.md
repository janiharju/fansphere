# ArseFinland FanSphere ⚽

An interactive, real-time web service and meeting place for sports fans. Tailored for Finnish football supporters ("ArseFinland: The Official Finnish Gunners Hub") with multi-club support, featuring real-time live chat, a Reddit-style threaded forum with upvoting, and an interactive live league table.

## Features

- **🔴⚪ ArseFinland Community Hub**: Dedicated fan space with Finnish watch party locations (Sports Academy Helsinki, Ravintola Hook Tampere, Pikku-Torre Turku), fan flairs, and active discussion.
- **💬 Real-time Matchday Chat**: WebSocket-powered live chat stream with instant broadcasts, active online presence indicator, user flairs, quick emoji reactions, and synthesized audio chimes.
- **📰 Reddit-like Forum Feed**:
  - Hot / New / Top sorting algorithms (including time-decay ranking).
  - Upvote and downvote tally with optimistic UI feedback and live WebSocket sync across clients.
  - Category tags (`Match Thread`, `Meetups`, `Tactics`, `Transfers`, `Memes`).
  - Threaded discussions with nested comments and comment upvoting.
  - Modern, accessible `<dialog closedby="any">` creation and reading modals.
- **🏆 Live League Table**:
  - Full Premier League standings with Played, Goal Difference, Points, and Form badges (W/D/L).
  - Live match status banner with real-time minute and score ticker.
  - Interactive Goal Simulator: Click "ARS Goal" or "MCI Goal" to simulate a live match event and observe real-time table shifts and visual highlight animations across all connected screens.

## Getting Started

### Prerequisites
- Python 3.10+ (Python 3.13 tested)

### Quick Start
```bash
./run.sh
```
Or manually:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
Open **http://localhost:8000** in your browser.

## Running Tests
```bash
PYTHONPATH=. .venv/bin/pytest tests/test_api.py
```

## Docker & Google Cloud Deployment

### 1. Build & Run Locally with Docker
```bash
docker build -t fansphere:latest .
docker run -p 8080:8080 -e PORT=8080 fansphere:latest
```
Open **http://localhost:8080** in your browser.

### 2. Deploy to Google Cloud Run

**Option A: Direct source deployment (Recommended)**
```bash
gcloud run deploy fansphere \
  --source . \
  --region europe-north1 \
  --allow-unauthenticated
```

**Option B: Build container image with Google Cloud Build & deploy**
```bash
# Set your GCP project ID
export PROJECT_ID="YOUR_GCP_PROJECT_ID"

# Build image with Cloud Build
gcloud builds submit --tag gcr.io/$PROJECT_ID/fansphere

# Deploy image to Cloud Run
gcloud run deploy fansphere \
  --image gcr.io/$PROJECT_ID/fansphere \
  --platform managed \
  --region europe-north1 \
  --allow-unauthenticated
```


