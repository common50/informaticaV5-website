document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const oeps = document.getElementById('error');

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();

    if (!res.ok) {
      oeps.textContent = data.error;
    } else {
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.href = '/dashboard.html';
    }
  } catch {
    oeps.textContent = 'ja iets is stuk maar ik weet niet wat helaas';
  }
});
