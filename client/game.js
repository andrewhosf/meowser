// ===== CONFIG =====
const API = '';
let token = localStorage.getItem('meowser_token');
let currentCat = null;
let inventory = { items: [], furniture: [], money: 0 };
let socket = null;

// ===== DOM REFS =====
const screens = {
  auth: document.getElementById('auth-screen'),
  create: document.getElementById('create-screen'),
  game: document.getElementById('game-screen'),
  catdergarten: document.getElementById('catdergarten-screen')
};

// Auth
const authEmail = document.getElementById('auth-email');
const authPass = document.getElementById('auth-password');
const authMsg = document.getElementById('auth-msg');
const forgotForm = document.getElementById('forgot-form');
const authForm = document.getElementById('auth-form');
const resetForm = document.getElementById('reset-form');

// Game
const canvas = document.getElementById('room');
const ctx = canvas.getContext('2d');
const statMoney = document.getElementById('stat-money');
const barHappiness = document.getElementById('bar-happiness');
const barHunger = document.getElementById('bar-hunger');
const statAge = document.getElementById('stat-age');
const statStage = document.getElementById('stat-stage');
const catNameDisplay = document.getElementById('cat-name-display');
const catTypeDisplay = document.getElementById('cat-type-display');
const chatLog = document.getElementById('chat-log');
const chatOptions = document.getElementById('chat-options');
const feedOptions = document.getElementById('feed-options');
const shopModal = document.getElementById('shop-modal');
const shopItems = document.getElementById('shop-items');

// ===== API HELPERS =====
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ===== SCREEN MANAGEMENT =====
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ===== AUTH =====
document.getElementById('btn-login').onclick = async () => {
  try {
    const data = await api('POST', '/api/auth/login', { email: authEmail.value, password: authPass.value });
    token = data.token;
    localStorage.setItem('meowser_token', token);
    await initGame();
  } catch (e) {
    authMsg.textContent = e.message;
    authMsg.className = 'msg err';
  }
};

document.getElementById('btn-register').onclick = async () => {
  try {
    const data = await api('POST', '/api/auth/register', { email: authEmail.value, password: authPass.value });
    token = data.token;
    localStorage.setItem('meowser_token', token);
    showScreen('create');
  } catch (e) {
    authMsg.textContent = e.message;
    authMsg.className = 'msg err';
  }
};

document.getElementById('link-forgot').onclick = () => {
  authForm.classList.add('hidden');
  forgotForm.classList.remove('hidden');
};

document.getElementById('link-back').onclick = () => {
  forgotForm.classList.add('hidden');
  authForm.classList.remove('hidden');
};

document.getElementById('btn-send-reset').onclick = async () => {
  const email = document.getElementById('forgot-email').value;
  try {
    await api('POST', '/api/auth/forgot-password', { email });
    document.getElementById('reset-msg').textContent = 'Reset link sent (check console/server log for demo URL)';
    document.getElementById('reset-msg').className = 'msg ok';
  } catch (e) {
    document.getElementById('reset-msg').textContent = e.message;
    document.getElementById('reset-msg').className = 'msg err';
  }
};

// Password reset from URL
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('token')) {
  showScreen('auth');
  authForm.classList.add('hidden');
  forgotForm.classList.add('hidden');
  resetForm.classList.remove('hidden');
  document.getElementById('btn-reset').onclick = async () => {
    try {
      await api('POST', '/api/auth/reset-password', {
        token: urlParams.get('token'),
        password: document.getElementById('reset-password').value
      });
      document.getElementById('reset-done').textContent = 'Password reset! Please log in.';
      document.getElementById('reset-done').className = 'msg ok';
      setTimeout(() => location.href = '/', 2000);
    } catch (e) {
      document.getElementById('reset-done').textContent = e.message;
      document.getElementById('reset-done').className = 'msg err';
    }
  };
}

document.getElementById('btn-logout').onclick = () => {
  token = null;
  localStorage.removeItem('meowser_token');
  showScreen('auth');
};

// ===== CAT CREATION =====
document.getElementById('btn-adopt').onclick = async () => {
  const name = document.getElementById('cat-name').value.trim();
  const type = document.getElementById('cat-type').value;
  const fur = document.getElementById('fur-color').value;
  const eye = document.getElementById('eye-color').value;
  if (!name) return alert('Name your cat!');
  try {
    await api('POST', '/api/cat', { name, type, fur_color: fur, eye_color: eye });
    await initGame();
  } catch (e) {
    document.getElementById('create-msg').textContent = e.message;
  }
};

// ===== GAME INIT =====
async function initGame() {
  try {
    const data = await api('GET', '/api/cat');
    if (!data.cat) {
      showScreen('create');
      return;
    }
    currentCat = data.cat;
    await loadInventory();
    showScreen('game');
    updateStats();
    initRoom();
    gameLoop();
    checkUbiStatus();
  } catch (e) {
    console.error(e);
    showScreen('auth');
  }
}

async function loadInventory() {
  const data = await api('GET', '/api/inventory');
  inventory = data;
}

function updateStats() {
  if (!currentCat) return;
  statMoney.textContent = currentCat.total_earnings?.toFixed(1) || 0;
  statAge.textContent = currentCat.age || 0;
  statStage.textContent = currentCat.growth_stage || 'kitten';
  catNameDisplay.textContent = currentCat.name;
  catTypeDisplay.textContent = currentCat.type;

  const h = Math.round(currentCat.happiness || 0);
  const hu = Math.round(currentCat.hunger || 0);

  barHappiness.style.width = h + '%';
  barHappiness.className = h < 30 ? 'low' : h < 60 ? 'mid' : '';

  barHunger.style.width = hu + '%';
  barHunger.className = hu < 30 ? 'low' : hu < 60 ? 'mid' : '';
}

function logChat(text, system) {
  const div = document.createElement('div');
  div.className = 'entry' + (system ? ' system' : '');
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ===== CANVAS & CAT AI =====
const ROOM_W = 800, ROOM_H = 500;
const FURNITURE_LAYOUT = {
  bed: { x: 40, y: 80, w: 120, h: 90, color: '#8ab6d6' },
  couch: { x: 200, y: 60, w: 160, h: 80, color: '#c8a97e' },
  cat_bed: { x: 380, y: 380, w: 80, h: 60, color: '#e76f51' },
  water_bowl: { x: 500, y: 380, w: 40, h: 30, color: '#90e0ef' },
  food_bowl: { x: 560, y: 380, w: 40, h: 30, color: '#d4a373' },
  sandbox: { x: 650, y: 60, w: 100, h: 80, color: '#e9c46a' },
  cat_tree: { x: 60, y: 250, w: 70, h: 140, color: '#a8d5a2' },
  lounger: { x: 280, y: 380, w: 80, h: 60, color: '#f4a261' },
  toy_mouse: { x: 250, y: 220, w: 30, h: 20, color: '#adb5bd' },
  scratch_post: { x: 30, y: 220, w: 40, h: 100, color: '#d4a373' }
};

let catEntity = {
  x: 400, y: 250,
  vx: 0, vy: 0,
  targetX: null, targetY: null,
  state: 'idle', // idle, walk, eat, sleep, play
  timer: 0,
  frame: 0,
  facing: 1, // 1 right, -1 left
  bubble: null, // { text, timer }
  heartTimer: 0
};

function initRoom() {
  catEntity.x = 400;
  catEntity.y = 250;
  catEntity.state = 'idle';
}

function setCatTarget(x, y, state = 'walk') {
  catEntity.targetX = x;
  catEntity.targetY = y;
  catEntity.state = state;
}

function updateCatAI() {
  const cat = catEntity;
  cat.frame++;
  cat.timer++;

  if (cat.bubble) {
    cat.bubble.timer--;
    if (cat.bubble.timer <= 0) cat.bubble = null;
  }
  if (cat.heartTimer > 0) cat.heartTimer--;

  if (cat.state === 'walk' && cat.targetX !== null) {
    const dx = cat.targetX - cat.x;
    const dy = cat.targetY - cat.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 5) {
      cat.targetX = null;
      cat.targetY = null;
      cat.vx = 0;
      cat.vy = 0;
      cat.state = 'idle';
      cat.timer = 0;
    } else {
      cat.vx = (dx / dist) * 1.5;
      cat.vy = (dy / dist) * 1.5;
      cat.facing = cat.vx > 0 ? 1 : -1;
    }
  }

  if (cat.state === 'idle' && cat.timer > 120 + Math.random() * 200) {
    // Pick random target
    const fx = Object.values(FURNITURE_LAYOUT);
    const target = fx[Math.floor(Math.random() * fx.length)];
    setCatTarget(target.x + target.w/2, target.y + target.h/2 + 20);
  }

  if (cat.state === 'play') {
    cat.vy = -3 * Math.sin(cat.timer * 0.2);
    if (cat.timer > 60) {
      cat.state = 'idle';
      cat.vy = 0;
      cat.timer = 0;
    }
  }

  cat.x += cat.vx;
  cat.y += cat.vy;

  // Bounds
  cat.x = Math.max(30, Math.min(ROOM_W - 30, cat.x));
  cat.y = Math.max(100, Math.min(ROOM_H - 40, cat.y));
}

function drawRoom() {
  // Floor
  ctx.fillStyle = '#faf3e0';
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);

  // Floor boards
  ctx.strokeStyle = '#f0e6d0';
  ctx.lineWidth = 1;
  for (let y = 0; y < ROOM_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ROOM_W, y);
    ctx.stroke();
  }

  // Wall
  ctx.fillStyle = '#fff8e7';
  ctx.fillRect(0, 0, ROOM_W, 40);
  ctx.fillStyle = '#e0d5c0';
  ctx.fillRect(0, 38, ROOM_W, 4);

  // Window
  ctx.fillStyle = '#cceeff';
  ctx.fillRect(300, 10, 160, 60);
  ctx.strokeStyle = '#8ab6d6';
  ctx.lineWidth = 4;
  ctx.strokeRect(300, 10, 160, 60);
  ctx.beginPath();
  ctx.moveTo(380, 10);
  ctx.lineTo(380, 70);
  ctx.moveTo(300, 40);
  ctx.lineTo(460, 40);
  ctx.stroke();
}

function drawFurnitureItem(key, f) {
  const layout = FURNITURE_LAYOUT[key] || { x: f.x, y: f.y, w: 60, h: 60, color: '#ccc' };
  const l = layout;

  ctx.fillStyle = l.color;
  ctx.strokeStyle = '#b0a090';
  ctx.lineWidth = 2;

  if (key === 'bed') {
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(l.x + 10, l.y + 10, l.w - 20, l.h - 20);
  } else if (key === 'couch') {
    ctx.fillRect(l.x, l.y + 20, l.w, l.h - 20);
    ctx.fillRect(l.x, l.y, l.w, 25);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
  } else if (key === 'cat_bed') {
    ctx.beginPath();
    ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2, l.h/2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2 - 8, l.h/2 - 8, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'water_bowl' || key === 'food_bowl') {
    ctx.beginPath();
    ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2, l.h/2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (key === 'water_bowl') {
      ctx.fillStyle = '#48cae4';
      ctx.beginPath();
      ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2 - 4, l.h/2 - 4, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#8d5524';
      ctx.beginPath();
      ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2 - 4, l.h/2 - 4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (key === 'sandbox') {
    ctx.fillRect(l.x, l.y, l.w, l.h);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(l.x + 5, l.y + 5, l.w - 10, l.h - 10);
  } else if (key === 'cat_tree') {
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(l.x + l.w/2 - 8, l.y + 30, 16, l.h - 30);
    ctx.fillStyle = l.color;
    ctx.fillRect(l.x, l.y, l.w, 40);
    ctx.fillRect(l.x + l.w - 30, l.y + 50, 30, 30);
    ctx.strokeRect(l.x, l.y, l.w, 40);
  } else if (key === 'lounger') {
    ctx.fillStyle = l.color;
    ctx.fillRect(l.x, l.y + 10, l.w, l.h - 10);
    ctx.fillRect(l.x, l.y, l.w, 20);
    ctx.strokeRect(l.x, l.y, l.w, l.h);
  } else if (key === 'toy_mouse') {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.ellipse(l.x + l.w/2, l.y + l.h/2, l.w/2, l.h/2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e76f51';
    ctx.beginPath();
    ctx.arc(l.x + l.w - 5, l.y + 5, 3, 0, Math.PI * 2);
    ctx.fill();
  } else if (key === 'scratch_post') {
    ctx.fillStyle = '#d4a373';
    ctx.fillRect(l.x + 5, l.y, l.w - 10, l.h);
    ctx.strokeRect(l.x + 5, l.y, l.w - 10, l.h);
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(l.x, l.y + l.h - 10, l.w, 10);
  } else {
    ctx.fillRect(l.x, l.y, l.w || 60, l.h || 60);
    ctx.strokeRect(l.x, l.y, l.w || 60, l.h || 60);
  }
}

function drawCat() {
  const c = catEntity;
  const cat = currentCat;
  if (!cat) return;

  const x = c.x;
  const y = c.y + (c.vy || 0);
  const facing = c.facing;
  const bounce = Math.sin(c.frame * 0.1) * 2;
  const isWalking = c.state === 'walk';

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  const fur = cat.fur_color || '#d4a373';
  const eye = cat.eye_color || '#4caf50';

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(0, 35, 25, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tail
  ctx.strokeStyle = fur;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const tailWag = Math.sin(c.frame * 0.15) * 10;
  ctx.moveTo(-20, 10);
  ctx.quadraticCurveTo(-40, -10 + tailWag, -35, -30 + tailWag * 0.5);
  ctx.stroke();

  // Body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 10, 28, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Legs
  const legOffset = isWalking ? Math.sin(c.frame * 0.3) * 6 : 0;
  ctx.fillStyle = fur;
  ctx.fillRect(-18, 20 + legOffset, 10, 16);
  ctx.fillRect(8, 20 - legOffset, 10, 16);

  // Head
  ctx.beginPath();
  ctx.arc(12, -15 + bounce, 22, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.moveTo(-2, -30 + bounce);
  ctx.lineTo(-10, -52 + bounce);
  ctx.lineTo(6, -35 + bounce);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(16, -33 + bounce);
  ctx.lineTo(26, -50 + bounce);
  ctx.lineTo(30, -30 + bounce);
  ctx.fill();

  // Inner ears
  ctx.fillStyle = '#ffccbc';
  ctx.beginPath();
  ctx.moveTo(0, -32 + bounce);
  ctx.lineTo(-6, -45 + bounce);
  ctx.lineTo(4, -35 + bounce);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(18, -32 + bounce);
  ctx.lineTo(24, -44 + bounce);
  ctx.lineTo(26, -32 + bounce);
  ctx.fill();

  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(4, -18 + bounce, 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22, -18 + bounce, 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(5, -17 + bounce, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -17 + bounce, 4, 0, Math.PI * 2);
  ctx.fill();

  // Pupils
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(5, -17 + bounce, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -17 + bounce, 2, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#ffab91';
  ctx.beginPath();
  ctx.arc(14, -8 + bounce, 3, 0, Math.PI * 2);
  ctx.fill();

  // Mouth
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(10, -5 + bounce, 4, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, -5 + bounce, 4, 0, Math.PI);
  ctx.stroke();

  // Whiskers
  ctx.strokeStyle = '#bbb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(22, -8 + bounce);
  ctx.lineTo(38, -12 + bounce);
  ctx.moveTo(22, -5 + bounce);
  ctx.lineTo(40, -5 + bounce);
  ctx.moveTo(22, -2 + bounce);
  ctx.lineTo(38, 2 + bounce);
  ctx.stroke();

  ctx.restore();

  // Hearts when petted
  if (c.heartTimer > 0) {
    ctx.fillStyle = '#e76f51';
    const hx = x + (Math.random() - 0.5) * 30;
    const hy = y - 40 - (60 - c.heartTimer);
    ctx.font = '20px sans-serif';
    ctx.fillText('❤', hx, hy);
  }

  // Speech bubble
  if (c.bubble) {
    ctx.fillStyle = 'white';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    const bw = c.bubble.text.length * 8 + 20;
    const bx = x - bw/2;
    const by = y - 80;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, 30, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.bubble.text, x, by + 20);
    ctx.textAlign = 'left';
  }
}

function drawGame() {
  ctx.clearRect(0, 0, ROOM_W, ROOM_H);
  drawRoom();

  // Draw furniture
  const allFurniture = inventory.furniture || [];
  for (const f of allFurniture) {
    drawFurnitureItem(f.item_type, f);
  }

  updateCatAI();
  drawCat();
}

function gameLoop() {
  if (!screens.game.classList.contains('hidden')) {
    drawGame();
  }
  requestAnimationFrame(gameLoop);
}

// ===== INTERACTIONS =====
chatOptions.querySelectorAll('button[data-action]').forEach(btn => {
  btn.onclick = async () => {
    const action = btn.dataset.action;
    if (action === 'feed') {
      chatOptions.classList.add('hidden');
      feedOptions.classList.remove('hidden');
      return;
    }
    try {
      const data = await api('POST', `/api/cat/${action}`);
      currentCat = data.cat;
      updateStats();
      logChat(data.message, false);

      if (action === 'pet') {
        catEntity.heartTimer = 60;
        catEntity.bubble = { text: 'Meow!', timer: 90 };
      } else if (action === 'talk') {
        catEntity.bubble = { text: data.message, timer: 120 };
      } else if (action === 'play') {
        catEntity.state = 'play';
        catEntity.timer = 0;
        catEntity.bubble = { text: 'Meow!', timer: 90 };
      }
    } catch (e) {
      logChat(e.message, true);
    }
  };
});

feedOptions.querySelectorAll('button[data-food]').forEach(btn => {
  btn.onclick = async () => {
    try {
      const data = await api('POST', '/api/cat/feed', { foodType: btn.dataset.food });
      currentCat = data.cat;
      updateStats();
      logChat(data.message, false);
      catEntity.bubble = { text: 'Meow!', timer: 90 };
      // Walk to food bowl
      const bowl = FURNITURE_LAYOUT.food_bowl;
      setCatTarget(bowl.x, bowl.y, 'walk');
    } catch (e) {
      logChat(e.message, true);
    }
    feedOptions.classList.add('hidden');
    chatOptions.classList.remove('hidden');
  };
});

document.getElementById('btn-cancel-feed').onclick = () => {
  feedOptions.classList.add('hidden');
  chatOptions.classList.remove('hidden');
};

// UBI
document.getElementById('btn-ubi').onclick = async () => {
  try {
    const data = await api('GET', '/api/ubi/claim');
    currentCat = data.cat;
    updateStats();
    logChat(`Catstream claimed! +$${data.amount} (${data.bonus}% bonus)`, true);
    document.getElementById('btn-ubi').disabled = true;
    document.getElementById('btn-ubi').textContent = 'Claimed Today';
  } catch (e) {
    logChat(e.message, true);
  }
};

async function checkUbiStatus() {
  try {
    const data = await api('GET', '/api/ubi/status');
    const btn = document.getElementById('btn-ubi');
    if (data.claimedToday) {
      btn.disabled = true;
      btn.textContent = 'Claimed Today';
    } else {
      btn.disabled = false;
      btn.textContent = 'Claim Daily Catstream';
    }
  } catch (e) { /* ignore */ }
}

// SHOP
const SHOP_DEF = [
  { id: 'dry_food', name: 'Dry Cat Food', cost: 5, desc: 'Basic nutrition' },
  { id: 'wet_food', name: 'Wet Cat Food', cost: 12, desc: 'Tasty and nutritious' },
  { id: 'wagyu_food', name: 'A5 Wagyu', cost: 50, desc: 'Ultra premium treat' },
  { id: 'roadkill_food', name: 'Roadkill', cost: 0, desc: 'Free... but gross' },
  { id: 'cat_tree', name: 'Cat Tree', cost: 80, desc: 'Climbing fun' },
  { id: 'lounger', name: 'Cat Lounger', cost: 45, desc: 'Comfy resting spot' },
  { id: 'toy_mouse', name: 'Toy Mouse', cost: 15, desc: 'Hunting practice' },
  { id: 'scratch_post', name: 'Scratching Post', cost: 30, desc: 'Save your furniture' }
];

document.getElementById('btn-shop').onclick = () => {
  shopItems.innerHTML = '';
  for (const item of SHOP_DEF) {
    const div = document.createElement('div');
    div.className = 'shop-item';
    div.innerHTML = `<div><span>${item.name}</span> <small>${item.desc}</small></div><div>$${item.cost} <button>Buy</button></div>`;
    div.querySelector('button').onclick = async () => {
      try {
        const data = await api('POST', '/api/shop/buy', { itemId: item.id });
        await loadInventory();
        currentCat.total_earnings = data.money;
        updateStats();
        logChat(data.message, true);
      } catch (e) {
        logChat(e.message, true);
      }
    };
    shopItems.appendChild(div);
  }
  shopModal.classList.remove('hidden');
};

document.getElementById('btn-close-shop').onclick = () => {
  shopModal.classList.add('hidden');
};

// CATDERGARTEN
document.getElementById('btn-catdergarten').onclick = async () => {
  try {
    await api('POST', '/api/catdergarten/send');
    enterCatdergarten();
  } catch (e) {
    logChat(e.message, true);
  }
};

function enterCatdergarten() {
  showScreen('catdergarten');
  socket = io();
  socket.emit('join-catdergarten', {
    name: currentCat.name,
    type: currentCat.type,
    furColor: currentCat.fur_color
  });

  socket.on('catdergarten-state', (cats) => {
    catdergartenCats = new Map(cats.map(c => [c.id, c]));
  });
  socket.on('cat-joined', (cat) => {
    catdergartenCats.set(cat.id, cat);
    cdLog(`${cat.name} joined the catdergarten!`);
  });
  socket.on('cat-left', (id) => {
    const c = catdergartenCats.get(id);
    if (c) cdLog(`${c.name} left.`);
    catdergartenCats.delete(id);
  });
  socket.on('cats-update', (updates) => {
    for (const u of updates) {
      const c = catdergartenCats.get(u.id);
      if (c) { c.x = u.x; c.y = u.y; c.frame = u.frame; }
    }
  });
  socket.on('chat-message', (msg) => {
    cdLog(`${msg.name}: ${msg.text}`);
  });
}

let catdergartenCats = new Map();
const cdCanvas = document.getElementById('catdergarten-canvas');
const cdCtx = cdCanvas.getContext('2d');

document.getElementById('btn-cd-send').onclick = sendCdChat;
document.getElementById('cd-input').onkeydown = (e) => { if (e.key === 'Enter') sendCdChat(); };

function sendCdChat() {
  const input = document.getElementById('cd-input');
  if (!input.value.trim() || !socket) return;
  socket.emit('chat-message', input.value.trim());
  cdLog(`${currentCat.name}: ${input.value.trim()}`);
  input.value = '';
}

function cdLog(text) {
  const div = document.getElementById('cd-log');
  const p = document.createElement('div');
  p.textContent = text;
  div.appendChild(p);
  div.scrollTop = div.scrollHeight;
}

document.getElementById('btn-leave-cd').onclick = async () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  try {
    const data = await api('POST', '/api/catdergarten/return');
    currentCat = data.cat;
    logChat(data.message, true);
  } catch (e) {
    logChat(e.message, true);
  }
  showScreen('game');
  updateStats();
};

function drawCatdergarten() {
  if (screens.catdergarten.classList.contains('hidden')) {
    requestAnimationFrame(drawCatdergarten);
    return;
  }
  cdCtx.fillStyle = '#e0f7fa';
  cdCtx.fillRect(0, 0, 800, 500);

  // Grass patches
  cdCtx.fillStyle = '#b2ebf2';
  for (let i = 0; i < 5; i++) {
    cdCtx.beginPath();
    cdCtx.arc(100 + i * 150, 400, 40 + i * 5, 0, Math.PI * 2);
    cdCtx.fill();
  }

  // Fence
  cdCtx.fillStyle = '#8d6e63';
  for (let x = 0; x < 800; x += 40) {
    cdCtx.fillRect(x, 20, 30, 60);
    cdCtx.beginPath();
    cdCtx.moveTo(x - 5, 20);
    cdCtx.lineTo(x + 15, 5);
    cdCtx.lineTo(x + 35, 20);
    cdCtx.fill();
  }
  cdCtx.fillRect(0, 60, 800, 8);

  // Cats
  for (const [id, c] of catdergartenCats) {
    drawSimpleCat(cdCtx, c.x, c.y, c.furColor || '#d4a373', c.name, c.frame);
  }

  requestAnimationFrame(drawCatdergarten);
}

function drawSimpleCat(ctx, x, y, color, name, frame) {
  const bounce = Math.sin((frame || 0) * 0.1) * 2;
  ctx.save();
  ctx.translate(x, y);

  // Shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(0, 20, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 5, 18, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.beginPath();
  ctx.arc(0, -14 + bounce, 14, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  ctx.beginPath();
  ctx.moveTo(-10, -22 + bounce);
  ctx.lineTo(-14, -36 + bounce);
  ctx.lineTo(-2, -26 + bounce);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(10, -22 + bounce);
  ctx.lineTo(14, -36 + bounce);
  ctx.lineTo(2, -26 + bounce);
  ctx.fill();

  // Eyes
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.arc(-5, -16 + bounce, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5, -16 + bounce, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#333';
  ctx.beginPath();
  ctx.arc(-5, -16 + bounce, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(5, -16 + bounce, 2, 0, Math.PI * 2);
  ctx.fill();

  // Name tag
  ctx.fillStyle = '#333';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(name, 0, 35);

  ctx.restore();
}

drawCatdergarten();

// Canvas click to move cat
canvas.onclick = (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  setCatTarget(x, y, 'walk');
};

// ===== STARTUP =====
if (token) {
  initGame();
} else {
  showScreen('auth');
}

// Refresh cat stats periodically
setInterval(async () => {
  if (token && currentCat && !screens.game.classList.contains('hidden')) {
    try {
      const data = await api('GET', '/api/cat');
      if (data.cat) {
        currentCat = data.cat;
        updateStats();
      }
    } catch (e) { /* ignore */ }
  }
}, 30000);
