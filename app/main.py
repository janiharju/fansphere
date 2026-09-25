import os
import json
from datetime import datetime, timezone
from contextlib import asynccontextmanager
from typing import Optional, List

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.database import init_db, get_db
from app.websocket_manager import manager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

app = FastAPI(title="ArseFinland FanSphere", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class CreatePostRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    content: str = Field(..., min_length=5)
    author: str = Field(default="Gunner", max_length=50)
    author_flair: str = Field(default="Fan", max_length=50)
    tag: str = Field(default="Discussion", max_length=50)
    image_url: Optional[str] = ""

class VotePostRequest(BaseModel):
    direction: str = Field(..., pattern="^(up|down|clear_up|clear_down)$")

class CreateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    author: str = Field(default="Gunner", max_length=50)
    author_flair: str = Field(default="Fan", max_length=50)
    parent_id: Optional[int] = None

class VoteCommentRequest(BaseModel):
    direction: str = Field(default="up", pattern="^(up)$")

class ChatMessageRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=1000)
    author: str = Field(default="Anonymous Gunner", max_length=50)
    author_flair: str = Field(default="Gunner", max_length=50)
    badge_color: str = Field(default="#EF4444")
    room: str = Field(default="general")

class SimulateMatchEventRequest(BaseModel):
    match_id: str
    scoring_team: str  # "ARS", "CHE", "MCI", "NEW"
    player: str
    event_type: str = "GOAL"


# ==================== FORUM (REDDIT-LIKE) API ====================

@app.get("/api/posts")
async def get_posts(sort: str = Query("hot", pattern="^(hot|new|top)$"), tag: Optional[str] = None):
    db = await get_db()
    try:
        query = "SELECT * FROM posts"
        params = []
        if tag and tag.lower() != "all":
            query += " WHERE tag = ?"
            params.append(tag)
        
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()
        
        posts = []
        now = datetime.now(timezone.utc)
        
        for row in rows:
            p = dict(row)
            score = p["upvotes"] - p["downvotes"]
            p["score"] = score
            
            # Hot score algorithm: time decay
            try:
                created_dt = datetime.fromisoformat(p["created_at"])
                if created_dt.tzinfo is None:
                    created_dt = created_dt.replace(tzinfo=timezone.utc)
                hours_age = max((now - created_dt).total_seconds() / 3600.0, 0.1)
            except Exception:
                hours_age = 1.0
            
            # Hot score weighting: score / (hours + 2)^1.5
            p["hot_score"] = (score + 5) / (pow(hours_age + 2, 1.5))
            posts.append(p)
        
        if sort == "hot":
            posts.sort(key=lambda x: x["hot_score"], reverse=True)
        elif sort == "new":
            posts.sort(key=lambda x: x["created_at"], reverse=True)
        elif sort == "top":
            posts.sort(key=lambda x: x["score"], reverse=True)
            
        return posts
    finally:
        await db.close()

@app.post("/api/posts")
async def create_post(req: CreatePostRequest):
    db = await get_db()
    try:
        created_at = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute("""
            INSERT INTO posts (title, content, author, author_flair, tag, upvotes, downvotes, comment_count, image_url, created_at)
            VALUES (?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
        """, (req.title, req.content, req.author, req.author_flair, req.tag, req.image_url or "", created_at))
        await db.commit()
        post_id = cursor.lastrowid

        new_post = {
            "id": post_id,
            "title": req.title,
            "content": req.content,
            "author": req.author,
            "author_flair": req.author_flair,
            "tag": req.tag,
            "upvotes": 1,
            "downvotes": 0,
            "score": 1,
            "comment_count": 0,
            "image_url": req.image_url or "",
            "created_at": created_at
        }
        await manager.broadcast_new_post(new_post)
        return new_post
    finally:
        await db.close()

@app.get("/api/posts/{post_id}")
async def get_post_detail(post_id: int):
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM posts WHERE id = ?", (post_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post not found")
        
        post = dict(row)
        post["score"] = post["upvotes"] - post["downvotes"]
        
        async with db.execute("""
            SELECT * FROM comments WHERE post_id = ? ORDER BY upvotes DESC, created_at ASC
        """, (post_id,)) as cursor:
            comment_rows = await cursor.fetchall()
            
        comments = [dict(c) for c in comment_rows]
        return {
            "post": post,
            "comments": comments
        }
    finally:
        await db.close()

@app.post("/api/posts/{post_id}/vote")
async def vote_post(post_id: int, req: VotePostRequest):
    db = await get_db()
    try:
        async with db.execute("SELECT upvotes, downvotes FROM posts WHERE id = ?", (post_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Post not found")
        
        upvotes = row["upvotes"]
        downvotes = row["downvotes"]
        
        if req.direction == "up":
            upvotes += 1
        elif req.direction == "down":
            downvotes += 1
        elif req.direction == "clear_up":
            upvotes = max(upvotes - 1, 0)
        elif req.direction == "clear_down":
            downvotes = max(downvotes - 1, 0)

        await db.execute("""
            UPDATE posts SET upvotes = ?, downvotes = ? WHERE id = ?
        """, (upvotes, downvotes, post_id))
        await db.commit()

        await manager.broadcast_vote(post_id, upvotes, downvotes)
        return {"post_id": post_id, "upvotes": upvotes, "downvotes": downvotes, "score": upvotes - downvotes}
    finally:
        await db.close()

@app.post("/api/posts/{post_id}/comments")
async def add_comment(post_id: int, req: CreateCommentRequest):
    db = await get_db()
    try:
        async with db.execute("SELECT id, comment_count FROM posts WHERE id = ?", (post_id,)) as cursor:
            post = await cursor.fetchone()
        if not post:
            raise HTTPException(status_code=404, detail="Post not found")

        created_at = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute("""
            INSERT INTO comments (post_id, parent_id, author, author_flair, content, upvotes, created_at)
            VALUES (?, ?, ?, ?, ?, 1, ?)
        """, (post_id, req.parent_id, req.author, req.author_flair, req.content, created_at))
        
        comment_id = cursor.lastrowid
        new_count = post["comment_count"] + 1
        await db.execute("UPDATE posts SET comment_count = ? WHERE id = ?", (new_count, post_id))
        await db.commit()

        comment_dict = {
            "id": comment_id,
            "post_id": post_id,
            "parent_id": req.parent_id,
            "author": req.author,
            "author_flair": req.author_flair,
            "content": req.content,
            "upvotes": 1,
            "created_at": created_at
        }
        await manager.broadcast_new_comment(comment_dict)
        return comment_dict
    finally:
        await db.close()

@app.post("/api/comments/{comment_id}/vote")
async def vote_comment(comment_id: int, req: VoteCommentRequest):
    db = await get_db()
    try:
        async with db.execute("SELECT id, upvotes FROM comments WHERE id = ?", (comment_id,)) as cursor:
            row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Comment not found")
        
        upvotes = row["upvotes"] + 1
        await db.execute("UPDATE comments SET upvotes = ? WHERE id = ?", (upvotes, comment_id))
        await db.commit()

        await manager.broadcast_comment_vote(comment_id, upvotes)
        return {"comment_id": comment_id, "upvotes": upvotes}
    finally:
        await db.close()


# ==================== REAL-TIME CHAT API ====================

@app.get("/api/chat/history")
async def get_chat_history(room: str = "general", limit: int = 50):
    db = await get_db()
    try:
        async with db.execute("""
            SELECT * FROM chat_messages WHERE room = ? ORDER BY id DESC LIMIT ?
        """, (room, limit)) as cursor:
            rows = await cursor.fetchall()
        
        # Return in chronological order
        messages = [dict(r) for r in reversed(rows)]
        return messages
    finally:
        await db.close()

@app.post("/api/chat/message")
async def post_chat_message(req: ChatMessageRequest):
    db = await get_db()
    try:
        created_at = datetime.now(timezone.utc).isoformat()
        cursor = await db.execute("""
            INSERT INTO chat_messages (room, author, author_flair, badge_color, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (req.room, req.author, req.author_flair, req.badge_color, req.content, created_at))
        await db.commit()

        msg_id = cursor.lastrowid
        msg_dict = {
            "id": msg_id,
            "room": req.room,
            "author": req.author,
            "author_flair": req.author_flair,
            "badge_color": req.badge_color,
            "content": req.content,
            "created_at": created_at
        }
        await manager.broadcast_chat(msg_dict)
        return msg_dict
    finally:
        await db.close()


# ==================== LEAGUE & LIVE MATCH API ====================

async def fetch_standings(db):
    async with db.execute("""
        SELECT *, (gf - ga) as gd 
        FROM teams 
        ORDER BY points DESC, (gf - ga) DESC, gf DESC, name ASC
    """) as cursor:
        rows = await cursor.fetchall()
    standings = []
    for idx, r in enumerate(rows, start=1):
        team = dict(r)
        team["rank"] = idx
        try:
            team["form"] = json.loads(team["form"])
        except Exception:
            team["form"] = ["W", "D", "L"]
        standings.append(team)
    return standings

@app.get("/api/league/standings")
async def get_league_standings():
    db = await get_db()
    try:
        return await fetch_standings(db)
    finally:
        await db.close()

@app.get("/api/league/fixtures")
async def get_league_fixtures():
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM matches") as cursor:
            rows = await cursor.fetchall()
        
        fixtures = []
        for r in rows:
            m = dict(r)
            try:
                m["events"] = json.loads(m["events"])
            except Exception:
                m["events"] = []
            
            # Join team names
            async with db.execute("SELECT name, short_name, logo FROM teams WHERE id = ?", (m["home_team_id"],)) as c1:
                home = await c1.fetchone()
                m["home_team"] = dict(home) if home else {"name": m["home_team_id"], "logo": "⚽"}
                
            async with db.execute("SELECT name, short_name, logo FROM teams WHERE id = ?", (m["away_team_id"],)) as c2:
                away = await c2.fetchone()
                m["away_team"] = dict(away) if away else {"name": m["away_team_id"], "logo": "⚽"}
                
            fixtures.append(m)
        return fixtures
    finally:
        await db.close()

@app.post("/api/league/simulate-event")
async def simulate_match_event(req: SimulateMatchEventRequest):
    """
    Simulates a live goal or event in a match, updating the match score, minute, 
    and dynamically recalculating the league standings and broadcasting live!
    """
    db = await get_db()
    try:
        async with db.execute("SELECT * FROM matches WHERE id = ?", (req.match_id,)) as cursor:
            match_row = await cursor.fetchone()
        if not match_row:
            raise HTTPException(status_code=404, detail="Match not found")

        match = dict(match_row)
        events = json.loads(match["events"]) if match["events"] else []
        minute = min(match["minute"] + 5, 90)

        home_id = match["home_team_id"]
        away_id = match["away_team_id"]
        home_score = match["home_score"]
        away_score = match["away_score"]

        if req.scoring_team == home_id:
            home_score += 1
            events.append({"min": minute, "team": home_id, "player": req.player, "type": req.event_type})
        elif req.scoring_team == away_id:
            away_score += 1
            events.append({"min": minute, "team": away_id, "player": req.player, "type": req.event_type})

        await db.execute("""
            UPDATE matches 
            SET home_score = ?, away_score = ?, minute = ?, events = ? 
            WHERE id = ?
        """, (home_score, away_score, minute, json.dumps(events), req.match_id))

        # Dynamically recalculate team stats for home and away
        # For simplicity, calculate live difference:
        # If home_score > away_score: home gets 3 pts, away 0
        # If draw: each gets 1 pt
        if home_score > away_score:
            home_pts_bonus = 3
            away_pts_bonus = 0
        elif home_score == away_score:
            home_pts_bonus = 1
            away_pts_bonus = 1
        else:
            home_pts_bonus = 0
            away_pts_bonus = 3

        # Update GF, GA, and points for the teams
        async with db.execute("SELECT gf, ga, points FROM teams WHERE id = ?", (home_id,)) as c:
            h_data = await c.fetchone()
        async with db.execute("SELECT gf, ga, points FROM teams WHERE id = ?", (away_id,)) as c:
            a_data = await c.fetchone()

        if h_data and a_data:
            # Add goal
            if req.scoring_team == home_id:
                await db.execute("UPDATE teams SET gf = gf + 1 WHERE id = ?", (home_id,))
                await db.execute("UPDATE teams SET ga = ga + 1 WHERE id = ?", (away_id,))
            elif req.scoring_team == away_id:
                await db.execute("UPDATE teams SET gf = gf + 1 WHERE id = ?", (away_id,))
                await db.execute("UPDATE teams SET ga = ga + 1 WHERE id = ?", (home_id,))

        await db.commit()

        # Fetch updated standings and fixtures
        updated_standings = await fetch_standings(db)
        
        match["home_score"] = home_score
        match["away_score"] = away_score
        match["minute"] = minute
        match["events"] = events

        # Broadcast live update
        await manager.broadcast_match_event(match, updated_standings)

        return {
            "status": "success",
            "match": match,
            "standings": updated_standings
        }
    finally:
        await db.close()

@app.post("/api/league/reset")
async def reset_league_data():
    """Resets league and chat data to initial state"""
    db = await get_db()
    try:
        await db.execute("DELETE FROM teams")
        await db.execute("DELETE FROM matches")
        await db.execute("DELETE FROM chat_messages")
        await db.execute("DELETE FROM posts")
        await db.execute("DELETE FROM comments")
        from app.database import seed_data
        await seed_data(db)
        standings = await fetch_standings(db)
        return {"status": "reset", "standings": standings}
    finally:
        await db.close()


# ==================== WEBSOCKET ENDPOINT ====================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                # Handle incoming messages from client
                msg_type = msg.get("type")
                if msg_type == "chat":
                    # Save chat message
                    payload = msg.get("payload", {})
                    content = payload.get("content", "").strip()
                    if content:
                        db = await get_db()
                        try:
                            created_at = datetime.now(timezone.utc).isoformat()
                            cursor = await db.execute("""
                                INSERT INTO chat_messages (room, author, author_flair, badge_color, content, created_at)
                                VALUES (?, ?, ?, ?, ?, ?)
                            """, (
                                payload.get("room", "general"),
                                payload.get("author", "Fan"),
                                payload.get("author_flair", "Gunner"),
                                payload.get("badge_color", "#EF4444"),
                                content,
                                created_at
                            ))
                            await db.commit()
                            msg_dict = {
                                "id": cursor.lastrowid,
                                "room": payload.get("room", "general"),
                                "author": payload.get("author", "Fan"),
                                "author_flair": payload.get("author_flair", "Gunner"),
                                "badge_color": payload.get("badge_color", "#EF4444"),
                                "content": content,
                                "created_at": created_at
                            }
                            await manager.broadcast_chat(msg_dict)
                        finally:
                            await db.close()
                elif msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Static files and root route
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.api_route("/", methods=["GET", "HEAD"])
async def serve_index():
    return FileResponse("static/index.html")
