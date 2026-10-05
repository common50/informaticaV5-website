-- 005: afbeeldingen bij berichten
--
-- draai dit een keer tegen je bestaande database:
--   psql "postgresql://postgres:meow@localhost:5432/meow_utf8" -f migrations/005_images.sql
--
-- alles hieronder is idempotent, dus tweemaal draaien mag

CREATE TABLE IF NOT EXISTS images (
    id SERIAL PRIMARY KEY,
    uploader_id INT NOT NULL,
    filename VARCHAR(80) UNIQUE NOT NULL,
    mime VARCHAR(30) NOT NULL,
    byte_size INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS images_uploader_idx ON images(uploader_id);

CREATE TABLE IF NOT EXISTS dm_message_images (
    message_id INT NOT NULL,
    image_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, image_id),
    FOREIGN KEY (message_id) REFERENCES personal_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS team_message_images (
    message_id INT NOT NULL,
    image_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, image_id),
    FOREIGN KEY (message_id) REFERENCES team_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);