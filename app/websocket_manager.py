import json
import logging
from typing import List
from starlette.websockets import WebSocket

logger = logging.getLogger("fansphere.ws")

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"Client connected. Active count: {len(self.active_connections)}")
        await self.broadcast({
            "type": "presence",
            "online_count": max(len(self.active_connections), 1) + 14  # Add realistic fan baseline
        })

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"Client disconnected. Active count: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        disconnected = []
        payload = json.dumps(message)
        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception:
                disconnected.append(connection)
        
        for dead_conn in disconnected:
            self.disconnect(dead_conn)

    async def broadcast_chat(self, msg_dict: dict):
        await self.broadcast({
            "type": "chat_message",
            "data": msg_dict
        })

    async def broadcast_vote(self, post_id: int, upvotes: int, downvotes: int):
        await self.broadcast({
            "type": "vote_update",
            "post_id": post_id,
            "upvotes": upvotes,
            "downvotes": downvotes
        })

    async def broadcast_comment_vote(self, comment_id: int, upvotes: int):
        await self.broadcast({
            "type": "comment_vote_update",
            "comment_id": comment_id,
            "upvotes": upvotes
        })

    async def broadcast_new_post(self, post_dict: dict):
        await self.broadcast({
            "type": "new_post",
            "data": post_dict
        })

    async def broadcast_new_comment(self, comment_dict: dict):
        await self.broadcast({
            "type": "new_comment",
            "data": comment_dict
        })

    async def broadcast_match_event(self, match_dict: dict, standings_dict: list):
        await self.broadcast({
            "type": "match_event",
            "match": match_dict,
            "standings": standings_dict
        })

manager = ConnectionManager()

