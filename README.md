# Fansphere ⚽

An interactive, real-time web platform and meeting place for sports fans. Built specifically for Finnish Arsenal and football supporters with multi-club support, featuring real-time live matchday chat, a Reddit-style threaded forum with dynamic comment counting, and an interactive live league table.

## Features

- **🔴 Fansphere Club Realms**: Dedicated fan space with Finnish watch party locations (Sports Academy Helsinki, Ravintola Hook Tampere, Pikku-Torre Turku), custom fan flairs, and active community debate.
- **💬 Real-time Matchday Chat**: WebSocket-powered live chat stream with instant broadcasts, active online presence indicators, user flairs, quick emoji reactions, and synthesized audio chimes.
- **📰 Threaded Community Forum**:
  - Hot / New / Top sorting algorithms (including time-decay ranking).
  - Upvote and downvote tally with optimistic UI feedback and live WebSocket sync across clients.
  - Category tags (`Match Thread`, `Meetups`, `Tactics`, `Transfers`, `Memes`).
  - Threaded discussions with dynamic comment counting and image attachment lightbox zoom.
  - Modern, accessible `<dialog closedby="any">` creation and reading modals.
- **🏆 Live League Table**:
  - Full Premier League standings with Played, Goal Difference, Points, and Form badges (W/D/L).
  - Live match status banner with real-time minute and score ticker.
  - Interactive Goal Simulator: Simulate live match events to observe real-time table shifts and visual highlight animations across connected screens.

## Technology Stack

- **Runtime & Backend**: Node.js, Express, TypeScript, `ws` (WebSockets)
- **Frontend**: Vanilla JavaScript (ES modules), Tailwind CSS, Lucide Icons
- **Database & Cloud Storage**: Google Cloud Firestore & Firebase Storage
- **Deployment**: Google Cloud Run & Docker

## Getting Started

### Prerequisites
- Node.js 20+ (Node.js 22 tested)
- npm 10+

### Development
```bash
# Install dependencies
npm install

# Run development server with live reload
npm run dev
```

Open **http://localhost:3000** in your browser.

### Build & Production
```bash
# Compile TypeScript
npm run build

# Start production server
npm start
```

## Docker & Google Cloud Deployment

### 1. Build & Run with Docker
```bash
docker build -t fansphere:latest .
docker run -p 3000:3000 -e PORT=3000 fansphere:latest
```
Open **http://localhost:3000** in your browser.

### 2. Deploy to Google Cloud Run
```bash
gcloud run deploy fansphere \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated
```
