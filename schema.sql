-- uhh schema voor nu ik weet niet

-- heb hier lagesleutel een tutorial voor gevolgd want naast
-- sql injecties bak ik er niet zo heel veel van helaas

-- trwns ik doe de code in het engels want alle documentatie is in het engels

-- dit bestand is de complete stand voor een NIEUWE database
-- voor een bestaande database draai je migrations/002_chats.sql

-- test acc en ww:
-- mittens: iLoveF1sh!

-- gebruikers
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
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
