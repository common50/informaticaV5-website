-- uhh schema voor nu ik weet niet

-- heb hier lagesleutel een tutorial voor gevolgd want naast
-- sql injecties bak ik er niet zo heel veel van helaas

-- trwns ik doe de code in het engels want alle documentatie is in het engels

-- dit bestand is de complete stand voor een NIEUWE database
-- voor een bestaande database draai je migrations/002_chats.sql,
-- migrations/003_hammers_shop.sql, migrations/004_cosmetics.sql
-- en migrations/005_images.sql

-- test acc en ww:
-- mittens: iLoveF1sh!

-- gebruikers
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    coins BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);

-- berichten
CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (recipient_id) REFERENCES users(id)
);

-- teams
CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    owner_id INT NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users(id)
);

-- team member mensen
CREATE TABLE team_members (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL,
    user_id INT NOT NULL,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE (team_id, user_id)
);

-- berichten in een team
CREATE TABLE team_messages (
    id SERIAL PRIMARY KEY,
    team_id INT NOT NULL,
    sender_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
    FOREIGN KEY (sender_id) REFERENCES users(id)
);
CREATE INDEX team_messages_team_idx ON team_messages(team_id, id);

-- persoonlijke berichten enz
CREATE TABLE personal_messages (
    id SERIAL PRIMARY KEY,
    sender_id INT NOT NULL,
    recipient_id INT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (sender_id) REFERENCES users(id),
    FOREIGN KEY (recipient_id) REFERENCES users(id)
);

-- ja friends is niet echt geschikt voor een professionele setting
-- maar wat moet ik het anders noemen?? colleagues?
CREATE TABLE friends (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    friend_id INT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (friend_id) REFERENCES users(id),
    UNIQUE (user_id, friend_id),
    CHECK (user_id <> friend_id)
);

-- inlog sessies, alleen de hash van het token staat er
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- hele server gemute
CREATE TABLE mutes (
    user_id INT PRIMARY KEY,
    muted_by INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (muted_by) REFERENCES users(id)
);

-- eruit geflikt
CREATE TABLE bans (
    user_id INT PRIMARY KEY,
    banned_by INT NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (banned_by) REFERENCES users(id)
);

-- gemute in 1 gesprek, thread_key is "1-2" van de twee users (kleinste eerst)
CREATE TABLE dm_mutes (
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

-- de ban hamer: 1x gebruiken en dan is hij stuk
CREATE TABLE ban_hammers (
    id SERIAL PRIMARY KEY,
    owner_id INT NOT NULL,
    given_by INT NOT NULL,
    uses_left INT NOT NULL DEFAULT 1 CHECK (uses_left >= 0),
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (given_by) REFERENCES users(id)
);

-- alleen de hamers die nog kunnen slaan, dan is de lookup goedkoop
CREATE INDEX ban_hammers_ready_idx ON ban_hammers(owner_id) WHERE uses_left > 0;

-- wie is er met een hamer op iemand losgegaan
CREATE TABLE ban_hammer_uses (
    id SERIAL PRIMARY KEY,
    hammer_id INT NOT NULL,
    target_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (hammer_id) REFERENCES ban_hammers(id) ON DELETE CASCADE,
    FOREIGN KEY (target_id) REFERENCES users(id)
);

-- nep microtransactions, dus een "aankoop" met fictief geld
-- granted_by is NULL als de user het zelf gekocht heeft, anders de admin
CREATE TABLE microtransactions (
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
CREATE INDEX microtransactions_user_idx ON microtransactions(user_id, id DESC);

-- cosmetics, oftewel uiterlijk verward voor je eigen profiel
-- de catalogus zelf (prijzen, kleuren, klassen) staat als COSMETICS in src/server.js
CREATE TABLE user_cosmetics (
    user_id INT NOT NULL,
    item_key VARCHAR(50) NOT NULL,
    -- slot staat hier ook in, al staat het al in de catalogus. zo kan de
    -- database afdwingen dat je maar één cosmetic per slot draagt
    slot VARCHAR(20) NOT NULL,
    equipped BOOLEAN NOT NULL DEFAULT FALSE,
    acquired_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, item_key),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- per slot maximaal een dragen
CREATE UNIQUE INDEX user_cosmetics_one_per_slot ON user_cosmetics(user_id, slot) WHERE equipped;
CREATE INDEX user_cosmetics_equipped_idx ON user_cosmetics(user_id) WHERE equipped;

-- afbeeldingen, het bestand zelf staat in uploads/
CREATE TABLE images (
    id SERIAL PRIMARY KEY,
    uploader_id INT NOT NULL,
    filename VARCHAR(80) UNIQUE NOT NULL,
    mime VARCHAR(30) NOT NULL,
    byte_size INT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (uploader_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX images_uploader_idx ON images(uploader_id);

CREATE TABLE dm_message_images (
    message_id INT NOT NULL,
    image_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, image_id),
    FOREIGN KEY (message_id) REFERENCES personal_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);

CREATE TABLE team_message_images (
    message_id INT NOT NULL,
    image_id INT NOT NULL,
    position INT NOT NULL DEFAULT 0,
    PRIMARY KEY (message_id, image_id),
    FOREIGN KEY (message_id) REFERENCES team_messages(id) ON DELETE CASCADE,
    FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
);
