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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`server runt nu (hopelijk) op http://localhost:${PORT}`);
});
