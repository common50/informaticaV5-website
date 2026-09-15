const user = JSON.parse(localStorage.getItem('user'));
const chatList = document.getElementById('chatList');
const peopleList = document.getElementById('peopleList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const messageBox = document.getElementById('messageBox');
const peopleSearch = document.getElementById('peopleSearch');
const chatSearch = document.getElementById('chatSearch');

let currentOtherId = null;
let currentOtherName = 'kies een chat';
let currentView = 'chats';
let friendData = { friends: [], incoming: [], outgoing: [] };
let chatSig = '';
let lastChatSearch = '';
let lastRender = { otherId: null, lastId: 0 };

function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
    document.getElementById('darkToggle').checked = dark;
}
document.getElementById('darkToggle').addEventListener('change', (e) => applyTheme(e.target.checked));
document.getElementById('darkToggle').checked = document.documentElement.classList.contains('dark');

function showView(name) {
    currentView = name;
    document.getElementById('chatsSidebar').classList.toggle('hidden', name !== 'chats');
    document.getElementById('peopleSidebar').classList.toggle('hidden', name !== 'people');
    document.getElementById('settingsSidebar').classList.toggle('hidden', name !== 'settings');
    document.getElementById('settingsPanel').classList.toggle('hidden', name !== 'settings');
    document.querySelector('.message-input').classList.toggle('hidden', name !== 'chats');

    document.getElementById('btnChats').classList.toggle('active', name === 'chats');
    document.getElementById('btnPeople').classList.toggle('active', name === 'people');
    document.getElementById('btnSettings').classList.toggle('active', name === 'settings');

    if (name === 'chats') {
        chatTitle.textContent = currentOtherName;
        if (currentOtherId) renderMessages();
        laadChat();
    } else if (name === 'people') {
        messages.classList.add('hidden');
        messages.innerHTML = '';
        lastRender = { otherId: null, lastId: 0 };
        chatTitle.textContent = 'mensen 👥';
        renderPeople();
    } else {
        messages.classList.add('hidden');
        messages.innerHTML = '';
        lastRender = { otherId: null, lastId: 0 };
        chatTitle.textContent = 'instellingen ⚙️';
    }
}

document.getElementById('btnChats').addEventListener('click', () => showView('chats'));
document.getElementById('btnPeople').addEventListener('click', () => showView('people'));
document.getElementById('btnSettings').addEventListener('click', () => showView('settings'));

async function fetchMessages() {
    const res = await fetch(`/api/personal-messages?userId=${user.id}`);
    return res.json();
}

async function renderMessages(rows) {
    chatTitle.textContent = currentOtherName;
    if (!currentOtherId) {
        messages.classList.remove('hidden');
        messages.innerHTML = '<div class="hint">kies een chat links 👈</div>';
        lastRender = { otherId: null, lastId: 0 };
        return;
    }

    if (!rows) rows = await fetchMessages();

    const chatRows = rows.filter((m) =>
        (m.sender_id === user.id && m.recipient_id === currentOtherId) ||
        (m.sender_id === currentOtherId && m.recipient_id === user.id));

    const lastId = chatRows.length ? chatRows[chatRows.length - 1].id : 0;
    const isNewChat = lastRender.otherId !== currentOtherId;
    const hasNew = lastId !== lastRender.lastId;
    lastRender = { otherId: currentOtherId, lastId };

    if (!isNewChat && !hasNew) return;

    const wasNearBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;

    messages.classList.remove('hidden');
    messages.innerHTML = '';
    for (const m of chatRows) {
        const meow = document.createElement('div');
        meow.className = m.sender_id === user.id ? 'message sent' : 'message received';
        meow.textContent = m.content;

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

async function laadChat(rows) {
    await loadFriends();
    if (!rows) rows = await fetchMessages();

    const sig = rows.length ? `${rows.length}:${rows[rows.length - 1].id}` : '0';
    const q = chatSearch.value.trim().toLowerCase();
    if (sig === chatSig && q === lastChatSearch) return;
    chatSig = sig;
    lastChatSearch = q;

    const chats = new Map();
    for (const f of friendData.friends) {
        if (!chats.has(f.other_id)) chats.set(f.other_id, f.other_username);
    }
    for (const m of rows) {
        const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
        if (!chats.has(otherId)) chats.set(otherId, m.other_username ?? `gebruiker ${otherId}`);
    }

    chatList.innerHTML = '';
    for (const [otherId, name] of chats) {
        if (q && !name.toLowerCase().includes(q)) continue;
        const pancake = document.createElement('li');
        pancake.className = 'chat-item';
        pancake.textContent = name;
        pancake.addEventListener('click', () => openChat(otherId, name));
        chatList.appendChild(pancake);
    }
}

function openChat(id, name) {
    currentOtherId = id;
    currentOtherName = name;
    lastRender = { otherId: null, lastId: 0 };
    showView('chats');
}

async function stuurMsg() {
    const content = messageBox.value.trim();
    if (!content || !currentOtherId) return;

    await fetch('/api/personal-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_id: user.id, recipient_id: currentOtherId, content })
    });
    messageBox.value = '';
    refreshAll();
}

async function refreshAll() {
    try {
        const rows = await fetchMessages();
        if (currentView !== 'chats') return;
        await laadChat(rows);
        if (currentOtherId) await renderMessages(rows);
    } catch {
        // server offline ofz, gewoon negeren
    }
}

setInterval(refreshAll, 3000);

async function loadFriends() {
    const res = await fetch(`/api/friends?userId=${user.id}`);
    if (res.ok) friendData = await res.json();
}

async function kolomRefresh() {
    await loadFriends();
    chatSig = '';
    lastChatSearch = '';
    renderPeople();
    laadChat();
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
    await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, friend_id: id })
    });
    await kolomRefresh();
}

async function accepteer(id) {
    await fetch('/api/friends/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, friend_id: id })
    });
    await kolomRefresh();
}

async function verwijder(id) {
    await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: user.id, friend_id: id })
    });
    await kolomRefresh();
}

function incomingItem(r) {
    const d = document.createElement('div');
    d.className = 'people-item';
    d.append(
        nameSpan(r.other_username, () => openChat(r.other_id, r.other_username)),
        btn('accepteren', 'primary', () => accepteer(r.other_id)),
        btn('nee', 'danger', () => verwijder(r.other_id))
    );
    return d;
}

function outgoingItem(r) {
    const d = document.createElement('div');
    d.className = 'people-item';
    d.append(
        nameSpan(r.other_username, () => openChat(r.other_id, r.other_username)),
        btn('annuleren', 'ghost', () => verwijder(r.other_id))
    );
    return d;
}

function friendItem(f) {
    const d = document.createElement('div');
    d.className = 'people-item';
    d.append(
        nameSpan(f.other_username, () => openChat(f.other_id, f.other_username)),
        btn('chatten', 'primary', () => openChat(f.other_id, f.other_username)),
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
        const h = document.createElement('div');
        h.className = 'hint';
        h.style.padding = '24px 16px';
        h.textContent = 'je hebt geen vrienden 😂🫵';
        peopleList.appendChild(h);
    }
}

async function renderSearch(q) {
    peopleList.innerHTML = '';
    const res = await fetch(`/api/users?q=${encodeURIComponent(q)}`);
    const users = await res.json();

    const isFriend = (id) => friendData.friends.some((f) => f.other_id === id);
    const isIncoming = (id) => friendData.incoming.some((r) => r.other_id === id);
    const isOutgoing = (id) => friendData.outgoing.some((r) => r.other_id === id);

    for (const u of users) {
        if (u.id === user.id) continue;

        const d = document.createElement('div');
        d.className = 'people-item';

        if (isFriend(u.id)) {
            d.append(
                nameSpan(u.username, () => openChat(u.id, u.username)),
                btn('al vriend 🎉', 'ghost', () => openChat(u.id, u.username))
            );
        } else if (isIncoming(u.id)) {
            d.append(
                nameSpan(u.username, () => openChat(u.id, u.username)),
                btn('accepteren', 'primary', () => accepteer(u.id)),
                btn('nee', 'danger', () => verwijder(u.id))
            );
        } else if (isOutgoing(u.id)) {
            d.append(
                nameSpan(u.username, () => openChat(u.id, u.username)),
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
        const stroop = document.createElement('div');
        stroop.className = 'hint';
        stroop.style.padding = '24px 16px';
        stroop.textContent = 'niemand gevonden 😿';
        peopleList.appendChild(stroop);
    }
}

peopleSearch.addEventListener('input', renderPeople);
chatSearch.addEventListener('input', laadChat);

document.getElementById('sendBtn').addEventListener('click', stuurMsg);
messageBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') stuurMsg(); });

showView('chats');
