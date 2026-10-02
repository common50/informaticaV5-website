require('dotenv').config({ quiet: true });
const express = require('express');
const { Pool } = require('pg');
const hashbrowns = require('bcrypt');
const crypto = require('crypto');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const COOKIE = 'meow_session';
const SESSION_DAYS = 30;

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
      `SELECT u.id, u.username, u.email, u.is_admin,
              EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id) AS is_banned
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashToken(token)]
    );
    if (result.rows.length > 0) {
      const u = result.rows[0];
      req.user = { id: u.id, username: u.username, email: u.email, is_admin: u.is_admin, is_banned: u.is_banned };
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
    res.json({ user: { id: user.id, username: user.username, email: user.email, is_admin: user.is_admin } });
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
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, is_admin',
      [username, email, hash]
    );
    await startSession(res, result.rows[0].id);
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'registratie mislukt' });
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
       CASE WHEN pm.sender_id = $1 THEN recipient.username ELSE sender.username END AS other_username
     FROM personal_messages pm
     JOIN users sender ON sender.id = pm.sender_id
     JOIN users recipient ON recipient.id = pm.recipient_id
     WHERE pm.sender_id = $1 OR pm.recipient_id = $1
     ORDER BY pm.id`,
    [me]
  );
  res.json(result.rows);
});

app.post('/api/personal-messages', requireAuth, async (req, res) => {
  try {
    const { recipient_id, content } = req.body;
    const text = String(content ?? '').trim();
    if (!text) return res.status(400).json({ error: 'leeg bericht' });
    if (!recipient_id) return res.status(400).json({ error: 'aan wie?' });
    if (recipient_id === req.user.id) return res.status(400).json({ error: 'naar jezelf?' });

    const other = await pool.query('SELECT 1 FROM users WHERE id = $1', [recipient_id]);
    if (other.rows.length === 0) return res.status(404).json({ error: 'die user bestaat niet' });

    const blocked = await sendBlock(req.user.id, threadKey(req.user.id, recipient_id));
    if (blocked) return res.status(blocked.code).json({ error: blocked.error });

    const result = await pool.query(
      'INSERT INTO personal_messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING id, sender_id, recipient_id, content, created_at',
      [req.user.id, recipient_id, text]
    );
    res.json(result.rows[0]);
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
    res.json(result.rows);
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
    res.json(result.rows);
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
    if (!text) return res.status(400).json({ error: 'leeg bericht' });

    const blocked = await sendBlock(req.user.id);
    if (blocked) return res.status(blocked.code).json({ error: blocked.error });

    const result = await pool.query(
      'INSERT INTO team_messages (team_id, sender_id, content) VALUES ($1, $2, $3) RETURNING id, team_id, sender_id, content, created_at',
      [req.params.id, req.user.id, text]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

//`````` moderatie, alleen voor de admin (whiskers) ``````

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.username, u.email, u.is_admin,
              EXISTS (SELECT 1 FROM bans b WHERE b.user_id = u.id) AS is_banned,
              (SELECT b.reason FROM bans b WHERE b.user_id = u.id) AS ban_reason,
              EXISTS (SELECT 1 FROM mutes m WHERE m.user_id = u.id) AS is_muted,
              (SELECT m.reason FROM mutes m WHERE m.user_id = u.id) AS mute_reason
       FROM users u ORDER BY u.username`
    );
    res.json(result.rows);
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
  if (await moderationTarget(req, res)) return;
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
    res.json(result.rows);
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

async function moderationTarget(req, res) {
  if (Number(req.params.id) === req.user.id) {
    res.status(400).json({ error: 'doe maar niet aan jezelf' });
    return true;
  }
  const target = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.params.id]);
  if (target.rows.length === 0) {
    res.status(404).json({ error: 'gebruiker bestaat niet' });
    return true;
  }
  if (target.rows[0].is_admin) {
    res.status(403).json({ error: 'een admin kun je niet demoten of verbannen' });
    return true;
  }
  return false;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server runt nu (hopelijk) op http://localhost:${PORT}`);
});
