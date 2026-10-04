-- 004: cosmetics, oftewel uiterlijk verward voor je eigen profiel
--
-- draai dit een keer tegen je bestaande database:
--   psql "postgresql://postgres:meow@localhost:5432/postgres" -f migrations/004_cosmetics.sql
--
-- alles hieronder is idempotent, dus tweemaal draaien mag
--
-- de catalogus (welke cosmetics er zijn, wat ze kosten, welke kleur of
-- klasse ze hebben) staat als COSMETICS in src/server.js. hier slaan we
-- alleen vast wie wat heeft en wat iemand draagt.

-- wat je hebt, en of je het ook draagt
CREATE TABLE IF NOT EXISTS user_cosmetics (
    user_id INT NOT NULL,
    item_key VARCHAR(50) NOT NULL,
    -- slot staat hier ook in, al staat het al in de catalogus. zo kan de
    -- database alsnog afdwingen dat je maar één cosmetic per slot draagt,
    -- met een partial unique index. bij het aandoen van een cosmetic
    -- schrijft de server de slot opnieuw uit de catalogus weg, dus als je
    -- een item in server.js naar een ander slot verhuist repareert dat
    -- zichzelf bij het eerstvolgende aandoen
    slot VARCHAR(20) NOT NULL,
    equipped BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- per slot maximaal een dragen, en alleen maar voor de dingen die je ook
-- daadwerkelijk aandoet
CREATE UNIQUE INDEX IF NOT EXISTS user_cosmetics_one_per_slot
    ON user_cosmetics(user_id, slot) WHERE equipped;

-- snel even kijken wat iemand draagt
CREATE INDEX IF NOT EXISTS user_cosmetics_equipped_idx
    ON user_cosmetics(user_id) WHERE equipped;