const { execSync } = require('child_process');
require('dotenv').config();

const url = process.env.DATABASE_URL;
const sql = process.argv[2];

if (!sql) {
  console.error('bijv: npm run meow "SELECT * FROM users;"');
  process.exit(1);
}

try {
  execSync(`psql "${url}" -c "${sql}"`, { stdio: 'inherit' });
} catch (err) {
  process.exit(err.status);
}
