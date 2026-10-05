-- 002: teams als kanaal, sessies en moderatie
--
-- draai dit een keer tegen je bestaande database:
--   psql "postgresql://postgres:meow@localhost:5432/meow_utf8" -f migrations/002_chats.sql
--
-- alles hieronder is idempotent, dus tweemaal draaien mag

-- sessies, want zonder sessies is elke admin check zinloos
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- de gouden gebruiker
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- een teamlid maar 1x
CREATE UNIQUE INDEX IF NOT EXISTS team_members_unique ON team_members(team_id, user_id);

-- de originele FKs uit schema.sql droppen geen team mee, dus effft 'm over
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_team_id_fkey;
ALTER TABLE team_members
  ADD CONSTRAINT team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_user_id_fkey;
ALTER TABLE team_members
  ADD CONSTRAINT team_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- berichten in een team
CREATE TABLE IF NOT EXISTS team_messages (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS team_messages_team_idx ON team_messages(team_id, id);

-- hele server gemute
CREATE TABLE IF NOT EXISTS mutes (
    user_id INT PRIMARY KEY,
    muted_by INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (muted_by) REFERENCES users(id)
);

-- eruit geflikt
CREATE TABLE IF NOT EXISTS bans (
    user_id INT PRIMARY KEY,
    banned_by INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (banned_by) REFERENCES users(id)
);

-- gemute in 1 gesprek, thread_key is "1-2" van de twee users (kleinste eerst)
CREATE TABLE IF NOT EXISTS dm_mutes (
    id SERIAL PRIMARY KEY,
    thread_key VARCHAR(32) NOT NULL,
    user_id INT NOT NULL,
    muted_by INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (muted_by) REFERENCES users(id),
    UNIQUE (thread_key, user_id)
);

-- maak whiskers de admin
UPDATE users SET is_admin = TRUE WHERE username = 'whiskers';
