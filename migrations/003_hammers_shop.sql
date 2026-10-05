-- 003: ban hamers (1x gebruik) en nep microtransactions
--
-- draai dit een keer tegen je bestaande database:
--   psql "postgresql://postgres:meow@localhost:5432/meow_utf8" -f migrations/003_hammers_shop.sql
--
-- alles hieronder is idempotent, dus tweemaal draaien mag

-- je knoffers, want echt geld is er niet en dat blijft zo
ALTER TABLE users ADD COLUMN IF NOT EXISTS coins BIGINT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS ban_hammers (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    given_by INT NOT NULL,
    uses_left INT NOT NULL DEFAULT 1 CHECK (uses_left >= 0),
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (given_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS ban_hammers_ready_idx ON ban_hammers(owner_id) WHERE uses_left > 0;

CREATE TABLE IF NOT EXISTS ban_hammer_uses (
    id SERIAL PRIMARY KEY,
    hammer_id INT NOT NULL,
    target_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (hammer_id) REFERENCES ban_hammers(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS microtransactions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    item_key VARCHAR(50) NOT NULL,
    item_name VARCHAR(100) NOT NULL,
    price BIGINT NOT NULL,
    granted_by INT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS microtransactions_user_idx ON microtransactions(user_id, id DESC);
