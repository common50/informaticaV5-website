require('dotenv').config({ quiet: true });
const express = require('express');
const { Pool } = require('pg');
const hashbrowns = require('bcrypt');

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());
app.use(express.static('public'));

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'ik kan de gebruiker niet vinden' });
    }

    const user = result.rows[0];
    const valid = await hashbrowns.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'het wachtwoord is FOUT' });
    }

    res.json({ user: { id: user.id, username: user.username, email: user.email } });
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
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
      [username, email, hash]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'registratie mislukt' });
  }
});

// pb ding
app.get('/api/personal-messages', async (req, res) => {
  const { userId } = req.query;
  const result = await pool.query(
    `SELECT pm.*,
       CASE WHEN pm.sender_id = $1 THEN recipient.username ELSE sender.username END AS other_username
     FROM personal_messages pm
     JOIN users sender ON sender.id = pm.sender_id
     JOIN users recipient ON recipient.id = pm.recipient_id
     WHERE pm.sender_id = $1 OR pm.recipient_id = $1
     ORDER BY pm.id`,
    [userId]
  );
  res.json(result.rows);
});

app.post('/api/personal-messages', async (req, res) => {
  const { sender_id, recipient_id, content } = req.body;
  const result = await pool.query(
    'INSERT INTO personal_messages (sender_id, recipient_id, content) VALUES ($1, $2, $3) RETURNING id, sender_id, recipient_id, content, created_at',
    [sender_id, recipient_id, content]
  );
  res.json(result.rows[0]);
});



// gebruikers zoeken (voor de vrienden-dingen)
app.get('/api/users', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const result = await pool.query(
      'SELECT id, username FROM users WHERE username ILIKE $1 LIMIT 20',
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'oei' });
  }
});

// vrienden + vriendverzoeken ophalen
app.get('/api/friends', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId nodig' });

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
app.post('/api/friends', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { user_id, friend_id } = req.body;
    if (!user_id || !friend_id || user_id === friend_id) {
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
app.post('/api/friends/accept', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { user_id, friend_id } = req.body;

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
app.delete('/api/friends', async (req, res) => {
  try {
    const { user_id, friend_id } = req.body;
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


//``````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````````

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server runt nu (hopelijk) op http://localhost:${PORT}`);
});
