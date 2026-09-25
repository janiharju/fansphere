import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app
from app.database import init_db

@pytest.mark.anyio
async def test_get_standings():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        response = await ac.get("/api/league/standings")
        assert response.status_code == 200
        standings = response.json()
        assert len(standings) == 20
        # Check that top teams include Arsenal
        team_names = [t["short_name"] for t in standings]
        assert "Arsenal" in team_names
        assert "Man City" in team_names

@pytest.mark.anyio
async def test_posts_and_voting():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # 1. Fetch posts
        res = await ac.get("/api/posts?sort=hot")
        assert res.status_code == 200
        posts = res.json()
        assert len(posts) > 0

        first_post_id = posts[0]["id"]
        initial_upvotes = posts[0]["upvotes"]

        # 2. Upvote post
        vote_res = await ac.post(f"/api/posts/{first_post_id}/vote", json={"direction": "up"})
        assert vote_res.status_code == 200
        data = vote_res.json()
        assert data["upvotes"] == initial_upvotes + 1

        # 3. Create a new post
        new_post_payload = {
            "title": "Matchday Watchparty in Oulu",
            "content": "Any Arsenal fans gathering in Oulu for the weekend match?",
            "author": "OuluFan",
            "author_flair": "Gunner",
            "tag": "Meetups"
        }
        create_res = await ac.post("/api/posts", json=new_post_payload)
        assert create_res.status_code == 200
        created = create_res.json()
        assert created["title"] == new_post_payload["title"]
        assert created["upvotes"] == 1

        # 4. Add comment to post
        comment_payload = {
            "content": "Yes! Meet at St. Michael pub around 17:00!",
            "author": "OuluGooner",
            "author_flair": "Gunner"
        }
        comment_res = await ac.post(f"/api/posts/{created['id']}/comments", json=comment_payload)
        assert comment_res.status_code == 200
        comment = comment_res.json()
        assert comment["content"] == comment_payload["content"]

        # 5. Fetch post detail
        detail_res = await ac.get(f"/api/posts/{created['id']}")
        assert detail_res.status_code == 200
        detail = detail_res.json()
        assert len(detail["comments"]) == 1

@pytest.mark.anyio
async def test_chat_message():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Fetch history
        res = await ac.get("/api/chat/history?room=general")
        assert res.status_code == 200
        messages = res.json()
        assert len(messages) > 0

        # Post a message
        chat_payload = {
            "content": "Come on you Gunners!! 🔴⚪",
            "author": "TestRunner",
            "author_flair": "Gunner",
            "badge_color": "#EF4444",
            "room": "general"
        }
        post_chat_res = await ac.post("/api/chat/message", json=chat_payload)
        assert post_chat_res.status_code == 200
        saved = post_chat_res.json()
        assert saved["content"] == chat_payload["content"]

@pytest.mark.anyio
async def test_simulate_match_event():
    await init_db()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.post("/api/league/simulate-event", json={
            "match_id": "m1",
            "scoring_team": "ARS",
            "player": "Martin Odegaard",
            "event_type": "GOAL"
        })
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "success"
        assert data["match"]["home_score"] >= 3

def test_websocket_connection():
    from starlette.testclient import TestClient
    with TestClient(app) as client:
        with client.websocket_connect("/ws") as websocket:
            # First message received is presence
            data = websocket.receive_json()
            assert data["type"] == "presence"
            assert data["online_count"] >= 15
            
            # Send ping
            websocket.send_json({"type": "ping"})
            resp = websocket.receive_json()
            assert resp["type"] == "pong"

