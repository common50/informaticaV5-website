const chatList = document.getElementById('chatList');
const teamList = document.getElementById('teamList');
const peopleList = document.getElementById('peopleList');
const adminUserList = document.getElementById('adminUserList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const messageBox = document.getElementById('messageBox');
const sendError = document.getElementById('sendError');
const attachTray = document.getElementById('attachTray');
const attachInput = document.getElementById('attachInput');
const peopleSearch = document.getElementById('peopleSearch');
const chatSearch = document.getElementById('chatSearch');
const adminSearch = document.getElementById('adminSearch');
const adminPanel = document.getElementById('adminPanel');
const shopPanel = document.getElementById('shopPanel');
const shopCoins = document.getElementById('shopCoins');
const MESSAGE_WRAP_LENGTH = 40;
const MESSAGE_MAX_LENGTH = 500;
const MAX_IMAGES_PER_MESSAGE = 4;

let me = null;
let currentChat = null;
let currentView = 'chats';
let friendData = { friends: [], incoming: [], outgoing: [] };
let teamData = [];
let adminData = [];
let adminConvos = [];
let dmMutes = [];
let adminCatalog = [];
let selectedAdminId = null;
let chatSig = '';
let lastChatSearch = '';
let lastAdminSig = '';
let lastRender = { key: '', lastId: 0 };

let bugs = 'none';
let quality = 'high';
let revenue = 9999999;


async function boot() {
  const res = await fetch('/api/me');
  if (!res.ok) {
    window.location.href = '/index.html';
    return;
  }
  me = (await res.json()).user;
  rememberCosmetics(me.id, me.cosmetics);
  const whoAmI = document.getElementById('whoAmI');
  whoAmI.textContent = '';
  whoAmI.appendChild(styledName(`${me.username} (${me.id})`, me.cosmetics));
  if (me.is_admin) whoAmI.append(' · admin 🛡️');
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
  for (const v of ['chats', 'people', 'admin', 'shop', 'settings']) {
    document.getElementById(`${v}Sidebar`).classList.toggle('hidden', v !== name);
  }
  document.getElementById('settingsPanel').classList.toggle('hidden', name !== 'settings');
  adminPanel.classList.toggle('hidden', name !== 'admin');
  shopPanel.classList.toggle('hidden', name !== 'shop');
  document.getElementById('composer').classList.toggle('hidden', name !== 'chats');

  for (const [btn, view] of [['btnChats', 'chats'], ['btnPeople', 'people'], ['btnAdmin', 'admin'], ['btnShop', 'shop'], ['btnSettings', 'settings']]) {
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
      loadAdminCatalog().then(renderAdmin);
    } else if (name === 'shop') {
      chatTitle.textContent = 'winkel 🛍️';
      renderShop();
    } else {
      chatTitle.textContent = 'instellingen ⚙️';
    }
  }
}

document.getElementById('btnChats').addEventListener('click', () => showView('chats'));
document.getElementById('btnPeople').addEventListener('click', () => showView('people'));
document.getElementById('btnAdmin').addEventListener('click', () => showView('admin'));
document.getElementById('btnShop').addEventListener('click', () => showView('shop'));
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
    rememberCosmetics(m.sender_id, m.sender_id_cosmetics);
    rememberCosmetics(m.other_id, m.other_id_cosmetics);

    const mine = m.sender_id === me.id && !readOnly;
    const meow = document.createElement('div');
    meow.className = mine ? 'message sent' : 'message received';
    meow.textContent = m.content;

    if (m.content && m.image_ids?.length) meow.classList.add('has-images');

    for (const id of m.image_ids ?? []) {
      const pic = document.createElement('img');
      pic.className = 'message-image';
      pic.src = `/api/images/${id}`;
      pic.alt = 'afbeelding';
      pic.loading = 'lazy';
      pic.addEventListener('click', () => window.open(`/api/images/${id}`, '_blank', 'noopener'));
      meow.appendChild(pic);
    }

    if (currentChat.type === 'team' || readOnly) {
      const wie = document.createElement('div');
      wie.className = 'sender';
      wie.appendChild(nameSpan(m.sender_username ?? `gebruiker ${m.sender_id}`, undefined, m.sender_id));
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

async function renderChatLists(stroopwafels, teams) {
  teamData = teams;
  await loadFriends();
  if (!stroopwafels) stroopwafels = await fetchDms();

  const sig = teams.map((t) => `${t.id}:${t.joined}`).join(',') + '|' +
    (stroopwafels.length ? `${stroopwafels.length}:${stroopwafels[stroopwafels.length - 1].id}` : '0');
  const q = chatSearch.value.trim().toLowerCase();
  if (sig === chatSig && q === lastChatSearch) return;
  chatSig = sig;
  lastChatSearch = q;

  const chats = new Map();
  for (const f of friendData.friends) {
    if (!chats.has(f.other_id)) chats.set(f.other_id, f.other_username);
  }
  for (const mimi of stroopwafels) {
    const otherId = mimi.sender_id === me.id ? mimi.recipient_id : mimi.sender_id;
    if (!chats.has(otherId)) chats.set(otherId, mimi.other_username ?? `gebruiker ${otherId}`);
  }

  chatList.innerHTML = '';
  for (const [otherId, name] of chats) {
    if (q && !name.toLowerCase().includes(q)) continue;
    chatList.appendChild(row(`${name}`, () => openDm(otherId, name), otherId));
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

function row(text, onClick, userId) {
  const li = document.createElement('li');
  li.className = 'chat-item';
  const cosmetics = userId == null ? null : cosmeticCache.get(userId);
  const frame = cosmetics?.frame?.value?.emoji;
  li.textContent = frame ? `${frame} ${text}` : text;
  applyCosmetics(li, cosmetics);
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

let pendingImages = [];

function renderAttachTray() {
  attachTray.innerHTML = '';
  attachTray.classList.toggle('hidden', pendingImages.length === 0);
  pendingImages.forEach((img, i) => {
    const chip = document.createElement('div');
    chip.className = 'attach-chip';
    const pic = document.createElement('img');
    pic.src = `/api/images/${img.id}`;
    pic.alt = '';
    chip.append(pic, btn('✕', 'ghost', () => {
      pendingImages.splice(i, 1);
      renderAttachTray();
    }));
    attachTray.appendChild(chip);
  });
}

async function uploadImages(files) {
  const room = MAX_IMAGES_PER_MESSAGE - pendingImages.length;
  if (room <= 0) return showSendError(`max ${MAX_IMAGES_PER_MESSAGE} plaatjes per bericht`);

  for (const file of [...files].slice(0, room)) {
    hideSendError();
    const res = await fetch('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file
    });
    if (!res.ok) {
      const fout = await res.json().catch(() => ({}));
      showSendError(fout.error ?? 'uploaden mislukt');
      continue;
    }
    pendingImages.push(await res.json());
  }
  renderAttachTray();
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
  const imageIds = pendingImages.map((i) => i.id);
  if ((!content && imageIds.length === 0) || !currentChat || currentChat.type === 'watch') return;
  hideSendError();

  const url = currentChat.type === 'team'
    ? `/api/teams/${currentChat.id}/messages`
    : '/api/personal-messages';
  const body = currentChat.type === 'team'
    ? { content, image_ids: imageIds }
    : { recipient_id: currentChat.otherId, content, image_ids: imageIds };

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
  pendingImages = [];
  renderAttachTray();
  resizeMessageBox();
  refreshAll();
}


async function loadFriends() {
  const data = await json(await api('/api/friends'));
  if (data) {
    friendData = data;
    rememberAll(data.friends, 'other_id');
    rememberAll(data.incoming, 'other_id');
    rememberAll(data.outgoing, 'other_id');
  }
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


const cosmeticCache = new Map();
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function rememberCosmetics(userId, cosmetics) {
  if (userId == null) return;
  if (!cosmetics || Object.keys(cosmetics).length === 0) cosmeticCache.delete(userId);
  else cosmeticCache.set(userId, cosmetics);
}

function rememberAll(rows, idField = 'id') {
  for (const row of rows) rememberCosmetics(row[idField], row[`${idField}_cosmetics`]);
}

function applyCosmetics(el, cosmetics) {
  if (!cosmetics) return el;

  const color = cosmetics.name_color?.value?.color;
  if (cosmetics.name_color?.value?.rainbow) {
    el.classList.add('cos-rainbow');
  } else if (color && HEX_COLOR.test(color)) {
    el.style.color = color;
  }

  const glow = cosmetics.glow?.value?.color;
  if (glow && HEX_COLOR.test(glow)) el.style.textShadow = `0 0 6px ${glow}`;

  return el;
}

function nameSpan(text, onClick, userId) {
  const n = styledName(text, userId == null ? null : cosmeticCache.get(userId));
  if (onClick) n.addEventListener('click', onClick);
  return n;
}

function styledName(text, cosmetics) {
  const n = document.createElement('span'); // ik heb geen idee welke letter ik moet gebruiken ik doe wat goed voelt
  n.className = 'name';
  // het frame staat voor de naam, dus die zit in de text en niet er los naast
  const frame = cosmetics?.frame?.value?.emoji;
  n.textContent = frame ? `${frame} ${text}` : text;
  applyCosmetics(n, cosmetics);
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
    nameSpan(r.other_username, () => openDm(r.other_id, r.other_username), r.other_id),
    btn('accepteren', 'primary', () => accepteer(r.other_id)),
    btn('nee', 'danger', () => verwijder(r.other_id))
  );
  return d;
}

function outgoingItem(r) {
  const d = document.createElement('div');
  d.className = 'people-item';
  d.append(
    nameSpan(r.other_username, () => openDm(r.other_id, r.other_username), r.other_id),
    btn('annuleren', 'ghost', () => verwijder(r.other_id))
  );
  return d;
}

function friendItem(f) {
  const d = document.createElement('div');
  d.className = 'people-item';
  d.append(
    nameSpan(f.other_username, () => openDm(f.other_id, f.other_username), f.other_id),
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
  rememberAll(users);

  const isFriend = (id) => friendData.friends.some((f) => f.other_id === id);
  const isIncoming = (id) => friendData.incoming.some((r) => r.other_id === id);
  const isOutgoing = (id) => friendData.outgoing.some((r) => r.other_id === id);

  for (const u of users) {
    if (u.id === me.id) continue;

    const d = document.createElement('div');
    d.className = 'people-item';

    if (isFriend(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username), u.id),
        btn('al vriend 🎉', 'ghost', () => openDm(u.id, u.username))
      );
    } else if (isIncoming(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username), u.id),
        btn('accepteren', 'primary', () => accepteer(u.id)),
        btn('nee', 'danger', () => verwijder(u.id))
      );
    } else if (isOutgoing(u.id)) {
      d.append(
        nameSpan(u.username, () => openDm(u.id, u.username), u.id),
        btn('wachten...', 'ghost')
      );
    } else {
      d.append(
        nameSpan(u.username, undefined, u.id),
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
  if (users) {
    adminData = users;
    rememberAll(users);
  }
  if (convos) adminConvos = convos;
  if (mutes) dmMutes = mutes;
  renderAdminUsers();
  renderAdminPanel();
}

async function loadAdminCatalog() {
  if (adminCatalog.length > 0) return;
  adminCatalog = (await json(await api('/api/shop')))?.items ?? [];
}

function renderAdminUsers() {
  const q = adminSearch.value.trim().toLowerCase();
  const key = adminData.map((u) => `${u.id}${u.is_muted ? 'm' : ''}${u.is_banned ? 'b' : ''}${u.coins}${u.hammers}${u.owned.length}`).join(',') + '|' + q + '|' + selectedAdminId;
  if (key === lastAdminSig) return;
  lastAdminSig = key;

  adminUserList.innerHTML = '';
  for (const u of adminData) {
    if (q && !u.username.toLowerCase().includes(q)) continue;
    const d = document.createElement('div');
    d.className = 'people-item';
    const n = nameSpan(u.username, () => { selectedAdminId = u.id; renderAdminPanel(); }, u.id);
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

async function moderatie(url, options, body) {
  const res = await api(url, {
    ...options,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (res && !res.ok) {
    const data = await res.json().catch(() => null);
    alert(data?.error ?? 'iets ging mis 😿');
    return false;
  }
  await renderAdminLists();
  return true;
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
  h4.appendChild(nameSpan(u.username, undefined, u.id));
  if (u.is_admin) h4.append(' · admin');
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

  adminPanel.appendChild(label('poespunten'));

  const plus = btn('geven', 'primary', () => coinsPrompt(u, 1));
  const min = btn('afpakken', 'danger', () => coinsPrompt(u, -1));
  adminPanel.appendChild(itemRow(`${u.coins} 🪙`, 'geven of afpakken', coinButtons(plus, min)));

  adminPanel.appendChild(label('spul'));

  const spul = [];
  for (const owned of u.owned) {
    const item = adminCatalog.find((c) => c.key === owned.key);
    if (item) spul.push({ ...item, equipped: owned.equipped });
  }
  if (u.hammers > 0) spul.push({ key: 'ban_hammer', name: '🔨 ban hammer', grant: 'ban_hammer', blurb: `${u.hammers} in bezit` });

  if (spul.length === 0) {
    adminPanel.appendChild(emptyBox('niets om af te pakken 😿'));
  } else {
    for (const item of spul) {
      adminPanel.appendChild(
        rowCard(item.name, item.equipped ? 'gedragen' : (item.blurb ?? 'in bezit'), 'afpakken', 'danger', async () => {
          if (!confirm(`${item.name} van ${u.username} afpakken?`)) return;
          if (await moderatie(`/api/admin/users/${u.id}/items`, { method: 'DELETE' }, { item_key: item.key })) {
            if (item.equipped) rememberCosmetics(u.id, null);
          }
        })
      );
    }
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

function coinButtons(plus, min) {
  const wrap = document.createElement('span');
  wrap.className = 'buttons';
  wrap.append(plus, min);
  return wrap;
}

async function coinsPrompt(u, sign) {
  const invoer = prompt(`hoeveel poespunten ${sign > 0 ? 'geven' : 'afpakken'}?`, '500');
  if (invoer === null) return;
  const amount = Number(invoer);
  if (!Number.isInteger(amount) || amount <= 0) return alert('je hé wat denk je wel, kies een geheel getal groter dan 0');
  await moderatie(`/api/admin/users/${u.id}/coins`, { method: 'POST' }, { amount: amount * sign });
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
  return itemRow(title, sub, btn(action, cls, onClick));
}

// zelfde rij maar dan met een knop die je al hebt gemaakt, want sommige
// knoppen moeten disabled kunnen zijn en dat kan rowCard niet om een een of andere reden
function itemRow(title, sub, actionBtn) {
  const d = document.createElement('div');
  d.className = 'setting-row';
  const box = document.createElement('div');
  const h4 = document.createElement('h4');
  h4.textContent = title;
  const p = document.createElement('p');
  p.textContent = sub;
  box.append(h4, p);
  d.append(box, actionBtn);
  return d;
}


let shopData = { items: [], coins: 0, hammers: [], cosmetics: [], equipped: {}, history: [] };

async function loadShop() {
  const data = await json(await api('/api/shop'));
  if (!data) return;
  shopData = data;
  rememberCosmetics(me?.id, data.equipped);
}

// stuur iets naar de server en geef de fout terug als die er is, want json()
// gooit de error prop weg en dan lijkt het alsof er niets gebeurde
async function postVerzoek(url, body, options = {}) {
  const res = await api(url, {
    method: options.method ?? 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    alert(data?.error ?? 'iets ging mis 😿');
    return null;
  }
  return data;
}

async function renderShop() {
  await loadShop();

  shopCoins.textContent = `${shopData.coins} 🪙`;
  shopPanel.innerHTML = '';

  const owned = new Set(shopData.cosmetics.map((c) => c.item_key));
  const isOn = (item) => shopData.equipped[item.slot]?.key === item.key;

  shopPanel.appendChild(label('mijn uiterlijk'));

  const slots = [...new Set(shopData.items.filter((i) => i.slot).map((i) => i.slot))];
  for (const slot of slots) {
    shopPanel.appendChild(slotLabel(slot));

    for (const item of shopData.items.filter((i) => i.slot === slot)) {
      const koop = btn(`koop 🪙${item.price}`, 'ghost', () => koopItem(item.key));
      koop.disabled = owned.has(item.key) || shopData.coins < item.price;

      const actie = !owned.has(item.key)
        ? koop
        : btn(isOn(item) ? 'uitdoen' : 'aandoen', isOn(item) ? 'ghost' : 'primary', () =>
            toggleCosmetics(item.key, isOn(item))
          );

      shopPanel.appendChild(cosmetiekRow(item, actie));
    }
  }

  shopPanel.appendChild(label('spul'));
  for (const item of shopData.items.filter((i) => !i.slot)) {
    const koop = btn(`koop 🪙${item.price}`, 'primary', () => koopItem(item.key));
    koop.disabled = shopData.coins < item.price;
    shopPanel.appendChild(itemRow(item.name, item.blurb ?? '', koop));
  }

  const hammers = shopData.hammers.filter((h) => Number(h.uses_left) > 0);
  shopPanel.appendChild(label(`ban hammers (${hammers.length} klaar)`));
  if (hammers.length === 0) shopPanel.appendChild(emptyBox('geen hammers 😿'));
  for (const h of hammers) {
    shopPanel.appendChild(
      rowCard('🔨 ban hammer', `nog ${Number(h.uses_left)} keer lekker klappen`, 'gebruiken', 'danger', () =>
        promptHammer(h.id)
      )
    );
  }
}

function slotLabel(slot) {
  const naam = { name_color: 'naamkleur', glow: 'gloed', frame: 'frame' }[slot] ?? slot;
  return label(`${naam} - maximaal 1 aan`);
}

function cosmetiekRow(item, actie) { // heet dat zo in nl?? ach ja
  const rij = document.createElement('div');
  rij.className = 'setting-row';

  const box = document.createElement('div');
  const h4 = document.createElement('h4');
  h4.append(styledName('voorbeeld', { [item.slot]: { key: item.key, value: item.value } }));

  const p = document.createElement('p');
  p.textContent = `${item.blurb ?? ''} - 🪙${item.price}`;

  box.append(h4, p);
  rij.append(box, actie);
  return rij;
}

function promptHammer(hammerId) {
  const doel = prompt('aan wie wil je slaan? geef de gebruikersnaam', '');
  if (!doel) return;
  postVerzoek(`/api/hammer/${hammerId}/use`, { username: doel.trim() }).then((data) => {
    if (data) alert('de hamer is gevallen 🫡');
    renderShop();
  });
}

async function koopItem(key) {
  const data = await postVerzoek('/api/shop/buy', { item_key: key });
  if (data) await renderShop();
}

async function toggleCosmetics(key, isOn) {
  const done = await postVerzoek(`/api/cosmetics/${isOn ? 'unequip' : 'equip'}`, { item_key: key });
  if (done) await renderShop();
}

// luistervinknjesss
peopleSearch.addEventListener('input', renderPeople);
chatSearch.addEventListener('input', () => { chatSig = ''; refreshAll(); });
adminSearch.addEventListener('input', renderAdminUsers);

document.getElementById('attachBtn').addEventListener('click', () => attachInput.click());
attachInput.addEventListener('change', () => {
  uploadImages(attachInput.files);
  attachInput.value = '';
});
messageBox.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) return;
  e.preventDefault();
  uploadImages(files);
});

document.getElementById('sendBtn').addEventListener('click', stuurMsg);
messageBox.addEventListener('input', wrapMessageBox);
messageBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    stuurMsg();
  }
});

boot();
