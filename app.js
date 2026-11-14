'use strict';
const API = 'https://inai-col3.fishrungames.com/api';
const WS_URL = 'wss://inai-col3.fishrungames.com/chat/';
const $ = (id) => document.getElementById(id);

let accessToken = null;
let username = null;
let ws = null;
let mode = 'login';
let reconnectTimer = null;
let reconnectDelay = 1000;
let closedByUser = false;

async function api(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) throw new Error(errorText(data) || `Ошибка ${res.status}`);
  return data;
}

function errorText(d) {
  if (!d) return '';
  if (typeof d === 'string') return d;
  if (d.detail) return d.detail;
  return Object.entries(d).map(([k, v]) => `${k}: ${[].concat(v).join(' ')}`).join('; ');
}

function show(view) {
  $('auth').hidden = view !== 'auth';
  $('chat').hidden = view !== 'chat';
}

function setMode(m) {
  mode = m;
  $('tab-login').setAttribute('aria-selected', m === 'login');
  $('tab-register').setAttribute('aria-selected', m === 'register');
  $('auth-submit').textContent = m === 'login' ? 'Войти' : 'Зарегистрироваться';
  $('password').autocomplete = m === 'login' ? 'current-password' : 'new-password';
  $('auth-error').textContent = '';
}

function addMessage({ sender, text, timestamp }, sys = false) {
  const li = document.createElement('li');
  if (sys) {
    li.className = 'sys';
    li.textContent = text;
  } else {
    if (sender === username) li.className = 'mine';
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${sender} · ${new Date(timestamp).toLocaleTimeString()}`;
    const body = document.createElement('div');
    body.textContent = text; // textContent — защита от XSS
    li.append(meta, body);
  }
  const list = $('messages');
  const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 60;
  list.append(li);
  if (atBottom || li.classList.contains('mine')) list.scrollTop = list.scrollHeight;
}

function setStatus(text, on = false) {
  $('status').textContent = text;
  $('status').classList.toggle('on', on);
  $('text').disabled = $('send').disabled = !on;
}

function decodeUsername(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p)))).username;
  } catch { return null; }
}

function connect() {
  clearTimeout(reconnectTimer);
  closedByUser = false;
  setStatus('подключение…');
  const sock = new WebSocket(WS_URL);
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'AUTH', payload: { token: accessToken } }));
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'AUTH_SUCCESS') {
      username = msg.payload.username;
      $('me').textContent = username;
      reconnectDelay = 1000;
      setStatus('в сети', true);
      $('text').focus();
    } else if (msg.type === 'NEW_MESSAGE') {
      addMessage(msg.payload);
    }
  };
  sock.onclose = () => {
    if (sock !== ws || closedByUser) return;
    setStatus('отключено, переподключение…');
    reconnectTimer = setTimeout(reconnect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  };
}

// access токен живёт ~5 минут: перед переподключением обновляем его по refresh-cookie
async function reconnect() {
  try {
    accessToken = (await api('/token/refresh/')).access;
    connect();
  } catch {
    toLogin('Сессия истекла, войдите снова');
  }
}

function startChat(token, name) {
  accessToken = token;
  username = name || decodeUsername(token);
  $('me').textContent = username || '';
  $('messages').replaceChildren();
  show('chat');
  connect();
}

function toLogin(msg = '') {
  closedByUser = true;
  clearTimeout(reconnectTimer);
  if (ws) ws.close();
  ws = null; accessToken = null; username = null;
  show('auth');
  $('auth-error').textContent = msg;
  $('password').value = '';
}

$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('auth-submit');
  btn.disabled = true;
  $('auth-error').textContent = '';
  try {
    const data = await api(mode === 'login' ? '/login/' : '/register/', {
      username: $('username').value.trim(),
      password: $('password').value,
    });
    startChat(data.access, data.user && data.user.username);
  } catch (err) {
    $('auth-error').textContent = err.message === 'Failed to fetch' ? 'Нет связи с сервером' : err.message;
  } finally {
    btn.disabled = false;
  }
};

$('send-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'CHAT_MESSAGE', payload: { text } }));
  $('text').value = '';
  autosize();
};

function autosize() {
  const t = $('text');
  t.style.height = 'auto';
  t.style.height = t.scrollHeight + 'px';
}
$('text').addEventListener('input', autosize);
// Enter — отправить, Shift+Enter — новая строка
$('text').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $('send-form').requestSubmit();
  }
});

$('logout').onclick = async () => {
  try { await api('/logout/'); } catch { /* всё равно выходим локально */ }
  toLogin();
};

// при загрузке пробуем восстановить сессию по refresh-cookie
(async () => {
  try {
    startChat((await api('/token/refresh/')).access);
  } catch {
    show('auth');
  }
})();
