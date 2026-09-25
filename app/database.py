import os
import json
import aiosqlite
from datetime import datetime, timezone, timedelta

DB_PATH = os.environ.get("DB_PATH", "fansphere.db")

async def get_db():
    db = await aiosqlite.connect(DB_PATH)
    db.row_factory = aiosqlite.Row
    return db

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS teams (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                short_name TEXT NOT NULL,
                logo TEXT NOT NULL,
                played INTEGER DEFAULT 0,
                won INTEGER DEFAULT 0,
                drawn INTEGER DEFAULT 0,
                lost INTEGER DEFAULT 0,
                gf INTEGER DEFAULT 0,
                ga INTEGER DEFAULT 0,
                points INTEGER DEFAULT 0,
                form TEXT DEFAULT '[]'
            );
        """)
        
        await db.execute("""
            CREATE TABLE IF NOT EXISTS matches (
                id TEXT PRIMARY KEY,
                home_team_id TEXT NOT NULL,
                away_team_id TEXT NOT NULL,
                home_score INTEGER DEFAULT 0,
                away_score INTEGER DEFAULT 0,
                minute INTEGER DEFAULT 0,
                status TEXT DEFAULT 'UPCOMING',
                events TEXT DEFAULT '[]'
            );
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                author TEXT NOT NULL,
                author_flair TEXT DEFAULT 'Gunner',
                tag TEXT NOT NULL,
                upvotes INTEGER DEFAULT 1,
                downvotes INTEGER DEFAULT 0,
                comment_count INTEGER DEFAULT 0,
                image_url TEXT DEFAULT '',
                created_at TEXT NOT NULL
            );
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                parent_id INTEGER DEFAULT NULL,
                author TEXT NOT NULL,
                author_flair TEXT DEFAULT 'Fan',
                content TEXT NOT NULL,
                upvotes INTEGER DEFAULT 1,
                created_at TEXT NOT NULL,
                FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE
            );
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room TEXT DEFAULT 'general',
                author TEXT NOT NULL,
                author_flair TEXT DEFAULT 'Gunner',
                badge_color TEXT DEFAULT '#EF4444',
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        """)

        await db.commit()

        # Check if teams are already seeded
        async with db.execute("SELECT COUNT(*) FROM teams") as cursor:
            count = (await cursor.fetchone())[0]

        if count == 0:
            await seed_data(db)

async def seed_data(db: aiosqlite.Connection):
    now = datetime.now(timezone.utc)
    
    # 1. Seed Premier League Teams
    teams = [
        ("ARS", "Arsenal", "Arsenal", "🔴⚪", 28, 20, 5, 3, 64, 22, 65, json.dumps(["W", "W", "D", "W", "W"])),
        ("MCI", "Manchester City", "Man City", "🩵⚪", 28, 19, 6, 3, 63, 26, 63, json.dumps(["W", "D", "W", "W", "W"])),
        ("LIV", "Liverpool", "Liverpool", "🔴🔴", 28, 19, 5, 4, 62, 25, 62, json.dumps(["W", "W", "L", "W", "D"])),
        ("AVL", "Aston Villa", "Aston Villa", "🟣🩵", 28, 16, 5, 7, 52, 35, 53, json.dumps(["L", "W", "W", "D", "W"])),
        ("CHE", "Chelsea", "Chelsea", "🔵⚪", 28, 14, 7, 7, 49, 36, 49, json.dumps(["D", "W", "W", "L", "D"])),
        ("NEW", "Newcastle United", "Newcastle", "⚪⚫", 28, 14, 5, 9, 48, 38, 47, json.dumps(["W", "L", "W", "W", "L"])),
        ("TOT", "Tottenham Hotspur", "Tottenham", "⚪⚪", 28, 13, 5, 10, 50, 42, 44, json.dumps(["L", "L", "W", "D", "W"])),
        ("BHA", "Brighton & Hove Albion", "Brighton", "🔵⚪", 28, 11, 8, 9, 43, 40, 41, json.dumps(["D", "W", "D", "L", "W"])),
        ("FUL", "Fulham", "Fulham", "⚪⚫", 28, 11, 6, 11, 41, 41, 39, json.dumps(["W", "D", "L", "W", "L"])),
        ("MUN", "Manchester United", "Man Utd", "🔴⚫", 28, 10, 6, 12, 38, 42, 36, json.dumps(["L", "D", "W", "L", "L"])),
        ("BOU", "AFC Bournemouth", "Bournemouth", "🔴⚫", 28, 9, 8, 11, 40, 44, 35, json.dumps(["W", "L", "D", "D", "W"])),
        ("WHU", "West Ham United", "West Ham", "🍷🩵", 28, 9, 7, 12, 37, 48, 34, json.dumps(["L", "W", "L", "D", "D"])),
        ("BRE", "Brentford", "Brentford", "🔴⚪", 28, 9, 5, 14, 45, 52, 32, json.dumps(["L", "L", "W", "L", "D"])),
        ("CRY", "Crystal Palace", "Crystal Palace", "🔴🔵", 28, 7, 10, 11, 33, 43, 31, json.dumps(["D", "D", "L", "W", "D"])),
        ("EVE", "Everton", "Everton", "🔵⚪", 28, 7, 9, 12, 30, 41, 30, json.dumps(["D", "W", "L", "D", "L"])),
        ("NFO", "Nottingham Forest", "Nottm Forest", "🔴⚪", 28, 7, 7, 14, 32, 49, 28, json.dumps(["W", "L", "L", "D", "L"])),
        ("WOL", "Wolverhampton Wanderers", "Wolves", "🟡⚫", 28, 7, 6, 15, 36, 54, 27, json.dumps(["L", "L", "L", "W", "L"])),
        ("IPS", "Ipswich Town", "Ipswich", "🔵⚪", 28, 4, 9, 15, 27, 56, 21, json.dumps(["L", "D", "L", "L", "D"])),
        ("LEI", "Leicester City", "Leicester", "🔵⚪", 28, 4, 7, 17, 29, 61, 19, json.dumps(["L", "L", "D", "L", "L"])),
        ("SOU", "Southampton", "Southampton", "🔴⚪", 28, 2, 4, 22, 19, 68, 10, json.dumps(["L", "L", "L", "L", "L"]))
    ]
    await db.executemany("""
        INSERT INTO teams (id, name, short_name, logo, played, won, drawn, lost, gf, ga, points, form)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, teams)

    # 2. Seed Live & Upcoming Matches
    matches = [
        ("m1", "ARS", "CHE", 2, 1, 74, "LIVE", json.dumps([
            {"min": 18, "team": "ARS", "player": "Saka", "type": "GOAL"},
            {"min": 42, "team": "CHE", "player": "Palmer", "type": "GOAL"},
            {"min": 63, "team": "ARS", "player": "Havertz", "type": "GOAL"}
        ])),
        ("m2", "MCI", "NEW", 1, 1, 68, "LIVE", json.dumps([
            {"min": 24, "team": "NEW", "player": "Isak", "type": "GOAL"},
            {"min": 55, "team": "MCI", "player": "Haaland", "type": "GOAL"}
        ])),
        ("m3", "LIV", "TOT", 0, 0, 0, "UPCOMING", json.dumps([]))
    ]
    await db.executemany("""
        INSERT INTO matches (id, home_team_id, away_team_id, home_score, away_score, minute, status, events)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, matches)

    # 3. Seed Reddit-like Forum Posts
    time_2h_ago = (now - timedelta(hours=2)).isoformat()
    time_4h_ago = (now - timedelta(hours=4)).isoformat()
    time_7h_ago = (now - timedelta(hours=7)).isoformat()
    time_1d_ago = (now - timedelta(days=1)).isoformat()
    time_2d_ago = (now - timedelta(days=2)).isoformat()

    posts = [
        (
            "[Match Thread] Arsenal vs Chelsea (London Derby - Matchday 28 Live Discussion)",
            "The Gunners host Chelsea at Emirates Stadium! Arteta starts with Raya, White, Saliba, Gabriel, Timber, Partey, Rice, Odegaard, Saka, Havertz, Martinelli. Live tactical thoughts, match reactions, and celebration thread. COYG! 🔴⚪",
            "HelsinkiGunner",
            "ArseFinland Member",
            "Match Thread",
            87,
            3,
            4,
            "",
            time_2h_ago
        ),
        (
            "ArseFinland Official Watch Party: Sports Academy Helsinki & Hook Tampere this Saturday!",
            "Moro kaikki Arsenal-fanit! ArseFinland järjestää jälleen yhteiskatsomon. Tervetuloa katsomaan peliä isolta screeniltä mahtavassa seurassa Helsingissä (Sports Academy, Kaivokatu 8) ja Tampereella (Ravintola Hook). Jäsenkortilla tutut faniedut hanatuotteista ja burgereista. Paikalle kannattaa saapua n. 45 min ennen aloituspotkua varmistaaksesi hyvät istumapaikat!",
            "ArseFinlandAdmin",
            "Club Official",
            "Meetups",
            64,
            1,
            2,
            "",
            time_4h_ago
        ),
        (
            "Tactical breakdown: Jurrien Timber's role as inverted fullback and how it frees Odegaard",
            "Watching the past 5 matches, Arteta has dialed in our rest defense significantly. When Timber inverts alongside Rice or Partey into the half-space, it creates a box midfield that completely neutralizes counter-attacks while letting Martin Odegaard drift into the right half-space triangle with Saka and White. Thoughts on how this will hold up against Europe's best?",
            "ArtetaTactics",
            "Analyst",
            "Tactics",
            42,
            2,
            3,
            "",
            time_7h_ago
        ),
        (
            "Summer Transfer Window: Who should be our dream striker target?",
            "With the Premier League title race reaching fever pitch, Edu and the scouting department are reportedly evaluating our #9 options for the summer window. Options being floated in the media: Benjamin Šeško, Alexander Isak, or Viktor Gyökeres. Who fits Arteta's physical press and link-up play best?",
            "GoonerJussi",
            "Gunner",
            "Transfers",
            35,
            4,
            1,
            "",
            time_1d_ago
        ),
        (
            "When you check the league table on Sunday evening and we're top of the league",
            "Trust the process. 65 points and counting. The red and white cannon firing on all cylinders! Terveisiä kaikille ArseFinlandin jäsenille ympäri Suomea!",
            "PohjolanTykkimies",
            "Suomi Gunner",
            "Memes",
            98,
            2,
            1,
            "",
            time_2d_ago
        )
    ]
    await db.executemany("""
        INSERT INTO posts (title, content, author, author_flair, tag, upvotes, downvotes, comment_count, image_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, posts)

    # 4. Seed Comments
    comments = [
        (1, None, "TurkuGunner", "Gunner", "Saka's goal in the 18th minute was pure filth! Cut inside, two defenders flat-footed.", 18, (now - timedelta(minutes=50)).isoformat()),
        (1, 1, "TampereGooner", "Gunner", "Agreed! And look at Havertz's pressing run to drag the center back away to create the shooting lane.", 9, (now - timedelta(minutes=40)).isoformat()),
        (1, None, "Mikko_V", "Fan", "Raya's distribution from the back tonight has been world class under pressure.", 12, (now - timedelta(minutes=25)).isoformat()),
        (1, None, "OuluCannon", "Gunner", "Havertz makes it 2-1!! The Emirates is electric right now!", 24, (now - timedelta(minutes=10)).isoformat()),
        
        (2, None, "EspooRed", "Gunner", "Nähdään Sports Academyssa! Viime katsomossa oli aivan mieletön tunnelma Pohjois-Lontoon derbyssä.", 8, (now - timedelta(hours=3)).isoformat()),
        (2, None, "Jari_Arsenal", "Member", "Tampereen Hookissa myös pöytävaraus hoidettu 12 hengelle. Tervetuloa mukaan uudetkin fanit!", 11, (now - timedelta(hours=2)).isoformat()),

        (3, None, "NordicGooner", "Tactics", "Spot on analysis. Timber's recovery pace when we lose possession high up the pitch is unmatched.", 6, (now - timedelta(hours=5)).isoformat()),
        (3, 7, "ArtetaTactics", "Analyst", "Exactly, it allows Gabriel to step up aggressively knowing Timber can sweep behind.", 4, (now - timedelta(hours=4)).isoformat()),
        (3, None, "Lauri_Gunner", "Fan", "He was sorely missed last season due to the ACL injury. Having him back healthy changes everything.", 5, (now - timedelta(hours=3)).isoformat()),

        (4, None, "StadinTykkimies", "Gunner", "Gyökeres would be an absolute powerhouse in the Premier League. His hold-up play and work rate are phenomenal.", 7, (now - timedelta(hours=18)).isoformat()),

        (5, None, "Matti_99", "Fan", "Mind the gap!! 🔴⚪", 14, (now - timedelta(days=1)).isoformat())
    ]
    await db.executemany("""
        INSERT INTO comments (post_id, parent_id, author, author_flair, content, upvotes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """, comments)

    # 5. Seed Real-time Chat Messages
    chat_messages = [
        # General Room
        ("general", "HelsinkiGunner", "Gunner", "#EF4444", "Welcome to ArseFinland FanSphere everyone! Tervetuloa!", (now - timedelta(minutes=25)).isoformat()),
        ("general", "TurkuGunner", "Gunner", "#EF4444", "What a match so far! Saka is on fire today 🔥", (now - timedelta(minutes=20)).isoformat()),
        ("general", "TampereGooner", "Gunner", "#10B981", "Watching live at Ravintola Hook with 15 other Finnish gooners 🍻", (now - timedelta(minutes=15)).isoformat()),
        ("general", "CityFan_99", "Man City", "#06B6D4", "City just equalized at St James Park! Haaland ⚽", (now - timedelta(minutes=10)).isoformat()),
        ("general", "Mikko_V", "Gunner", "#EF4444", "KAI HAVERTZ SCORESSSS 2-1!! GET IN THERE!! 🔴⚪", (now - timedelta(minutes=5)).isoformat()),
        ("general", "ArseFinlandAdmin", "Official", "#F59E0B", "Reminder: Voting is open for today's Man of the Match in the forum!", (now - timedelta(minutes=2)).isoformat()),
        ("general", "NordicGooner", "Gunner", "#EF4444", "15 minutes left to hold on to the 3 points! Let's go boys!", (now - timedelta(minutes=1)).isoformat()),
        
        # Matchday Live Room
        ("matchday", "HelsinkiGunner", "Gunner", "#EF4444", "MATCHDAY LIVE CHAT! Lineups are in, let's hear your score predictions!", (now - timedelta(minutes=45)).isoformat()),
        ("matchday", "Mikko_V", "Gunner", "#EF4444", "3-1 Arsenal, Saka brace and Odegaard masterclass incoming!", (now - timedelta(minutes=35)).isoformat()),
        ("matchday", "TurkuGunner", "Gunner", "#EF4444", "GOALLLLL SAKA 18'!! What a curler into the far corner!! 🔥⚽", (now - timedelta(minutes=22)).isoformat()),
        ("matchday", "BlueFan", "Chelsea", "#3B82F6", "Palmer answers right back before half time 1-1, game on!", (now - timedelta(minutes=18)).isoformat()),
        ("matchday", "TampereGooner", "Gunner", "#10B981", "HAVERTZ WITH THE HEADER 2-1!! The Emirates is rocking right now!", (now - timedelta(minutes=6)).isoformat()),
        ("matchday", "ArtetaTactics", "Analyst", "#93C5FD", "Huge tactical substitution by Arteta putting in Merino to stabilize the midfield.", (now - timedelta(minutes=2)).isoformat()),

        # Suomi Watchparties Room
        ("suomi-fans", "ArseFinlandAdmin", "Official", "#F59E0B", "Tervetuloa kaikille Suomen Arsenal-kannattajille! Täällä sovitaan kisakatsomoista.", (now - timedelta(hours=3)).isoformat()),
        ("suomi-fans", "HelsinkiGunner", "Gunner", "#EF4444", "Sports Academyyn tulossa ainakin 25 tykkimiestä lauantaina. Pöydät varattu!", (now - timedelta(hours=2)).isoformat()),
        ("suomi-fans", "TampereGooner", "Gunner", "#10B981", "Tampereen Hookissa myös hyvä porukka kasassa! Siivet & bisseä kylkeen 🍗🍺", (now - timedelta(hours=1)).isoformat()),
        ("suomi-fans", "OuluCannon", "Gunner", "#EF4444", "Onko Oulun St. Michaelissa tänään väkeä? Voisin tulla toisella puoliajalla!", (now - timedelta(minutes=30)).isoformat())
    ]
    await db.executemany("""
        INSERT INTO chat_messages (room, author, author_flair, badge_color, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    """, chat_messages)

    await db.commit()

