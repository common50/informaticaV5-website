const user = JSON.parse(localStorage.getItem('user'));
const chatList = document.getElementById('chatList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const messageBox = document.getElementById('messageBox');

let currentOtherId = null;

async function laadChat() {
    const res = await fetch(`/api/personal-messages?userId=${user.id}`);
    const rows = await res.json();

    const chats = new Map();
    for (const m of rows) {
        const otherId = m.sender_id === user.id ? m.recipient_id : m.sender_id;
        if (!chats.has(otherId)) {
            chats.set(otherId, m.other_username ?? `gebruiker ${otherId}`);
        }
    }

    chatList.innerHTML = '';
    for (const [otherId, name] of chats) {
        const pancake = document.createElement('li');
        pancake.className = 'chat-item';
        pancake.textContent = name;
        pancake.addEventListener('click', () => openChat(otherId, name));
        chatList.appendChild(pancake);
    }
}

async function openChat(id, name) {
    currentOtherId = id;
    chatTitle.textContent = name;
    messages.innerHTML = '';

    const res = await fetch(`/api/personal-messages?userId=${user.id}`);
    const rows = await res.json();

    for (const m of rows) {
        const hoortBijChat = (m.sender_id === user.id && m.recipient_id === id)
                          || (m.sender_id === id && m.recipient_id === user.id);
        if (!hoortBijChat) continue;

        const meow = document.createElement('div');
        meow.className = m.sender_id === user.id ? 'message sent' : 'message received';
        meow.textContent = m.content;
        messages.appendChild(meow);
    }
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
    openChat(currentOtherId, chatTitle.textContent);
}

document.getElementById('sendBtn').addEventListener('click', stuurMsg);
messageBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') stuurMsg(); });

laadChat();
