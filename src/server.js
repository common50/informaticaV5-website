require('dotenv').config({ quiet: true });
const express = require('express');
const { Pool } = require('pg');
const hashbrowns = require('bcrypt');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COOKIE = 'meow_session';
const SESSION_DAYS = 30;

// de gouden gebruiker, die is altijd admin
const ADMIN_USERNAME = 'whiskers';
const ADMIN_BAN_NOPE = 'leuk geprobeerd, maar jij bent nog steeds mijn pion, en ik jouw manipulator. dismissed';
const BOETE = 1000;

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES_PER_MESSAGE = 4;
const MAX_IMAGE_BYTES_PER_USER = 50 * 1024 * 1024;
const MAX_IMAGES_PER_USER = 200;

const IMAGE_TYPES = {
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/gif': { ext: 'gif', magic: [[0x47, 0x49, 0x46, 0x38]] },
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46], null, [0x57, 0x45, 0x42, 0x50]] }
};

//````` de winkel ``````
//
// dit is de hele catalogus, dus prijzen aanpassen doe je hier en nergens anders.
// elk item heeft een key (die in de database staat), een naam en een prijs.
// 'grant' zegt wat er bij een aankoop gebeurt, 'blurb' is voor de winkelruit.

// key moet overal hetzelfde blijven, anders ziet de database het niet als hetzelfde item
const SHOP_ITEMS = [
  { key: 'ban_hammer', name: '🔨 ban hamer', price: 5000, grant: 'ban_hammer', blurb: '1x gebruiken en dan is hij stuk' }
];

// cosmetics zijn de uiterlijke dingen, je koopt ze en doet ze aan.
// per slot (name_color, glow, frame) mag er maar eentje tegelijk aan staan,
// de database regelt dat met een partial unique index.
const COSMETICS = [
  { key: 'name_red', name: 'rode naam', slot: 'name_color', price: 500, value: { color: '#e5484d' }, blurb: 'jouw naam in het rood' },
  { key: 'name_green', name: 'groene naam', slot: 'name_color', price: 500, value: { color: '#3fa04f' }, blurb: 'groen, want groen' },
  { key: 'name_rainbow', name: 'regenboog naam', slot: 'name_color', price: 5000, value: { rainbow: true }, blurb: 'alle kleuren van de regenboog, duur maar wel' },

  { key: 'glow_gold', name: 'gouden gloed', slot: 'glow', price: 2500, value: { color: '#d9a441' }, blurb: 'een warme gouden gloed om je naam' },
  { key: 'glow_ice', name: 'ijs gloed', slot: 'glow', price: 2500, value: { color: '#6ec6ff' }, blurb: 'koud blauw, net als jouw hart' },

  { key: 'frame_cat', name: 'kattenoren', slot: 'frame', price: 750, value: { emoji: '🐱' }, blurb: 'ooren boven je naam, miauw' },
  { key: 'frame_crown', name: 'kroon', slot: 'frame', price: 10000, value: { emoji: '👑' }, blurb: 'alleen voor de echte poespunten' },
  { key: 'frame_devil', name: 'hoorns', slot: 'frame', price: 1500, value: { emoji: '😈' }, blurb: 'iedereen was ooit een keer slecht' }
];

// de kleuren en klassen uit de catalogus gaan naar de client, dus zorg dat
// het alleen maar kleuren zijn. als hier ooit iets anders in value komt te
// staan dan vangt deze het alsnog af
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;


app.use(express.json());
app.use(express.static('public'));


function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, NOW() + ($3 || \' days\')::interval)',
    [userId, hashToken(token), SESSION_DAYS]
  );
  setSessionCookie(res, token);
}

app.use(async (req, res, next) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return next();
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_admin, u.coins,
              EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id) AS is_banned,
              COALESCE((SELECT json_object_agg(c.slot, c.item_key)
                        FROM user_cosmetics c
                        WHERE c.user_id = u.id AND c.equipped), '{}'::json) AS equipped_keys
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashToken(token)]
    );
    if (result.rows.length > 0) {
      const u = result.rows[0];
      req.user = {
        id: u.id,
        username: u.username,
        email: u.email,
        is_admin: u.is_admin,
        coins: Number(u.coins),
        is_banned: u.is_banned,
        cosmetics: describeEquipped(u.equipped_keys)
      };
    }
    next();
  } catch (err) {
    next(err);
  }
});

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'log gewoon in ja' });
  if (req.user.is_banned) return res.status(403).json({ error: 'je bent eruit geflikt 😂🫵' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'log gewoon in ja' });
  if (!req.user.is_admin) return res.status(403).json({ error: 'DAT MAG JIJ NIET DOEN GRRR' });
  next();
}


app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query(
      `SELECT *, EXISTS (SELECT 1 FROM bans b WHERE b.user_id = users.id) AS is_banned
       FROM users WHERE username = $1`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ik kan de gebruiker niet vinden' });
    }

    const user = result.rows[0];
    const valid = await hashbrowns.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'het wachtwoord is FOUT' });
    }
    if (user.is_banned) {
      return res.status(403).json({ error: 'je bent eruit geflikt' });
    }

    await startSession(res, user.id);
    res.json({ user: { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin, coins: Number(user.coins) } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei iets is stuk gegaan (is sql server aan?)' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const hash = await hashbrowns.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, username, email, is_admin',
      [username, email, hash, username === ADMIN_USERNAME]
    );
    await startSession(res, result.rows[0].id);
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'registratie mislukt' });
  }
});

app.post('/api/password', requireAuth, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password || String(new_password).length < 4) {
      return res.status(400).json({ error: 'minimaal 4 tekens' });
    }
    const found = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (found.rows.length === 0) return res.status(404).json({ error: 'gebruiker bestaat niet' });
    if (!await hashbrowns.compare(String(current_password ?? ''), found.rows[0].password_hash)) {
      return res.status(401).json({ error: 'je huidige wachtwoord is fout' });
    }
    const hash = await hashbrowns.hash(String(new_password), 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'niet ingelogd' });
  res.json({ user: req.user });
});

//`````` pb ding ``````

app.get('/api/personal-messages', requireAuth, async (req, res) => {
  const me = req.user.id;
  const result = await pool.query(
    `SELECT pm.*,
       CASE WHEN pm.sender_id = $1 THEN recipient.username ELSE sender.username END AS other_username,
       CASE WHEN pm.sender_id = $1 THEN pm.recipient_id ELSE pm.sender_id END AS other_id
     FROM personal_messages pm
     JOIN users sender ON sender.id = pm.sender_id
     JOIN users recipient ON recipient.id = pm.recipient_id
     WHERE pm.sender_id = $1 OR pm.recipient_id = $1
     ORDER BY pm.id`,
    [me]
  );
  await attachCosmetics(result.rows, ['other_id', 'sender_id']);
  res.json(await withImages(result.rows, 'dm_message_images'));
});

app.post('/api/personal-messages', requireAuth, async (req, res) => {
  try {
    const { recipient_id, content, image_ids } = req.body;
    const text = String(content ?? '').trim();
    const images = Array.isArray(image_ids) ? image_ids.slice(0, MAX_IMAGES_PER_MESSAGE) : [];
    if (!text && images.length === 0) return res.status(400).json({ error: 'leeg bericht' });
    if (!recipient_id) return res.status(400).json({ error: 'aan wie?' });
    if (recipient_id === req.user.id) return res.status(400).json({ error: 'naar jezelf?' });

    const other = await pool.query('SELECT 1 FROM users WHERE id = $1', [recipient_id]);
    if (other.rows.length === 0) return res.status(404).json({ error: 'die user bestaat niet' });

    const blocked = await sendBlock(req.user.id, threadKey(req.user.id, recipient_id));
    if (blocked) return res.status(blocked.code).json({ error: blocked.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO personal_messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING id, sender_id, recipient_id, content, created_at',
        [req.user.id, recipient_id, text]
      );
      const message = result.rows[0];
      message.image_ids = await linkImages(client, 'dm_message_images', message.id, images, req.user.id);
      await client.query('COMMIT');
      res.json(message);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

//`````` gebruikers zoeken (voor de vrienden-dingen) ``````

app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const result = await pool.query(
      'SELECT id, username FROM users WHERE username ILIKE $1 ORDER BY username LIMIT 20',
      [`%${q}%`]
    );
    res.json(await attachCosmetics(result.rows, ['id']));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});


app.get('/api/friends', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const [accepted, incoming, outgoing] = await Promise.all([
      pool.query(
        `SELECT f.friend_id AS other_id, u.username AS other_username, f.created_at
         FROM friends f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1 AND f.status = 'accepted'`,
        [userId]
      ),
      pool.query(
        `SELECT f.user_id AS other_id, u.username AS other_username, f.created_at
         FROM friends f JOIN users u ON u.id = f.user_id
         WHERE f.friend_id = $1 AND f.status = 'pending'`,
        [userId]
      ),
      pool.query(
        `SELECT f.friend_id AS other_id, u.username AS other_username, f.created_at
         FROM friends f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = $1 AND f.status = 'pending'`,
        [userId]
      )
    ]);

    await attachCosmetics(accepted.rows, ['other_id']);
    await attachCosmetics(incoming.rows, ['other_id']);
    await attachCosmetics(outgoing.rows, ['other_id']);

    res.json({ friends: accepted.rows, incoming: incoming.rows, outgoing: outgoing.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

// vriendverzoek sturen.
// als de ander jou AL had gevraagd, wordt het verzoek meteen geaccepteerd.
app.post('/api/friends', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user_id = req.user.id;
    const { friend_id } = req.body;
    if (!friend_id || user_id === friend_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'iets klopt niet' });
    }

    const reverse = await client.query(
      `SELECT id FROM friends WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
      [friend_id, user_id]
    );

    if (reverse.rows.length > 0) {
      await client.query('UPDATE friends SET status = $1 WHERE id = $2', ['accepted', reverse.rows[0].id]);
      await client.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [user_id, friend_id]
      );
    } else {
      await client.query(
        `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'pending')
         ON CONFLICT (user_id, friend_id) DO NOTHING`,
        [user_id, friend_id]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'oei' });
  } finally {
    client.release();
  }
});

// vriendverzoek accepteren (user_id = degene die accepteert, friend_id = degene die vroeg)
app.post('/api/friends/accept', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const user_id = req.user.id;
    const { friend_id } = req.body;

    await client.query(
      `UPDATE friends SET status = 'accepted' WHERE user_id = $1 AND friend_id = $2 AND status = 'pending'`,
      [friend_id, user_id]
    );
    await client.query(
      `INSERT INTO friends (user_id, friend_id, status) VALUES ($1, $2, 'accepted')
       ON CONFLICT (user_id, friend_id) DO NOTHING`,
      [user_id, friend_id]
    );

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'oei' });
  } finally {
    client.release();
  }
});

// vriendschap verbreken of verzoek afwijzen
app.delete('/api/friends', requireAuth, async (req, res) => {
  try {
    const user_id = req.user.id;
    const { friend_id } = req.body;
    await pool.query(
      `DELETE FROM friends WHERE (user_id = $1 AND friend_id = $2) OR (user_id = $2 AND friend_id = $1)`,
      [user_id, friend_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});


app.get('/api/teams', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.id, t.name, t.owner_id, u.username AS owner_username,
              EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = $1) AS joined,
              (SELECT COUNT(*)::int FROM team_members m WHERE m.team_id = t.id) AS member_count
       FROM teams t JOIN users u ON u.id = t.owner_id
       ORDER BY t.name`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/teams', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'heet wat dan' });
    if (name.length > 100) return res.status(400).json({ error: 'die naam is wel heel lang' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const team = await client.query(
        'INSERT INTO teams (name, owner_id) VALUES ($1, $2) RETURNING id, name, owner_id',
        [name, req.user.id]
      );
      await client.query('INSERT INTO team_members (team_id, user_id) VALUES ($1, $2)', [team.rows[0].id, req.user.id]);
      await client.query('COMMIT');
      res.json({ team: team.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'team maken mislukt' });
  }
});

app.post('/api/teams/:id/join', requireAuth, async (req, res) => {
  try {
    await pool.query(
      'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT (team_id, user_id) DO NOTHING',
      [req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.delete('/api/teams/:id/leave', requireAuth, async (req, res) => {
  try {
    await pool.query('DELETE FROM team_members WHERE team_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.get('/api/teams/:id/members', requireAuth, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'je zit niet in dit team' });

    const result = await pool.query(
      `SELECT u.id, u.username, (t.owner_id = u.id) AS is_owner
       FROM team_members m
       JOIN users u ON u.id = m.user_id
       JOIN teams t ON t.id = m.team_id
       WHERE m.team_id = $1 ORDER BY u.username`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.get('/api/teams/:id/messages', requireAuth, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'je zit niet in dit team' });

    const result = await pool.query(
      `SELECT tm.*, u.username AS sender_username
       FROM team_messages tm JOIN users u ON u.id = tm.sender_id
       WHERE tm.team_id = $1 ORDER BY tm.id`,
      [req.params.id]
    );
    await attachCosmetics(result.rows, ['sender_id']);
    res.json(await withImages(result.rows, 'team_message_images'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/teams/:id/messages', requireAuth, async (req, res) => {
  try {
    const member = await pool.query(
      'SELECT 1 FROM team_members WHERE team_id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (member.rows.length === 0) return res.status(403).json({ error: 'je zit niet in dit team' });

    const text = String(req.body.content ?? '').trim();
    const images = Array.isArray(req.body.image_ids) ? req.body.image_ids.slice(0, MAX_IMAGES_PER_MESSAGE) : [];
    if (!text && images.length === 0) return res.status(400).json({ error: 'leeg bericht' });

    const blocked = await sendBlock(req.user.id);
    if (blocked) return res.status(blocked.code).json({ error: blocked.error });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        'INSERT INTO team_messages (team_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, team_id, sender_id, content, created_at',
        [req.params.id, req.user.id, text]
      );
      const message = result.rows[0];
      message.image_ids = await linkImages(client, 'team_message_images', message.id, images, req.user.id);
      await client.query('COMMIT');
      res.json(message);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});


function sniffImageType(buf) {
  for (const [mime, spec] of Object.entries(IMAGE_TYPES)) {
    let at = 0;
    let ok = true;
    for (const seq of spec.magic) {
      if (seq === null) continue;
      for (let i = 0; i < seq.length; i++) {
        if (buf[at + i] !== seq[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) break;
      at += seq.length;
    }
    if (ok) return mime;
  }
  return null;
}

function mb(bytes) {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

const IMAGE_LINKS = new Set(['dm_message_images', 'team_message_images']);

async function linkImages(client, table, messageId, imageIds, uploaderId) {
  if (!IMAGE_LINKS.has(table)) throw new Error('onbekende tabel');
  const ids = [...new Set((Array.isArray(imageIds) ? imageIds : []).map(Number).filter(Number.isInteger))]
    .slice(0, MAX_IMAGES_PER_MESSAGE);
  if (ids.length === 0) return [];

  const owned = await client.query('SELECT id FROM images WHERE id = ANY($1) AND uploader_id = $2', [ids, uploaderId]);
  const mine = owned.rows.map((r) => r.id);
  for (let i = 0; i < mine.length; i++) {
    await client.query(
      `INSERT INTO ${table} (message_id, image_id, position) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [messageId, mine[i], i]
    );
  }
  return mine;
}

app.post('/api/images', requireAuth, express.raw({
  type: Object.keys(IMAGE_TYPES),
  limit: MAX_IMAGE_BYTES
}), async (req, res) => {
  const buf = req.body;
  const claimed = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    if (claimed && !IMAGE_TYPES[claimed]) {
      return res.status(415).json({ error: 'alleen png, jpg, gif en webp' });
    }
    return res.status(400).json({ error: 'geen afbeelding ontvangen' });
  }
  const mime = sniffImageType(buf);
  if (!mime) {
    return res.status(415).json({ error: 'alleen png, jpg, gif en webp' });
  }

  const usage = await pool.query(
    'SELECT COALESCE(SUM(byte_size), 0)::bigint AS bytes, COUNT(*)::bigint AS count FROM images WHERE uploader_id = $1',
    [req.user.id]
  );
  const used = usage.rows[0];
  if (Number(used.count) >= MAX_IMAGES_PER_USER) {
    return res.status(413).json({ error: `je hebt al ${MAX_IMAGES_PER_USER} plaatjes, ruim wat op` });
  }
  if (Number(used.bytes) + buf.length > MAX_IMAGE_BYTES_PER_USER) {
    const vrije = Math.max(0, MAX_IMAGE_BYTES_PER_USER - Number(used.bytes));
    return res.status(413).json({ error: `je hebt nog ${mb(vrije)} van je ${mb(MAX_IMAGE_BYTES_PER_USER)} plaatjesruimte over` });
  }

  const filename = `${crypto.randomBytes(16).toString('hex')}.${IMAGE_TYPES[mime].ext}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);

  try {
    const result = await pool.query(
      'INSERT INTO images (uploader_id, filename, mime, byte_size) VALUES ($1, $2, $3, $4) RETURNING id, mime, byte_size',
      [req.user.id, filename, mime, buf.length]
    );
    res.json(result.rows[0]);
  } catch (err) {
    fs.rm(path.join(UPLOAD_DIR, filename), { force: true }, () => {});
    console.error(err);
    res.status(500).json({ error: 'opslaan mislukt' });
  }
});

app.get('/api/images/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'geen geldige id' });

    const result = await pool.query(
      `SELECT i.filename, i.mime, i.byte_size
       FROM images i
       WHERE i.id = $1 AND (
         i.uploader_id = $2
         OR $3
         OR EXISTS (
           SELECT 1 FROM dm_message_images mi
           JOIN personal_messages pm ON pm.id = mi.message_id
           WHERE mi.image_id = i.id AND (pm.sender_id = $2 OR pm.recipient_id = $2)
         )
         OR EXISTS (
           SELECT 1 FROM team_message_images mi
           JOIN team_messages tm ON tm.id = mi.message_id
           WHERE mi.image_id = i.id
             AND EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = tm.team_id AND m.user_id = $2)
         )
       )`,
      [id, req.user.id, req.user.is_admin]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'afbeelding bestaat niet (of niet voor jou)' });
    }

    const img = result.rows[0];
    const file = path.join(UPLOAD_DIR, path.basename(img.filename));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'afbeelding weg van schijf' });

    res.setHeader('Content-Type', img.mime);
    res.setHeader('Content-Length', img.byte_size);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.delete('/api/images/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'geen geldige id' });

    const result = await pool.query(
      'DELETE FROM images WHERE id = $1 AND uploader_id = $2 RETURNING filename',
      [id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'niet jouw afbeelding' });

    fs.rm(path.join(UPLOAD_DIR, path.basename(result.rows[0].filename)), { force: true }, () => {});
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/images/sweep', requireAuth, async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const orphans = await pool.query(
      `DELETE FROM images i
       WHERE i.uploader_id = $1
         AND i.created_at < $2
         AND NOT EXISTS (SELECT 1 FROM dm_message_images mi WHERE mi.image_id = i.id)
         AND NOT EXISTS (SELECT 1 FROM team_message_images mi WHERE mi.image_id = i.id)
       RETURNING filename`,
      [req.user.id, cutoff]
    );
    for (const row of orphans.rows) {
      fs.rm(path.join(UPLOAD_DIR, path.basename(row.filename)), { force: true }, () => {});
    }
    res.json({ removed: orphans.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});


//````` winkel, cosmetic uitlezen ``````

// alles wat te koop is, dus gewone items plus cosmetics
function shopCatalog() {
  return [...SHOP_ITEMS, ...COSMETICS.map((c) => ({ ...c, grant: 'cosmetic' }))];
}

function shopItem(key) {
  return shopCatalog().find((i) => i.key === key) ?? null;
}

function cosmeticByKey(key) {
  return COSMETICS.find((c) => c.key === key) ?? null;
}

// { name_color: 'name_red' } -> { name_color: { key: 'name_red', value: { color: '#e5484d' } } }
// dit is wat de client nodig heeft om iets te tekenen, dus hier vertalen we
// de key uit de database naar wat het eigenlijk is
function describeEquipped(keys) {
  const out = {};
  for (const [slot, key] of Object.entries(keys ?? {})) {
    const cosmetic = cosmeticByKey(key);
    // cosmetic bestaat niet meer in de catalogus, of hij hoort niet in dit
    // slot: dan doen we alsof hij er niet is, anders gaat de client raar doen
    if (!cosmetic || cosmetic.slot !== slot) continue;
    out[slot] = { key, value: cosmetic.value };
  }
  return out;
}

async function equippedCosmetics(userId) {
  const result = await pool.query(
    'SELECT slot, item_key FROM user_cosmetics WHERE user_id = $1 AND equipped',
    [userId]
  );
  return describeEquipped(Object.fromEntries(result.rows.map((r) => [r.slot, r.item_key])));
}

// voor lijsten: haal in een keer de cosmetics van alle users op en plak ze
// eraan. je kunt zelf meerdere id velden meegeven, elk krijgt een veld erbij
// zoals 'other_id' -> 'other_id_cosmetics'
async function attachCosmetics(rows, idFields) {
  const ids = new Set();
  for (const field of idFields) {
    for (const row of rows) {
      if (row[field] != null) ids.add(row[field]);
    }
  }
  if (ids.size === 0) return rows;

  const result = await pool.query(
    'SELECT user_id, slot, item_key FROM user_cosmetics WHERE equipped AND user_id = ANY($1::int[])',
    [[...ids]]
  );
  const keysPerUser = new Map();
  for (const row of result.rows) {
    if (!keysPerUser.has(row.user_id)) keysPerUser.set(row.user_id, {});
    keysPerUser.get(row.user_id)[row.slot] = row.item_key;
  }

  for (const row of rows) {
    for (const field of idFields) {
      if (row[field] != null) row[`${field}_cosmetics`] = describeEquipped(keysPerUser.get(row[field]));
    }
  }
  return rows;
}

function grantItem(client, item, userId, grantedBy) {
  if (item.grant === 'ban_hammer') {
    return client
      .query('INSERT INTO ban_hammers (owner_id, given_by) VALUES ($1, $2) RETURNING id, uses_left', [userId, grantedBy])
      .then((r) => r.rows[0]);
  }
  if (item.grant === 'cosmetic') {
    // bezit blijft, dus als je hem al had staan we gewoon niets te doen.
    // de slot nemen we uit de catalogus, maar alleen als hij niet gedragen
    // wordt: een gedragen item verhuizen zou de unique index kunnen klappen
    return client
      .query(
        `INSERT INTO user_cosmetics (user_id, item_key, slot) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, item_key) DO UPDATE SET slot = EXCLUDED.slot
         WHERE user_cosmetics.equipped = FALSE`,
        [userId, item.key, item.slot]
      )
      .then(() => ({ cosmetic: item.key }));
  }
  return Promise.resolve(null);
}

function revokeItem(client, item, userId) {
  if (item.grant === 'ban_hammer') {
    return client
      .query('DELETE FROM ban_hammers WHERE owner_id = $1 RETURNING id', [userId])
      .then((r) => r.rowCount);
  }
  if (item.grant === 'cosmetic') {
    return client
      .query('DELETE FROM user_cosmetics WHERE user_id = $1 AND item_key = $2 RETURNING item_key', [userId, item.key])
      .then((r) => r.rowCount);
  }
  return Promise.resolve(0);
}

app.get('/api/shop', requireAuth, async (req, res) => {
  try {
    const [coins, hammers, owned, historyResult] = await Promise.all([
      pool.query('SELECT coins FROM users WHERE id = $1', [req.user.id]),
      pool.query(
        'SELECT id, uses_left, created_at FROM ban_hammers WHERE owner_id = $1 ORDER BY id DESC',
        [req.user.id]
      ),
      pool.query(
        'SELECT item_key, slot, equipped, acquired_at FROM user_cosmetics WHERE user_id = $1 ORDER BY acquired_at',
        [req.user.id]
      ),
      pool.query(
        `SELECT item_key, item_name, price, created_at
         FROM microtransactions WHERE user_id = $1 ORDER BY id DESC LIMIT 25`,
        [req.user.id]
      )
    ]);

    const history = historyResult.rows.map((r) => ({ ...r, price: Number(r.price) }));

    res.json({
      items: shopCatalog(),
      coins: Number(coins.rows[0]?.coins ?? 0),
      hammers: hammers.rows.map((h) => ({ ...h, uses_left: Number(h.uses_left) })),
      cosmetics: owned.rows,
      equipped: await equippedCosmetics(req.user.id),
      history
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/shop/buy', requireAuth, async (req, res) => {
  const item = shopItem(String(req.body?.item_key ?? ''));
  if (!item) return res.status(400).json({ error: 'onbekend item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // cosmetic heb je al? dan koop je hem niet nog een keer
    if (item.grant === 'cosmetic') {
      const owned = await client.query(
        'SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND item_key = $2',
        [req.user.id, item.key]
      );
      if (owned.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'die heb je al 😿' });
      }
    }

    const paid = await client.query(
      'UPDATE users SET coins = coins - $1 WHERE id = $2 AND coins >= $1 RETURNING coins',
      [item.price, req.user.id]
    );
    if (paid.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(402).json({ error: 'niet genoeg poespunten 😿' });
    }

    await client.query(
      `INSERT INTO microtransactions (user_id, item_key, item_name, price, granted_by)
       VALUES ($1, $2, $3, $4, NULL)`,
      [req.user.id, item.key, item.name, item.price]
    );

    const granted = await grantItem(client, item, req.user.id, req.user.id);

    await client.query('COMMIT');
    res.json({
      ok: true,
      coins: Number(paid.rows[0].coins),
      granted,
      item_key: item.key,
      equipped: await equippedCosmetics(req.user.id)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'aankoop mislukt' });
  } finally {
    client.release();
  }
});

//````` cosmetic aan en uitdoen ```````

app.post('/api/cosmetics/equip', requireAuth, async (req, res) => {
  const cosmetic = cosmeticByKey(String(req.body?.item_key ?? ''));
  if (!cosmetic) return res.status(400).json({ error: 'onbekende cosmetic' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const owned = await client.query(
      'SELECT 1 FROM user_cosmetics WHERE user_id = $1 AND item_key = $2',
      [req.user.id, cosmetic.key]
    );
    if (owned.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'die heb je niet, koop hem eerst 😿' });
    }

    // eerst het slot uit de catalogus wegschrijven, dan pas omzetten. zo repareert
    // een item dat in server.js naar een ander slot is verhuist zichzelf.
    // equipped gaat hierbij ook even uit, anders zou de unique index kunnen
    // klappen als je een gedragen item naar een slot verhuist waar al iets
    // gedragen wordt. twee stappen verder zetten we het weer aan
    await client.query(
      `INSERT INTO user_cosmetics (user_id, item_key, slot, equipped) VALUES ($1, $2, $3, FALSE)
       ON CONFLICT (user_id, item_key) DO UPDATE SET slot = EXCLUDED.slot, equipped = FALSE`,
      [req.user.id, cosmetic.key, cosmetic.slot]
    );

    // twee losse statements, in deze volgorde. in een enkele update zou de
    // unique index kunnen klappen omdat hij niet weet welke rij hij als
    // eerste tegenkomt
    await client.query(
      'UPDATE user_cosmetics SET equipped = FALSE WHERE user_id = $1 AND slot = $2',
      [req.user.id, cosmetic.slot]
    );
    await client.query(
      'UPDATE user_cosmetics SET equipped = TRUE WHERE user_id = $1 AND item_key = $2',
      [req.user.id, cosmetic.key]
    );

    await client.query('COMMIT');
    res.json({ ok: true, equipped: await equippedCosmetics(req.user.id) });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'aandoen mislukt' });
  } finally {
    client.release();
  }
});

app.post('/api/cosmetics/unequip', requireAuth, async (req, res) => {
  const cosmetic = cosmeticByKey(String(req.body?.item_key ?? ''));
  if (!cosmetic) return res.status(400).json({ error: 'onbekende cosmetic' });

  try {
    await pool.query(
      'UPDATE user_cosmetics SET equipped = FALSE WHERE user_id = $1 AND item_key = $2',
      [req.user.id, cosmetic.key]
    );
    res.json({ ok: true, equipped: await equippedCosmetics(req.user.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'uitdoen mislukt' });
  }
});

app.post('/api/hammer/:id/use', requireAuth, async (req, res) => {
  const targetId = Number(req.body?.target_id);
  if (!Number.isInteger(targetId)) return res.status(400).json({ error: 'op wie?' });
  if (targetId === req.user.id) return res.status(400).json({ error: 'doe maar niet aan jezelf' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query('SELECT id, username, is_admin FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'die user bestaat niet' });
    }
    if (isProtected(target.rows[0])) {
      const over = await straf(client, req.user.id);
      await client.query('COMMIT');
      return res.status(403).json({ error: strafMelding(over) });
    }

    const hammer = await client.query(
      'UPDATE ban_hammers SET uses_left = uses_left - 1 WHERE id = $1 AND owner_id = $2 AND uses_left > 0 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (hammer.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'geen bruikbare hammer van jou' });
    }

    const banned = await client.query('SELECT 1 FROM bans WHERE user_id = $1', [targetId]);
    if (banned.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'die user is al verbannen' });
    }

    await client.query('INSERT INTO ban_hammer_uses (hammer_id, target_id) VALUES ($1, $2)', [hammer.rows[0].id, targetId]);
    await client.query(
      'INSERT INTO bans (user_id, banned_by, reason) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
      [targetId, req.user.id, 'ban hammer 🔨']
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [targetId]);

    await client.query('COMMIT');
    res.json({ ok: true, target: target.rows[0].username, uses_left: 0 });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'hammer mislukt' });
  } finally {
    client.release();
  }
});

async function withImages(rows, table) {
  if (!IMAGE_LINKS.has(table) || rows.length === 0) return rows;
  const links = await pool.query(
    `SELECT message_id, image_id FROM ${table} WHERE message_id = ANY($1) ORDER BY position`,
    [rows.map((r) => r.id)]
  );
  const perMessage = new Map();
  for (const l of links.rows) {
    if (!perMessage.has(l.message_id)) perMessage.set(l.message_id, []);
    perMessage.get(l.message_id).push(l.image_id);
  }
  for (const r of rows) r.image_ids = perMessage.get(r.id) ?? [];
  return rows;
}

//`````` moderatie, alleen voor de admin (whiskers) ``````

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_admin, u.coins,
              EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id) AS is_banned,
              (SELECT b.reason FROM bans b WHERE b.user_id = u.id) AS ban_reason,
              EXISTS (SELECT 1 FROM mutes m WHERE m.user_id = u.id) AS is_muted,
              (SELECT m.reason FROM mutes m WHERE m.user_id = u.id) AS mute_reason,
              (SELECT COUNT(*) FROM ban_hammers bh WHERE bh.owner_id = u.id) AS hammers
       FROM users u ORDER BY u.username`
    );
    res.json(await attachCosmetics(result.rows, ['id']));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/admin/users/:id/mute', requireAdmin, async (req, res) => {
  if (await moderationTarget(req, res)) return;
  try {
    await pool.query(
      `INSERT INTO mutes (user_id, muted_by, reason) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET muted_by = EXCLUDED.muted_by, reason = EXCLUDED.reason`,
      [req.params.id, req.user.id, req.body.reason || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.delete('/api/admin/users/:id/mute', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM mutes WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  if (await moderationTarget(req, res, true)) return;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO bans (user_id, banned_by, reason) VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET banned_by = EXCLUDED.banned_by, reason = EXCLUDED.reason`,
        [req.params.id, req.user.id, req.body.reason || null]
      );
      await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.delete('/api/admin/users/:id/ban', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM bans WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/admin/users/:id/coins', requireAdmin, async (req, res) => {
  try {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: 'geef een heel getal' });
    if (Math.abs(amount) > 1_000_000) return res.status(400).json({ error: 'dat zijn veel poespunten' });

    const result = await pool.query(
      'UPDATE users SET coins = coins + $1 WHERE id = $2 RETURNING id, coins',
      [amount, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'gebruiker bestaat niet' });
    res.json({ ok: true, coins: Number(result.rows[0].coins) });
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'dat zou een negatief saldo geven' });
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.post('/api/admin/users/:id/items', requireAdmin, async (req, res) => {
  const item = shopItem(String(req.body?.item_key ?? ''));
  if (!item) return res.status(400).json({ error: 'onbekend item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'gebruiker bestaat niet' });
    }

    await client.query(
      `INSERT INTO microtransactions (user_id, item_key, item_name, price, granted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.params.id, item.key, item.name, 0, req.user.id]
    );

    const granted = await grantItem(client, item, req.params.id, req.user.id);

    await client.query('COMMIT');
    res.json({ ok: true, granted, item_key: item.key });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'geven mislukt' });
  } finally {
    client.release();
  }
});

app.delete('/api/admin/users/:id/items', requireAdmin, async (req, res) => {
  const item = shopItem(String(req.body?.item_key ?? req.query.item_key ?? ''));
  if (!item) return res.status(400).json({ error: 'onbekend item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query('SELECT id FROM users WHERE id = $1', [req.params.id]);
    if (target.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'gebruiker bestaat niet' });
    }

    const weggenomen = await revokeItem(client, item, req.params.id);

    await client.query('COMMIT');
    res.json({ ok: true, weggenomen, item_key: item.key });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'wegnemen mislukt' });
  } finally {
    client.release();
  }
});

// alle gesprekken op de server, voor de admin
app.get('/api/admin/conversations', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `WITH t AS (
         SELECT LEAST(sender_id, recipient_id) AS a,
                GREATEST(sender_id, recipient_id) AS b,
                COUNT(*)::int AS message_count,
                MAX(id) AS last_id,
                MAX(created_at) AS last_at
         FROM personal_messages GROUP BY 1, 2
       )
       SELECT t.*, ua.username AS a_username, ub.username AS b_username,
              (SELECT content FROM personal_messages p WHERE p.id = t.last_id) AS preview
       FROM t
       JOIN users ua ON ua.id = t.a
       JOIN users ub ON ub.id = t.b
       ORDER BY t.last_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.get('/api/admin/conversations/:a/:b', requireAdmin, async (req, res) => {
  try {
    const a = Number(req.params.a);
    const b = Number(req.params.b);
    if (!a || !b || a === b) return res.status(400).json({ error: 'twee verschillende users graag' });

    const result = await pool.query(
      `SELECT pm.*, sender.username AS sender_username, recipient.username AS recipient_username
       FROM personal_messages pm
       JOIN users sender ON sender.id = pm.sender_id
       JOIN users recipient ON recipient.id = pm.recipient_id
       WHERE (pm.sender_id = $1 AND pm.recipient_id = $2) OR (pm.sender_id = $2 AND pm.recipient_id = $1)
       ORDER BY pm.id`,
      [a, b]
    );
    res.json(await withImages(result.rows, 'dm_message_images'));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

// demute iemand in 1 specifiek gesprek
app.post('/api/admin/dm-mutes', requireAdmin, async (req, res) => {
  try {
    const a = Number(req.body.user_a);
    const b = Number(req.body.user_b);
    const target = Number(req.body.user_id);
    if (!a || !b || a === b) return res.status(400).json({ error: 'twee verschillende users graag' });
    if (target !== a && target !== b) return res.status(400).json({ error: 'die user zit niet in dat gesprek' });

    await pool.query(
      `INSERT INTO dm_mutes (thread_key, user_id, muted_by, reason) VALUES ($1, $2, $3, $4)
       ON CONFLICT (thread_key, user_id)
       DO UPDATE SET muted_by = EXCLUDED.muted_by, reason = EXCLUDED.reason`,
      [threadKey(a, b), target, req.user.id, req.body.reason || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.delete('/api/admin/dm-mutes/:a/:b/:userId', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM dm_mutes WHERE thread_key = $1 AND user_id = $2', [
      threadKey(Number(req.params.a), Number(req.params.b)),
      req.params.userId
    ]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

app.get('/api/admin/dm-mutes', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dm.*, ua.username AS a_username, ub.username AS b_username
       FROM dm_mutes dm
       JOIN users ua ON ua.id = SPLIT_PART(dm.thread_key, ':', 1)::int
       JOIN users ub ON ub.id = SPLIT_PART(dm.thread_key, ':', 2)::int
       ORDER BY dm.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

//`````````````````````````````````````````````````````````````````````````````````````````````````````

function threadKey(a, b) {
  const x = Number(a);
  const y = Number(b);
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

// een gemute of verbannen user mag nergens meer iets sturen
async function sendBlock(userId, key) {
  const mute = await pool.query('SELECT reason FROM mutes WHERE user_id = $1', [userId]);
  if (mute.rows.length > 0) {
    return { code: 403, error: `je bent gemute op de hele server${mute.rows[0].reason ? `: ${mute.rows[0].reason}` : ''}` };
  }
  if (key) {
    const dm = await pool.query('SELECT reason FROM dm_mutes WHERE thread_key = $1 AND user_id = $2', [key, userId]);
    if (dm.rows.length > 0) {
      return { code: 403, error: `je bent gemute in dit gesprek${dm.rows[0].reason ? `: ${dm.rows[0].reason}` : ''}` };
    }
  }
  return null;
}

async function moderationTarget(req, res, metStraf = false) {
  if (Number(req.params.id) === req.user.id) {
    res.status(400).json({ error: 'doe maar niet aan jezelf' });
    return true;
  }
  const target = await pool.query('SELECT is_admin, username FROM users WHERE id = $1', [req.params.id]);
  if (target.rows.length === 0) {
    res.status(404).json({ error: 'gebruiker bestaat niet' });
    return true;
  }
  if (isProtected(target.rows[0])) {
    let fout = 'een admin kun je niet demoten of verbannen';
    if (metStraf) fout = await strafVoorPoging(req.user.id);
    res.status(403).json({ error: fout });
    return true;
  }
  return false;
}

function isProtected(user) {
  return user.is_admin || user.username === ADMIN_USERNAME;
}

async function straf(client, boetenaarId) {
  await client.query('DELETE FROM ban_hammers WHERE owner_id = $1', [boetenaarId]);
  const boete = await client.query(
    'UPDATE users SET coins = GREATEST(0, coins - $1) WHERE id = $2 RETURNING coins',
    [BOETE, boetenaarId]
  );
  return Number(boete.rows[0]?.coins ?? 0);
}

function strafMelding(over) {
  return `${ADMIN_BAN_NOPE} je hammer is weg en ${BOETE} poespunten boete, je hebt nog ${over} over.`;
}

async function strafVoorPoging(boetenaarId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const over = await straf(client, boetenaarId);
    await client.query('COMMIT');
    return strafMelding(over);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return ADMIN_BAN_NOPE;
  } finally {
    client.release();
  }
}

async function ensureAdmin() {
  const result = await pool.query(
    'UPDATE users SET is_admin = TRUE WHERE username = $1 AND is_admin = FALSE RETURNING id',
    [ADMIN_USERNAME]
  );
  if (result.rows.length > 0) {
    console.log(`${ADMIN_USERNAME} (id ${result.rows[0].id}) is admin gemaakt`);
  }
}

app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'afbeelding is te groot (max 5MB)' });
  }
  if (err?.type === 'encoding.unsupported' || err?.status === 415) {
    return res.status(415).json({ error: 'alleen png, jpg, gif en webp' });
  }
  next(err);
});

// even de catalogus controleren, want een tikfout in een kleur of prijs is
// lastig te vinden als je alleen maar naar een rare naam kijkt
function checkCatalog() {
  const seen = new Set();
  for (const item of [...SHOP_ITEMS, ...COSMETICS]) {
    if (!item.key || !/^[a-z0-9_]+$/.test(item.key)) throw new Error(`catalogus: key "${item.key}" is niet lowercase`);
    if (seen.has(item.key)) throw new Error(`catalogus: key "${item.key}" staat er twee keer in`);
    seen.add(item.key);
    if (!Number.isInteger(item.price) || item.price < 0) throw new Error(`catalogus: prijs van "${item.key}" is geen heel getal`);
    if (item.key.length > 50) throw new Error(`catalogus: key "${item.key}" is te lang voor de kolom (max 50)`);
  }
  for (const cosmetic of COSMETICS) {
    if (!cosmetic.slot) throw new Error(`catalogus: cosmetic "${cosmetic.key}" heeft geen slot`);
    if (cosmetic.slot.length > 20) throw new Error(`catalogus: slot van "${cosmetic.key}" is te lang voor de kolom (max 20)`);
    for (const [eigenschap, waarde] of Object.entries(cosmetic.value ?? {})) {
      // de hele value gaat naar de client, dus controleer dat het kleuren zijn
      if (eigenschap === 'color' && !HEX_COLOR.test(waarde)) {
        throw new Error(`catalogus: color van "${cosmetic.key}" is geen #rrggbb`);
      }
    }
  }
}

const PORT = process.env.PORT || 3000;

try {
  checkCatalog();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

app.listen(PORT, async () => {
  console.log(`server runt nu (hopelijk) op http://localhost:${PORT}`);
  try {
    await ensureAdmin();
  } catch (err) {
    console.error('kon whiskers niet admin maken:', err.message);
  }
});
