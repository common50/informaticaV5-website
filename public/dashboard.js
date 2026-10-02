const chatList = document.getElementById('chatList');
const teamList = document.getElementById('teamList');
const peopleList = document.getElementById('peopleList');
const adminUserList = document.getElementById('adminUserList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const messageBox = document.getElementById('messageBox');
const sendError = document.getElementById('sendError');
const peopleSearch = document.getElementById('peopleSearch');
const chatSearch = document.getElementById('chatSearch');
const adminSearch = document.getElementById('adminSearch');
const adminPanel = document.getElementById('adminPanel');
const MESSAGE_WRAP_LENGTH = 40;
const MESSAGE_MAX_LENGTH = 500;

let me = null;
let currentChat = null;
let currentView = 'chats';
let friendData = { friends: [], incoming: [], outgoing: [] };
let teamData = [];
let adminData = [];
let adminConvos = [];
let dmMutes = [];
let selectedAdminId = null;
let chatSig = '';
let lastChatSearch = '';
let lastAdminSig = '';
let lastRender = { key: '', lastId: 0 };

let bugs = null;
let quality = 'high';
let revenue = 9999999;


async function boot() {
  const res = await fetch('/api/me');
  if (!res.ok) {
    window.location.href = '/index.html';
    return;
  }
  me = (await res.json()).user;
  document.getElementById('whoAmI').textContent = `${me.username} (${me.id})${me.is_admin ? ' · admin 🛡️' : ''}`;
  document.getElementById('btnAdmin').classList.toggle('hidden', !me.is_admin);
  showView('chats');
  resizeMessageBox();
  setInterval(refreshAll, 3000);
}

function applyTheme(dark) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('theme', dark ? 'dark' : 'light');
  document.getElementById('darkToggle').checked = dark;
}
document.getElementById('darkToggle').addEventListener('change', (e) => applyTheme(e.target.checked));
document.getElementById('darkToggle').checked = document.documentElement.classList.contains('dark');

function showView(name) {
  currentView = name;
  for (const v of ['chats', 'people', 'admin', 'settings']) {
    document.getElementById(`${v}Sidebar`).classList.toggle('hidden', v !== name);
  }
  document.getElementById('settingsPanel').classList.toggle('hidden', name !== 'settings');
  adminPanel.classList.toggle('hidden', name !== 'admin');
  document.getElementById('composer').classList.toggle('hidden', name !== 'chats');

  for (const [btn, view] of [['btnChats', 'chats'], ['btnPeople', 'people'], ['btnAdmin', 'admin'], ['btnSettings', 'settings']]) {
    document.getElementById(btn).classList.toggle('active', view === name);
  }

  if (name === 'chats') {
    if (currentChat) chatTitle.textContent = currentChat.name;
    else chatTitle.textContent = 'kies een chat';
    messages.classList.remove('hidden');
    renderCurrent();
  } else {
    messages.classList.add('hidden');
    messages.innerHTML = '';
    lastRender = { key: '', lastId: 0 };
    if (name === 'people') {
      chatTitle.textContent = 'mensen 👥';
      renderPeople();
    } else if (name === 'admin') {
      chatTitle.textContent = 'moderatie 🛡️';
      renderAdmin();
    } else {
      chatTitle.textContent = 'instellingen ⚙️';
    }
  }
}

document.getElementById('btnChats').addEventListener('click', () => showView('chats'));
document.getElementById('btnPeople').addEventListener('click', () => showView('people'));
document.getElementById('btnAdmin').addEventListener('click', () => showView('admin'));
document.getElementById('btnSettings').addEventListener('click', () => showView('settings'));

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/index.html';
});


async function api(url, options) {
  const res = await fetch(url, options);
  if (res.status === 401) {
    window.location.href = '/index.html';
    return null;
  }
  return res;
}

async function json(res) {
  return res && res.ok ? res.json() : null;
}

async function fetchDms() {
  return (await json(await api('/api/personal-messages'))) ?? [];
}

async function fetchTeams() {
  return (await json(await api('/api/teams'))) ?? [];
}

async function fetchCurrentRows() {
  if (!currentChat) return [];
  if (currentChat.type === 'team') {
    return (await json(await api(`/api/teams/${currentChat.id}/messages`))) ?? [];
  }
  if (currentChat.type === 'watch') {
    return (await json(await api(`/api/admin/conversations/${currentChat.id}/${currentChat.otherId}`))) ?? [];
  }
  return fetchDms();
}


async function renderCurrent(rows) {
  if (currentView !== 'chats') return;
  if (!currentChat) {
    messages.classList.remove('hidden');
    messages.innerHTML = '<div class="hint">kies een chat links 👈</div>';
    lastRender = { key: '', lastId: 0 };
    return;
  }

  if (!rows) rows = await fetchCurrentRows();

  let chatRows;
  if (currentChat.type === 'team') {
    chatRows = rows;
  } else {
    const other = currentChat.otherId;
    chatRows = rows.filter((m) => (m.sender_id === me.id && m.recipient_id === other) || (m.sender_id === other && m.recipient_id === me.id));
  }

  const key = currentChat.type + ':' + currentChat.id + ':' + (currentChat.otherId ?? '');
  const lastId = chatRows.length ? chatRows[chatRows.length - 1].id : 0;
  const isNewChat = lastRender.key !== key;
  const hasNew = lastId !== lastRender.lastId;
  lastRender = { key, lastId };

  if (!isNewChat && !hasNew) return;

  const wasNearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
  const readOnly = currentChat.type === 'watch';

  messages.classList.remove('hidden');
  messages.innerHTML = '';
  if (chatRows.length === 0) {
    messages.innerHTML = '<div class="hint">nog niks hier</div>';
    return;
  }

  for (const m of chatRows) {
    const mine = m.sender_id === me.id && !readOnly;
    const meow = document.createElement('div');
    meow.className = mine ? 'message sent' : 'message received';
    meow.textContent = m.content;

    if (currentChat.type === 'team' || readOnly) {
      const wie = document.createElement('div');
      wie.className = 'sender';
      wie.textContent = m.sender_username ?? `gebruiker ${m.sender_id}`;
      meow.appendChild(wie);
    }

    if (m.created_at) {
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meow.appendChild(time);
    }

    messages.appendChild(meow);
  }

  if (isNewChat || (hasNew && wasNearBottom)) {
    messages.scrollTop = messages.scrollHeight;
  }
}


async function refreshAll() {
  try {
    const [dms, teams] = await Promise.all([fetchDms(), fetchTeams()]);
    if (me.is_admin && currentView !== 'admin') {
      adminData = (await json(await api('/api/admin/users'))) ?? [];
    }
    if (currentView === 'chats') {
      await renderChatLists(dms, teams);
      await renderCurrent(currentChat?.type === 'dm' ? dms : undefined);
    } else if (currentView === 'admin') {
      await renderAdminLists();
    }
  } catch {
    // server offline ofz, gewoon negeren
  }
}

async function refreshEverything() {
  chatSig = '';
  lastChatSearch = '';
  lastAdminSig = '';
  lastRender = { key: '', lastId: 0 };
  await refreshAll();
}

async function renderChatLists(dms, teams) {
  teamData = teams;
  await loadFriends();
  if (!dms) dms = await fetchDms();

  const sig = teams.map((t) => `${t.id}:${t.joined}`).join(',') + '|' +
    (dms.length ? `${dms.length}:${dms[dms.length - 1].id}` : '0');
  const q = chatSearch.value.trim().toLowerCase();
  if (sig === chatSig && q === lastChatSearch) return;
  chatSig = sig;
  lastChatSearch = q;

  const chats = new Map();
  for (const f of friendData.friends) {
    if (!chats.has(f.other_id)) chats.set(f.other_id, f.other_username);
  }
  for (const m of dms) {
    const otherId = m.sender_id === me.id ? m.recipient_id : m.sender_id;
    if (!chats.has(otherId)) chats.set(otherId, m.other_username ?? `gebruiker ${otherId}`);
  }

  chatList.innerHTML = '';
  for (const [otherId, name] of chats) {
    if (q && !name.toLowerCase().includes(q)) continue;
    chatList.appendChild(row(`${name}`, () => openDm(otherId, name)));
  }
  if (chatList.children.length === 0) {
    chatList.appendChild(emptyRow(q ? 'niemand gevonden 😿' : 'nog geen chats, zoek iemand via 👥'));
  }

  teamList.innerHTML = '';
  for (const t of teams) {
    if (q && !t.name.toLowerCase().includes(q)) continue;
    teamList.appendChild(row(`# ${t.name}`, t.joined ? () => openTeam(t.id, t.name) : () => joinTeam(t)));
  }
  if (teamList.children.length === 0) {
    teamList.appendChild(emptyRow(q ? 'geen teams 😿' : 'maar geen enkel team 😿'));
  }
}

function row(text, onClick) {
  const li = document.createElement('li');
  li.className = 'chat-item';
  li.textContent = text;
  li.addEventListener('click', onClick);
  return li;
}

function emptyRow(text) {
  const li = document.createElement('li');
  li.className = 'chat-item muted-item';
  li.textContent = text;
  return li;
}

function openDm(otherId, name) {
  currentChat = { type: 'dm', id: me.id, otherId, name };
  lastRender = { key: '', lastId: 0 };
  hideSendError();
  showView('chats');
}

function openTeam(id, name) {
  currentChat = { type: 'team', id, name: `# ${name}` };
  lastRender = { key: '', lastId: 0 };
  hideSendError();
  showView('chats');
}

function openWatch(a, b, name) {
  currentChat = { type: 'watch', id: a, otherId: b, name: `👁 ${name}` };
  lastRender = { key: '', lastId: 0 };
  hideSendError();
  showView('chats');
}

async function joinTeam(t) {
  await api(`/api/teams/${t.id}/join`, { method: 'POST' });
  await refreshEverything();
  openTeam(t.id, t.name);
}

document.getElementById('teamForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('teamName');
  const name = input.value.trim();
  if (!name) return;
  const res = await api('/api/teams', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  });
  if (!res) return;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(body.error ?? 'team maken mislukt');
    return;
  }
  input.value = '';
  await refreshEverything();
  openTeam(body.team.id, body.team.name);
});


function wrapMessage(value) {
  return value
    .split('\n')
    .map((line) => line.match(new RegExp(`.{1,${MESSAGE_WRAP_LENGTH}}`, 'g'))?.join('\n') ?? '')
    .join('\n');
}

function resizeMessageBox() {
  messageBox.style.height = 'auto';
  messageBox.style.height = `${messageBox.scrollHeight}px`;
}

function wrapMessageBox() {
  const value = messageBox.value;
  const start = messageBox.selectionStart;
  const end = messageBox.selectionEnd;
  const wrapped = wrapMessage(value);
  if (wrapped === value) {
    resizeMessageBox();
    return;
  }

  const wrappedStart = wrapMessage(value.slice(0, start)).length;
  const wrappedEnd = wrapMessage(value.slice(0, end)).length;
  messageBox.value = wrapped.slice(0, MESSAGE_MAX_LENGTH);
  messageBox.setSelectionRange(
    Math.min(wrappedStart, messageBox.value.length),
    Math.min(wrappedEnd, messageBox.value.length)
  );
  resizeMessageBox();
}

function showSendError(text) {
  sendError.textContent = text;
  sendError.classList.remove('hidden');
}

function hideSendError() {
  sendError.textContent = '';
  sendError.classList.add('hidden');
}

async function stuurMsg() {
  const content = messageBox.value.trim();
  if (!content || !currentChat || currentChat.type === 'watch') return;
  hideSendError();

  const url = currentChat.type === 'team'
    ? `/api/teams/${currentChat.id}/messages`
    : '/api/personal-messages';
  const body = currentChat.type === 'team'
    ? { content }
    : { recipient_id: currentChat.otherId, content };

  const res = await api(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res) return;
  if (!res.ok) {
    const fout = await res.json().catch(() => ({}));
    showSendError(fout.error ?? 'versturen mislukt');
    return;
  }

  messageBox.value = '';
  resizeMessageBox();
  refreshAll();
}


async function loadFriends() {
  const data = await json(await api('/api/friends'));
  if (data) friendData = data;
}

async function kolomRefresh() {
  await refreshEverything();
  if (currentView === 'people') renderPeople();
}

function label(text) {
  const d = document.createElement('div');
  d.className = 'section-label';
  d.textContent = text;
  return d;
}

function btn(text, cls, onClick) {
  const b = document.createElement('button');
  b.className = `btn-sm ${cls}`;
  b.textContent = text;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function nameSpan(text, onClick) {
  const n = document.createElement('span'); // ik heb geen idee welke letter ik moet gebruiken ik doe wat goed voelt
  n.className = 'name';
  n.textContent = text;
  if (onClick) n.addEventListener('click', onClick);
  return n;
}

async function stuurVerzoek(id) {
  await api('/api/friends', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: id })
  });
  await kolomRefresh();
}

async function accepteer(id) {
  await api('/api/friends/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: id })
  });
  await kolomRefresh();
}

async function verwijder(id) {
  await api('/api/friends', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ friend_id: id })
  });
  await kolomRefresh();
}

function incomingItem(r) {
  const d = document.createElement('div');
  d.className = 'people-item';
  d.append(
    nameSpan(r.other_username, () => openDm(r.other_id, r.other_username)),
    btn('accepteren', 'primary', () => accepteer(r.other_id)),
    btn('nee', 'danger', () => verwijder(r.other_id))
  );
  return d;
}

function outgoingItem(r) {
  const d = document.createElement('div');
  d.className = 'people-item';
  d.append(
    nameSpan(r.other_username, () => openDm(r.other_id, r.other_username)),
    btn('annuleren', 'ghost', () => verwijder(r.other_id))
  );
  return d;
}

function friendItem(f) {
  const d = document.createElement('div');
  d.className = 'people-item';
  d.append(
    nameSpan(f.other_username, () => openDm(f.other_id, f.other_username)),
    btn('chatten', 'primary', () => openDm(f.other_id, f.other_username)),
    btn('🗑', 'ghost', () => verwijder(f.other_id))
  );
  return d;
}

function renderPeople() {
  peopleList.innerHTML = '';
  const searchTerm = peopleSearch.value.trim();
  if (searchTerm) { renderSearch(searchTerm); return; }

  let iets = false;
  if (friendData.incoming.length) {
    iets = true;
    peopleList.appendChild(label('nieuwe verzoeken'));
    for (const r of friendData.incoming) peopleList.appendChild(incomingItem(r));
  }
  if (friendData.outgoing.length) {
    iets = true;
    peopleList.appendChild(label('verstuurd, wachten'));
    for (const r of friendData.outgoing) peopleList.appendChild(outgoingItem(r));
  }
  if (friendData.friends.length) {
    iets = true;
    peopleList.appendChild(label('mijn vrienden'));
    for (const f of friendData.friends) peopleList.appendChild(friendItem(f));
  }
  if (!iets) {
    peopleList.appendChild(emptyBox('je hebt geen vrienden 😂🫵'));
  }
}

function emptyBox(text) {
  const h = document.createElement('div');
  h.className = 'hint padded';
  h.textContent = text;
  return h;
}

async function renderSearch(q) {
  peopleList.innerHTML = '';
  const users = (await json(await api(`/api/users?q=${encodeURIComponent(q)}`))) ?? [];

  const isFriend = (id) => friendData.friends.some((f) => f.other_id === id);
  const isIncoming = (id) => friendData.incoming.some((r) => r.other_id === id);
  const isOutgoing = (id) => friendData.outgoing.some((r) => r.other_id === id);

  for (const u of users) {
    if (u.id === me.id) continue;

    const d = document.createElement('div');
    d.className = 'people-item';

    if (isFriend(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username)),
        btn('al vriend 🎉', 'ghost', () => openDm(u.id, u.username))
      );
    } else if (isIncoming(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username)),
        btn('accepteren', 'primary', () => accepteer(u.id)),
        btn('nee', 'danger', () => verwijder(u.id))
      );
    } else if (isOutgoing(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username)),
        btn('wachten...', 'ghost')
      );
    } else {
      d.append(
        nameSpan(u.username),
        btn('voeg toe', 'primary', () => stuurVerzoek(u.id))
      );
    }
    peopleList.appendChild(d);
  }

  if (users.length === 0) {
    peopleList.appendChild(emptyBox('niemand gevonden 😿'));
  }
}


async function renderAdminLists() {
  const [users, convos, mutes] = await Promise.all([
    json(await api('/api/admin/users')),
    json(await api('/api/admin/conversations')),
    json(await api('/api/admin/dm-mutes'))
  ]);
  if (users) adminData = users;
  if (convos) adminConvos = convos;
  if (mutes) dmMutes = mutes;
  renderAdminUsers();
  renderAdminPanel();
}

async function moderatie(url, options) {
  await api(url, options);
  await renderAdminLists();
}

function renderAdminUsers() {
  const q = adminSearch.value.trim().toLowerCase();
  const key = adminData.map((u) => `${u.id}${u.is_muted ? 'm' : ''}${u.is_banned ? 'b' : ''}`).join(',') + '|' + q + '|' + selectedAdminId;
  if (key === lastAdminSig) return;
  lastAdminSig = key;

  adminUserList.innerHTML = '';
  for (const u of adminData) {
    if (q && !u.username.toLowerCase().includes(q)) continue;
    const d = document.createElement('div');
    d.className = 'people-item';
    const n = nameSpan(u.username, () => { selectedAdminId = u.id; renderAdminPanel(); });
    if (u.id === selectedAdminId) n.classList.add('picked');
    d.append(n, badges(u));
    adminUserList.appendChild(d);
  }
  if (adminUserList.children.length === 0) adminUserList.appendChild(emptyBox('niemand gevonden 😿'));
}

function badges(u) {
  const wrap = document.createElement('span');
  wrap.className = 'badges';
  if (u.is_admin) wrap.appendChild(pill('admin', 'rail'));
  if (u.is_muted) wrap.appendChild(pill('gemute', 'warn'));
  if (u.is_banned) wrap.appendChild(pill('verbannen', 'danger'));
  return wrap;
}

function pill(text, cls) {
  const s = document.createElement('span');
  s.className = `pill ${cls}`;
  s.textContent = text;
  return s;
}

function renderAdmin() {
  renderAdminUsers();
  renderAdminPanel();
}

async function moderatie(url, options) {
  await api(url, options);
  await renderAdminLists();
}

function reasonPrompt() {
  const reden = prompt('waarom?', '');
  return reden || null;
}

function renderAdminPanel() {
  adminPanel.innerHTML = '';
  const u = adminData.find((x) => x.id === selectedAdminId);

  if (!u) {
    adminPanel.appendChild(emptyBox('kies iemand links om te beheren 🛡️'));
    return;
  }

  const kop = document.createElement('div');
  kop.className = 'setting-row';
  const info = document.createElement('div');
  const h4 = document.createElement('h4');
  h4.textContent = u.username + (u.is_admin ? ' · admin' : '');
  const p = document.createElement('p');
  p.textContent = `id ${u.id} · ${u.email}`;
  info.append(h4, p);
  kop.appendChild(info, badges(u));
  adminPanel.appendChild(kop);

  if (u.is_muted) {
    adminPanel.appendChild(rowCard('hele server gemute', u.mute_reason ?? 'voor de lol', 'demute', 'primary', () =>
      moderatie(`/api/admin/users/${u.id}/mute`, { method: 'DELETE' })));
  } else {
    adminPanel.appendChild(rowCard('hele server demute', 'kan nergens meer sturen', 'mute', 'ghost', async () => {
      await moderatie(`/api/admin/users/${u.id}/mute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonPrompt() })
      });
    }));
  }

  if (u.is_banned) {
    adminPanel.appendChild(rowCard('verbannen', u.ban_reason ?? 'voor de lol', 'terug halen', 'primary', () =>
      moderatie(`/api/admin/users/${u.id}/ban`, { method: 'DELETE' })));
  } else {
    adminPanel.appendChild(rowCard('verbannen', 'kan niet meer inloggen', 'ban', 'danger', async () => {
      const reden = reasonPrompt();
      if (reden === null) return;
      if (!confirm(`${u.username} er echt helemaal uit flikken?`)) return;
      await moderatie(`/api/admin/users/${u.id}/ban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reden })
      });
    }));
  }

  adminPanel.appendChild(label('gesprekken'));

  const convos = adminConvos;
  const threads = convos.filter((c) => c.a === u.id || c.b === u.id);
  if (threads.length === 0) {
    adminPanel.appendChild(emptyBox('geen gesprekken 😿'));
    return;
  }

  for (const c of threads) {
    const otherName = c.a === u.id ? c.b_username : c.a_username;
    const line = document.createElement('div');
    line.className = 'people-item';
    line.append(
      nameSpan(`${otherName} · ${c.message_count} berichten`, () => openWatch(c.a, c.b, `${c.a_username} ⇄ ${c.b_username}`))
    );
    line.appendChild(
      mutedInThread(c.a, c.b, u.id)
        ? btn('demute hier', 'ghost', () => moderatie(`/api/admin/dm-mutes/${c.a}/${c.b}/${u.id}`, { method: 'DELETE' }))
        : btn('demute hier', 'ghost', () => demuteInThread(c.a, c.b, u.id))
    );
    adminPanel.appendChild(line);
  }

  adminPanel.appendChild(label('al gedemute gesprekken'));
  if (dmMutes.length === 0) {
    adminPanel.appendChild(emptyBox('niemand gedemute in een gesprek'));
    return;
  }
  for (const m of dmMutes) {
    const line = document.createElement('div');
    line.className = 'people-item';
    line.append(
      nameSpan(`${m.a_username} ⇄ ${m.b_username}: ${m.user_id === m.a ? m.a_username : m.b_username} gemute`),
      btn('demute', 'ghost', () => moderatie(`/api/admin/dm-mutes/${m.a}/${m.b}/${m.user_id}`, { method: 'DELETE' }))
    );
    adminPanel.appendChild(line);
  }
}

function mutedInThread(a, b, userId) {
  return dmMutes.some((m) => m.thread_key === threadKey(a, b) && m.user_id === userId);
}

function threadKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

async function demuteInThread(a, b, userId) {
  await moderatie('/api/admin/dm-mutes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_a: a, user_b: b, user_id: userId, reason: reasonPrompt() })
  });
}

function rowCard(title, sub, action, cls, onClick) {
  const d = document.createElement('div');
  d.className = 'setting-row';
  const box = document.createElement('div');
  const h4 = document.createElement('h4');
  h4.textContent = title;
  const p = document.createElement('p');
  p.textContent = sub;
  box.append(h4, p);
  d.append(box, btn(action, cls, onClick));
  return d;
}

// luistervinknjesss
peopleSearch.addEventListener('input', renderPeople);
chatSearch.addEventListener('input', () => { chatSig = ''; refreshAll(); });
adminSearch.addEventListener('input', renderAdminUsers);

document.getElementById('sendBtn').addEventListener('click', stuurMsg);
messageBox.addEventListener('input', wrapMessageBox);
messageBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    stuurMsg();
  }
});

boot();
