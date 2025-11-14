
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE,
 password_hash TEXT,
 role TEXT,
 display_name TEXT
);
CREATE TABLE IF NOT EXISTS projects(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT,
 description TEXT,
 code TEXT
);
CREATE TABLE IF NOT EXISTS videos(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER,
 filename TEXT,
 title TEXT,
 description TEXT,
 peertube_url TEXT
);
CREATE TABLE IF NOT EXISTS annotations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 video_id INTEGER,
 user_id INTEGER,
 time_seconds INTEGER,
 content TEXT,
 category TEXT,
 parent_id INTEGER
);
