-- Town Service Requests schema. Instants are ISO 8601 UTC text (toISOString), so they sort and compare as text.

-- One deployment = one town: exactly one settings row. The PIN is PBKDF2-SHA256 (hash and salt base64).
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  town_name TEXT NOT NULL,
  emergency_phone TEXT NOT NULL,
  office_phone TEXT NOT NULL,
  office_hours TEXT NOT NULL,
  sla_days TEXT NOT NULL, -- JSON { category key: whole days or null }
  pin_hash TEXT NOT NULL,
  pin_salt TEXT NOT NULL,
  pin_iterations INTEGER NOT NULL
);

-- Staff sessions: only the SHA-256 of the token is stored.
CREATE TABLE staff_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- Sign-in and rate-limit attempts per IP: 'create' (new report), 'me_too', 'pin' (wrong PIN), 'status' (unknown status key).
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'me_too', 'pin', 'status')),
  ip TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX attempts_by_ip ON attempts (kind, ip, at);

CREATE TABLE crews (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

-- Ids start at 1001: the insert computes COALESCE(MAX(id), 1000) + 1.
CREATE TABLE requests (
  id INTEGER PRIMARY KEY CHECK (id >= 1001),
  submission_id TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  ward TEXT,
  location_label TEXT NOT NULL,
  description TEXT,
  reporter_name TEXT,
  reporter_phone TEXT,
  status TEXT NOT NULL CHECK (status IN ('new', 'assigned', 'in_progress', 'done', 'wont_fix', 'merged')),
  crew_id INTEGER REFERENCES crews (id),
  public_message TEXT,
  plus_ones INTEGER NOT NULL DEFAULT 0,
  photo TEXT NOT NULL CHECK (photo IN ('none', 'waiting', 'stored')),
  status_key TEXT NOT NULL UNIQUE,
  merged_into INTEGER REFERENCES requests (id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX requests_by_category_status ON requests (category, status);
CREATE INDEX requests_by_merged_into ON requests (merged_into);
CREATE INDEX requests_by_created ON requests (created_at, id);

-- Each entry keeps its staff text and its public text (NULL when internal), so the public status page reads public_text only.
CREATE TABLE request_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests (id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  public_text TEXT,
  staff_text TEXT NOT NULL,
  internal INTEGER NOT NULL CHECK (internal IN (0, 1))
);
CREATE INDEX request_history_by_request ON request_history (request_id, at, id);

-- Phones that count toward a report: the reporter's own (reporter = 1) and every "Me too".
CREATE TABLE metoo_devices (
  request_id INTEGER NOT NULL REFERENCES requests (id),
  device_id TEXT NOT NULL,
  reporter INTEGER NOT NULL DEFAULT 0 CHECK (reporter IN (0, 1)),
  at TEXT NOT NULL,
  PRIMARY KEY (request_id, device_id)
);

-- One photo per request; the R2 object key is photo_key.
CREATE TABLE photos (
  photo_key TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL UNIQUE REFERENCES requests (id),
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

-- Photo upload tokens: only the SHA-256 is stored; they expire one hour after they are issued.
CREATE TABLE upload_tokens (
  token_hash TEXT PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES requests (id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX upload_tokens_by_request ON upload_tokens (request_id);
