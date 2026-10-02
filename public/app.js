document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const oeps = document.getElementById('error');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const miauw = await res.json();

    if (!res.ok) {
      oeps.textContent = miauw.error;
    } else {
      window.location.href = '/dashboard.html';
    }
  } catch {
    oeps.textContent = 'ja iets is stuk maar ik weet niet wat helaas';
  }
});
