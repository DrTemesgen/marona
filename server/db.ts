// SQLite schema for the leaderboard server (node:sqlite, built into Node).
// Privacy: no column holds a real name, phone number or e-mail address. Players are known only
// by a word-pair nickname; the school keeps the list that links nicknames to students.
// Integrity: only the SHA-256 of a player token is stored, never the token itself.
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

// The players table must have exactly these columns (checked by tools/privacyScan.ts).
export const PLAYER_COLUMNS = ['id', 'class_id', 'nickname', 'token_hash', 'created_at', 'removed'] as const;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id),
  name TEXT NOT NULL,
  class_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  teacher_code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  size_cap INTEGER NOT NULL CHECK (size_cap > 0)
);
-- Nicknames are unique city-wide (a superset of unique within the class), so that a city
-- ranking that shows only nicknames can never name two students the same way.
CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id),
  nickname TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  removed INTEGER NOT NULL DEFAULT 0 CHECK (removed IN (0, 1))
);
CREATE INDEX IF NOT EXISTS players_class ON players(class_id);
CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY,
  player_id INTEGER NOT NULL REFERENCES players(id),
  case_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  seed INTEGER NOT NULL,
  variant_id TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  end_t REAL NOT NULL,
  server_score REAL NOT NULL,
  duration_ms REAL NOT NULL,
  score_mismatch INTEGER NOT NULL DEFAULT 0 CHECK (score_mismatch IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_player ON runs(player_id);
CREATE TABLE IF NOT EXISTS finals (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  opens_at INTEGER NOT NULL,
  closes_at INTEGER NOT NULL,
  case_ids_json TEXT NOT NULL,
  -- Optional. NULL (the normal case): each case plays its own first finalOnly variant. A value
  -- is used for every case that has a finalOnly variant with that id.
  variant_id TEXT,
  CHECK (closes_at > opens_at)
);
CREATE TABLE IF NOT EXISTS final_starts (
  final_id INTEGER NOT NULL REFERENCES finals(id),
  player_id INTEGER NOT NULL REFERENCES players(id),
  case_id TEXT NOT NULL,
  seed INTEGER NOT NULL,
  variant_id TEXT NOT NULL,
  server_start_ms INTEGER NOT NULL,
  PRIMARY KEY (final_id, player_id, case_id)
);
CREATE TABLE IF NOT EXISTS final_runs (
  final_id INTEGER NOT NULL,
  player_id INTEGER NOT NULL,
  case_id TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  end_t REAL NOT NULL,
  server_score REAL NOT NULL,
  server_duration_ms INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  PRIMARY KEY (final_id, player_id, case_id),
  FOREIGN KEY (final_id, player_id, case_id)
    REFERENCES final_starts(final_id, player_id, case_id)
);
`;

// Opens (and creates if needed) the database. Tests pass ':memory:'.
export function openDb(path = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// ---------- Row types (as SQLite returns them) ----------

export interface ClassRow {
  id: number;
  school_id: number;
  name: string;
  class_code: string;
  teacher_code: string;
  size_cap: number;
}

export interface PlayerRow {
  id: number;
  class_id: number;
  nickname: string;
  school_id: number;
}

export interface FinalRow {
  id: number;
  name: string;
  opens_at: number;
  closes_at: number;
  case_ids_json: string;
  variant_id: string | null;
}

export interface FinalStartRow {
  final_id: number;
  player_id: number;
  case_id: string;
  seed: number;
  variant_id: string;
  server_start_ms: number;
}
