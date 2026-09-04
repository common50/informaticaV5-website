-- uhh schema voor nu ik weet niet

-- heb hier lagesleutel een tutorial voor gevolgd want naast
-- sql injecties bak ik er niet zo heel veel van helaas

-- trwns ik doe de code in het engels want alle documentatie is in het engels

-- gebruikers
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- producten
CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2),
    created_at TIMESTAMP DEFAULT NOW()
);

-- derde type ik moet nog uitvogelen wat het wordt
CREATE TABLE user_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW()
);
