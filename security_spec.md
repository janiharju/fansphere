# Security Specification & Test Blueprint

## 1. Data Invariants
1. Posts must possess a valid numeric or string ID, a non-empty title (>= 3 chars, <= 300 chars), content (>= 5 chars, <= 10000 chars), and author identity.
2. Comments must reference a valid post ID and contain legitimate text content (<= 2000 chars).
3. Chat messages must be tied to an allowed room with a constrained length (<= 1000 chars).
4. Sessions require an authentic ID, nickname, and non-expired window.
5. All reads and writes must be protected against malicious injection, unvalidated arbitrary types, oversized payloads, and unauthenticated writes when applicable.

## 2. The Dirty Dozen Payloads (Designed to Fail)
1. **Ghost Field Injection (Post)**:
   `{"id": 999, "title": "Attack", "content": "Valid body content", "author": "Hacker", "isAdmin": true, "created_at": "2026-10-08T00:00:00Z"}`
2. **Title Truncation / Empty (Post)**:
   `{"id": 1000, "title": "A", "content": "Too short title", "author": "Hacker", "created_at": "2026-10-08T00:00:00Z"}`
3. **Denial of Wallet - Oversized Content (Post)**:
   `{"id": 1001, "title": "Huge", "content": "x".repeat(50000), "author": "Hacker", "created_at": "2026-10-08T00:00:00Z"}`
4. **Invalid Type for ID (Post)**:
   `{"id": "not-a-number-or-valid-id", "title": "Type Attack", "content": "Hello world", "author": "Hacker", "created_at": "2026-10-08T00:00:00Z"}`
5. **Missing Required Fields (Post)**:
   `{"title": "No ID or Author", "content": "Incomplete schema write"}`
6. **Comment with Ghost Field**:
   `{"id": 90, "post_id": 1, "author": "Hacker", "content": "Legit", "bypassAuth": true, "created_at": "2026-10-08T00:00:00Z"}`
7. **Comment with Oversized Content**:
   `{"id": 91, "post_id": 1, "author": "Hacker", "content": "x".repeat(5000), "created_at": "2026-10-08T00:00:00Z"}`
8. **Chat Message with Illegal Room**:
   `{"id": 92, "room": "root-admin-restricted", "author": "Spammer", "content": "Hello", "created_at": "2026-10-08T00:00:00Z"}`
9. **Chat Message with Oversized Content**:
   `{"id": 93, "room": "general", "author": "Spammer", "content": "x".repeat(5000), "created_at": "2026-10-08T00:00:00Z"}`
10. **Session Privilege Escalation**:
    `{"id": "sess-hack", "nickname": "Root", "flair": "Official", "role": "superadmin", "created_at": "2026-10-08T00:00:00Z", "expires_at": "2030-01-01"}`
11. **Session Missing Nickname**:
    `{"id": "sess-empty", "flair": "Testers", "created_at": "2026-10-08T00:00:00Z", "expires_at": "2026-10-08T02:00:00Z"}`
12. **Realm Unauthorized Deletion or Spoofing**:
    `{"id": "fake-realm", "name": "", "badge_color": "not-a-color"}`
