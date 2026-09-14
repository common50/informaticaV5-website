const user = JSON.parse(localStorage.getItem('user'));
const chatList = document.getElementById('chatList');
const messages = document.getElementById('messages');
const chatTitle = document.getElementById('chatTitle');
const messageBox = document.getElementById('messageBox');

let currentConversationId = null;

async function laadChat() {
    const res = await fetch(`/api/conversations?userId=${user.id}`);
    const { conversations } = await res.json();

    for (const chat of conversations) {
        const pancake = document.createElement('li');
        pancake.className = 'chat-item';
        pancake.textContent = chat.other_user;
        pancake.addEventListener('click', () => openChat(chat.id, chat.other_user));
        chatList.appendChild(pancake);
    }
}

async function openChat(id, name) {
    currentConversationId = id;
    chatTitle.textContent = name;
    messages.innerHTML = '';

    const res = await fetch(`/api/messages?conversationId=${id}`);
    const { messages: msgs } = await res.json();

    for (const m of msgs) {
        const meow = document.createElement('div');
        meow.className = m.sender_id === user.id ? 'message sent' : 'message received';
        meow.textContent = m.content;
        messages.appendChild(meow);
    }
}

async function stuurMsg() {
    const content = messageBox.value.trim();
    if (!content || !currentConversationId) return;

    await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: currentConversationId, senderId: user.id, content })
    });
    messageBox.value = '';
    openChat(currentConversationId, chatTitle.textContent);
}

document.getElementById('sendBtn').addEventListener('click', stuurMsg);
messageBox.addEventListener('keydown', (e) => { if (e.key === 'Enter') stuurMsg(); });

loadChats();
