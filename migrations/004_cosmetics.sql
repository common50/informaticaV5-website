-- 004: cosmetics, oftewel uiterlijk verward voor je eigen profiel
--
-- draai dit een keer tegen je bestaande database:
--   psql "postgresql://postgres:meow@localhost:5432/meow_utf8" -f migrations/004_cosmetics.sql
--
-- alles hieronder is idempotent, dus tweemaal draaien mag

-- wat je hebt, en of je het ook draagt
CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id INT NOT NULL,
    item_key VARCHAR(50) NOT NULL,
    slot VARCHAR(20) NOT NULL,
    equipped BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS user_cosmetics_one_per_slot
    ON user_cosmetics(user_id, slot) WHERE equipped;

CREATE INDEX IF NOT EXISTS user_cosmetics_equipped_idx
    ON user_cosmetics(user_id) WHERE equipped;
