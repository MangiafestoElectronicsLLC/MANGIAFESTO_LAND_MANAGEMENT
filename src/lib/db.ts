import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "land-management.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      role TEXT NOT NULL CHECK(role IN ('Chairman', 'Legal', 'Grounds', 'Technology')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'closed')),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status_changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export type User = {
  id: number;
  email: string;
  password_hash: string;
  name: string;
  created_at: string;
};

export type Ticket = {
  id: number;
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  role: "Chairman" | "Legal" | "Grounds" | "Technology";
  status: "open" | "in_progress" | "closed";
  created_by: number;
  created_at: string;
  updated_at: string;
  status_changed_at: string;
  creator_name?: string;
  creator_email?: string;
};

export const db_queries = {
  getUserByEmail: (email: string): User | undefined => {
    return getDb()
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(email) as User | undefined;
  },

  getUserById: (id: number): User | undefined => {
    return getDb()
      .prepare("SELECT * FROM users WHERE id = ?")
      .get(id) as User | undefined;
  },

  createUser: (
    email: string,
    passwordHash: string,
    name: string
  ): Database.RunResult => {
    return getDb()
      .prepare(
        "INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)"
      )
      .run(email, passwordHash, name);
  },

  getAllTickets: (): Ticket[] => {
    return getDb()
      .prepare(
        `SELECT t.*, u.name as creator_name, u.email as creator_email
         FROM tickets t
         JOIN users u ON t.created_by = u.id
         ORDER BY t.created_at DESC`
      )
      .all() as Ticket[];
  },

  getTicketById: (id: number): Ticket | undefined => {
    return getDb()
      .prepare(
        `SELECT t.*, u.name as creator_name, u.email as creator_email
         FROM tickets t
         JOIN users u ON t.created_by = u.id
         WHERE t.id = ?`
      )
      .get(id) as Ticket | undefined;
  },

  createTicket: (
    title: string,
    description: string,
    priority: string,
    role: string,
    userId: number
  ): Database.RunResult => {
    return getDb()
      .prepare(
        `INSERT INTO tickets (title, description, priority, role, created_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(title, description, priority, role, userId);
  },

  updateTicketStatus: (
    id: number,
    status: string
  ): Database.RunResult => {
    return getDb()
      .prepare(
        `UPDATE tickets
         SET status = ?, updated_at = datetime('now'), status_changed_at = datetime('now')
         WHERE id = ?`
      )
      .run(status, id);
  },

  updateTicket: (
    id: number,
    title: string,
    description: string,
    priority: string,
    role: string,
    status: string
  ): Database.RunResult => {
    return getDb()
      .prepare(
        `UPDATE tickets
         SET title = ?, description = ?, priority = ?, role = ?,
             status = ?, updated_at = datetime('now'),
             status_changed_at = CASE WHEN status != ? THEN datetime('now') ELSE status_changed_at END
         WHERE id = ?`
      )
      .run(title, description, priority, role, status, status, id);
  },

  deleteTicket: (id: number): Database.RunResult => {
    return getDb().prepare("DELETE FROM tickets WHERE id = ?").run(id);
  },
};
