// ===== CONFIG =====
const API = '';
let token = localStorage.getItem('meowser_token');
let currentCat = null;
let inventory = { items: [], furniture: [], money: 0 };
let dragFurniture = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let isDragging = false;

function getCanvasMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}
let furnitureRotation = {}; // item_type -> rotation angle
let gameHour = 6;
let isNight = false;
let catSleeping = false;
let lastLoafTime = 0;
let catStillStart = 0;
let paydayCountdown = 0;
let currentViewerCount = 15;
let targetViewerCount = 15;
let lastViewerChange = 0;
let socket = null;
let messes = [];
let foodInBowl = null;
let playBall = null;
let pettingHand = null;
let couchDamage = 0;

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
const statGameDay = document.getElementById('stat-gameday');
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
    buildBreedGrid();
    updatePreview();
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
    const data = await api('POST', '/api/auth/account-reset', { email });
    document.getElementById('reset-msg').textContent = data.message;
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

// ===== CAT CREATION WITH PREVIEW =====
const CAT_BREEDS = [
  { value: 'Tabby', label: 'Tabby', desc: 'Classic stripes' },
  { value: 'Siamese', label: 'Siamese', desc: 'Blue eyes, sleek' },
  { value: 'Maine Coon', label: 'Maine Coon', desc: 'Big and fluffy' },
  { value: 'Persian', label: 'Persian', desc: 'Flat face, fancy' },
  { value: 'Sphynx', label: 'Sphynx', desc: 'Hairless rebel' },
  { value: 'Scottish Fold', label: 'Scottish Fold', desc: 'Folded ears' },
  { value: 'Calico', label: 'Calico', desc: 'Three colors' }
];

let selectedBreed = 'Tabby';

function buildBreedGrid() {
  const grid = document.getElementById('cat-type-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const breed of CAT_BREEDS) {
    const card = document.createElement('div');
    card.className = 'breed-card' + (breed.value === selectedBreed ? ' selected' : '');
    card.innerHTML = `<canvas width="80" height="60"></canvas><div class="breed-name">${breed.label}</div><div class="breed-desc">${breed.desc}</div>`;
    const cvs = card.querySelector('canvas');
    drawPreviewCat(cvs.getContext('2d'), 40, 35, breed.value, document.getElementById('fur-color').value, document.getElementById('eye-color').value, 0.5);
    card.onclick = () => {
      selectedBreed = breed.value;
      buildBreedGrid();
      updatePreview();
    };
    grid.appendChild(card);
  }
}

function updatePreview() {
  const cvs = document.getElementById('cat-preview');
  if (!cvs) return;
  const fur = document.getElementById('fur-color').value;
  const eye = document.getElementById('eye-color').value;
  const pctx = cvs.getContext('2d');
  pctx.clearRect(0, 0, 200, 150);
  drawPreviewCat(pctx, 100, 75, selectedBreed, fur, eye, 1.2);
}

function drawPreviewCat(pctx, x, y, type, fur, eye, scale) {
  pctx.save();
  pctx.translate(x, y);
  pctx.scale(scale, scale);
  const bScale = type === 'Maine Coon' ? 1.15 : (type === 'Persian' ? 1.05 : 1.0);
  pctx.scale(bScale, bScale);

  // Body
  pctx.fillStyle = fur;
  pctx.beginPath();
  pctx.ellipse(0, 5, 25, 18, 0, 0, Math.PI * 2);
  pctx.fill();
  if (type === 'Tabby') {
    pctx.strokeStyle = shadeColor(fur, -25);
    pctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      pctx.beginPath();
      pctx.moveTo(-15, -2 + i * 8);
      pctx.lineTo(15, 2 + i * 8);
      pctx.stroke();
    }
  }
  if (type === 'Calico') {
    const patches = ['#e67e22', '#2c3e50', '#ecf0f1'];
    for (let i = 0; i < 3; i++) {
      pctx.fillStyle = patches[i];
      pctx.beginPath();
      pctx.ellipse(-8 + i * 10, 2 + (i % 2) * 6, 5, 4, 0, 0, Math.PI * 2);
      pctx.fill();
    }
  }
  if (type === 'Sphynx') {
    pctx.strokeStyle = 'rgba(200,150,150,0.3)';
    pctx.lineWidth = 1;
    pctx.beginPath(); pctx.moveTo(-10, 0); pctx.lineTo(5, -3); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(-5, 8); pctx.lineTo(8, 5); pctx.stroke();
  }

  // Head
  pctx.fillStyle = fur;
  if (type === 'Persian') {
    pctx.beginPath();
    pctx.ellipse(12, -12, 20, 16, 0, 0, Math.PI * 2);
    pctx.fill();
  } else {
    pctx.beginPath();
    pctx.arc(12, -12, 18, 0, Math.PI * 2);
    pctx.fill();
  }

  // Ears
  if (type === 'Scottish Fold') {
    pctx.fillStyle = fur;
    pctx.beginPath(); pctx.ellipse(-2, -24, 7, 5, 0.3, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(22, -24, 7, 5, -0.3, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = '#ffccbc';
    pctx.beginPath(); pctx.ellipse(-2, -24, 4, 3, 0.3, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(22, -24, 4, 3, -0.3, 0, Math.PI * 2); pctx.fill();
  } else if (type === 'Sphynx') {
    pctx.fillStyle = fur;
    pctx.beginPath(); pctx.moveTo(-4, -22); pctx.lineTo(-16, -42); pctx.lineTo(4, -26); pctx.fill();
    pctx.beginPath(); pctx.moveTo(24, -22); pctx.lineTo(36, -42); pctx.lineTo(16, -26); pctx.fill();
    pctx.fillStyle = '#ffccbc';
    pctx.beginPath(); pctx.moveTo(-2, -24); pctx.lineTo(-12, -38); pctx.lineTo(4, -28); pctx.fill();
    pctx.beginPath(); pctx.moveTo(22, -24); pctx.lineTo(32, -38); pctx.lineTo(16, -28); pctx.fill();
  } else if (type === 'Maine Coon') {
    pctx.fillStyle = fur;
    pctx.beginPath(); pctx.moveTo(-2, -22); pctx.lineTo(-12, -50); pctx.lineTo(6, -28); pctx.fill();
    pctx.beginPath(); pctx.moveTo(20, -22); pctx.lineTo(30, -50); pctx.lineTo(30, -28); pctx.fill();
    pctx.strokeStyle = fur; pctx.lineWidth = 2;
    pctx.beginPath(); pctx.moveTo(-12, -50); pctx.lineTo(-16, -56); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(30, -50); pctx.lineTo(34, -56); pctx.stroke();
    pctx.fillStyle = '#ffccbc';
    pctx.beginPath(); pctx.moveTo(0, -26); pctx.lineTo(-8, -42); pctx.lineTo(4, -32); pctx.fill();
    pctx.beginPath(); pctx.moveTo(20, -26); pctx.lineTo(26, -42); pctx.lineTo(26, -30); pctx.fill();
  } else if (type === 'Persian') {
    pctx.fillStyle = fur;
    pctx.beginPath(); pctx.ellipse(-2, -28, 5, 4, -0.2, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(22, -28, 5, 4, 0.2, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = '#ffccbc';
    pctx.beginPath(); pctx.ellipse(-2, -28, 3, 2, -0.2, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(22, -28, 3, 2, 0.2, 0, Math.PI * 2); pctx.fill();
  } else {
    // Tabby, Siamese, Calico default
    pctx.fillStyle = fur;
    pctx.beginPath(); pctx.moveTo(-2, -22); pctx.lineTo(-10, -40); pctx.lineTo(6, -28); pctx.fill();
    pctx.beginPath(); pctx.moveTo(20, -22); pctx.lineTo(28, -40); pctx.lineTo(14, -28); pctx.fill();
    pctx.fillStyle = '#ffccbc';
    pctx.beginPath(); pctx.moveTo(0, -26); pctx.lineTo(-6, -38); pctx.lineTo(4, -30); pctx.fill();
    pctx.beginPath(); pctx.moveTo(18, -26); pctx.lineTo(24, -38); pctx.lineTo(26, -28); pctx.fill();
  }

  // Face
  if (type === 'Persian') {
    pctx.fillStyle = shadeColor(fur, -10);
    pctx.beginPath(); pctx.ellipse(14, -8, 9, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = '#ffab91';
    pctx.beginPath(); pctx.ellipse(14, -6, 3.5, 2.5, 0, 0, Math.PI * 2); pctx.fill();
  } else {
    pctx.fillStyle = '#ffab91';
    pctx.beginPath(); pctx.arc(14, -6, 3, 0, Math.PI * 2); pctx.fill();
  }

  // Eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  pctx.fillStyle = 'white';
  pctx.beginPath(); pctx.ellipse(4, -14, 6, 7, 0, 0, Math.PI * 2); pctx.fill();
  pctx.beginPath(); pctx.ellipse(22, -14, 6, 7, 0, 0, Math.PI * 2); pctx.fill();
  pctx.fillStyle = eyeColor;
  pctx.beginPath(); pctx.arc(5, -13, 3.5, 0, Math.PI * 2); pctx.fill();
  pctx.beginPath(); pctx.arc(23, -13, 3.5, 0, Math.PI * 2); pctx.fill();

  pctx.restore();
}

// Update preview when colors change
document.getElementById('fur-color').oninput = updatePreview;
document.getElementById('eye-color').oninput = updatePreview;

document.getElementById('btn-adopt').onclick = async () => {
  const name = document.getElementById('cat-name').value.trim();
  const fur = document.getElementById('fur-color').value;
  const eye = document.getElementById('eye-color').value;
  if (!name) return alert('Name your cat!');
  try {
    await api('POST', '/api/cat', { name, type: selectedBreed, fur_color: fur, eye_color: eye });
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
      buildBreedGrid();
      updatePreview();
      return;
    }
    currentCat = data.cat;
    await loadInventory();
    await loadMesses();
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
  renderFoodInventory();
}

function renderFoodInventory() {
  const list = document.getElementById('food-inventory-list');
  if (!list) return;
  const items = inventory.items || [];
  const foodMap = {
    dry_food: 'Dry Food',
    wet_food: 'Wet Food',
    wagyu_food: 'A5 Wagyu',
    roadkill_food: 'Roadkill',
    zucchini_food: 'Zucchini',
    tuna_food: 'Tuna',
    salmon_food: 'Salmon',
    chicken_food: 'Chicken',
    shrimp_food: 'Shrimp',
    catnip_treat_food: 'Catnip Treat',
    sushi_food: 'Sushi'
  };
  const foodItems = items.filter(i => i.item_type.endsWith('_food'));
  if (foodItems.length === 0) {
    list.innerHTML = '<p class="no-food">No food purchased yet.</p>';
    return;
  }
  list.innerHTML = foodItems.map(i => {
    const name = foodMap[i.item_type] || i.item_type;
    return `<div class="food-inv-item"><span class="food-name">${name}</span><span class="food-qty">x${i.quantity}</span></div>`;
  }).join('');
}

async function loadMesses() {
  try {
    const data = await api('GET', '/api/messes');
    messes = data.messes || [];
  } catch (e) { messes = []; }
}

function updateStats() {
  if (!currentCat) return;
  statMoney.textContent = '$' + (currentCat.total_earnings?.toFixed(1) || 0);
  statAge.textContent = currentCat.age || 0;
  statStage.textContent = currentCat.growth_stage || 'kitten';
  statGameDay.textContent = currentCat.game_day || 1;
  gameHour = currentCat.game_hour || 6;
  isNight = gameHour >= 20 || gameHour < 6;
  // Cat sleeps from 8pm to 6am
  catSleeping = isNight;

  // Auto-claim morning bonus at 6am
  const prevHour = currentCat.game_hour || 6;
  if (gameHour === 6 && prevHour !== 6 && !currentCat.morning_bonus_claimed) {
    claimMorningBonus();
  }
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
  scratch_post: { x: 30, y: 220, w: 40, h: 100, color: '#d4a373' },
  tv: { x: 420, y: 55, w: 90, h: 55, color: '#2d2d2d' },
  tv_stand: { x: 415, y: 110, w: 100, h: 25, color: '#5d4037' },
  microwave: { x: 685, y: 145, w: 50, h: 30, color: '#b0bec5' },
  sink: { x: 685, y: 200, w: 65, h: 40, color: '#cfd8dc' },
  table: { x: 500, y: 185, w: 100, h: 55, color: '#8d6e63' },
  chair1: { x: 485, y: 250, w: 32, h: 32, color: '#a1887f' },
  chair2: { x: 590, y: 250, w: 32, h: 32, color: '#a1887f' }
};

let catEntity = {
  x: 400, y: 250,
  vx: 0, vy: 0,
  targetX: null, targetY: null,
  state: 'idle',
  pendingState: null,
  timer: 0,
  frame: 0,
  facing: 1,
  bubble: null,
  heartTimer: 0
};

function initRoom() {
  catEntity.x = 400;
  catEntity.y = 250;
  catEntity.state = 'idle';
  catEntity.pendingState = null;
  catEntity.timer = 0;
  catEntity.vx = 0;
  catEntity.vy = 0;
  catEntity.targetX = null;
  catEntity.targetY = null;
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

  // At night, cat sleeps in nearest bed
  if (catSleeping) {
    const beds = ['cat_bed', 'bed', 'couch', 'lounger'];
    let bedPos = null;
    // Try to find a bed from inventory
    if (inventory && inventory.furniture) {
      for (const key of beds) {
        const furn = inventory.furniture.find(f => f.item_type === key);
        if (furn) {
          const layout = FURNITURE_LAYOUT[key] || { w: 60, h: 60 };
          bedPos = {
            x: (furn.x != null && furn.x !== 0) ? furn.x : (layout.x || 0),
            y: (furn.y != null && furn.y !== 0) ? furn.y : (layout.y || 0),
            w: layout.w || 60,
            h: layout.h || 60
          };
          break;
        }
      }
    }
    // Fallback to layout defaults
    if (!bedPos) {
      for (const key of beds) {
        const layout = FURNITURE_LAYOUT[key];
        if (layout) {
          bedPos = { x: layout.x, y: layout.y, w: layout.w, h: layout.h };
          break;
        }
      }
    }
    if (bedPos) {
      // Teleport to bed center
      cat.x = bedPos.x + bedPos.w / 2;
      cat.y = bedPos.y + bedPos.h / 2 + 10;
    }
    cat.vx = 0;
    cat.vy = 0;
    cat.state = 'nap';
    cat.targetX = null;
    cat.targetY = null;
    cat.pendingState = null;
    return; // Skip all other AI
  }

  if (cat.bubble) {
    cat.bubble.timer--;
    if (cat.bubble.timer <= 0) cat.bubble = null;
  }
  if (cat.heartTimer > 0) cat.heartTimer--;
  if (pettingHand && pettingHand.timer > 0) {
    pettingHand.x = cat.x + 30;
    pettingHand.y = cat.y - 35;
    pettingHand.timer--;
  }
  if (foodInBowl && foodInBowl.timer > 0) foodInBowl.timer--;

  if (cat.state === 'walk' && cat.targetX !== null) {
    const dx = cat.targetX - cat.x;
    const dy = cat.targetY - cat.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < 5) {
      cat.targetX = null;
      cat.targetY = null;
      cat.vx = 0;
      cat.vy = 0;
      if (cat.pendingState) {
        cat.state = cat.pendingState;
        cat.pendingState = null;
        cat.timer = 0;
      } else if (cat.state === 'walk') {
        cat.state = 'idle';
        cat.timer = 0;
      }
    } else {
      cat.vx = (dx / dist) * 1.5;
      cat.vy = (dy / dist) * 1.5;
      cat.facing = cat.vx > 0 ? 1 : -1;
    }
  }

  if (cat.state === 'idle') {
    if (cat.timer > 120 + Math.random() * 200) {
      const roll = Math.random();
      if (roll < 0.05 && messes.length < 3) {
        cat.timer = 0;
        const sandbox = FURNITURE_LAYOUT.sandbox;
        const sdx = sandbox.x + sandbox.w/2 - cat.x;
        const sdy = sandbox.y + sandbox.h/2 - cat.y;
        const sdist = Math.sqrt(sdx*sdx + sdy*sdy);
        if (sdist > 40) {
          cat.pendingState = 'piss';
          setCatTarget(sandbox.x + sandbox.w/2, sandbox.y + sandbox.h/2 + 20, 'walk');
        } else {
          cat.state = 'piss';
          cat.timer = 0;
        }
      } else if (roll < 0.15) {
        cat.state = 'sit';
        cat.timer = 0;
      } else if (roll < 0.25) {
        cat.state = 'play';
        cat.timer = 0;
      } else {
        const fx = Object.values(FURNITURE_LAYOUT);
        const target = fx[Math.floor(Math.random() * fx.length)];
        setCatTarget(target.x + target.w/2, target.y + target.h/2 + 20);
      }
    }
  }

  if (cat.state === 'sit') {
    if (cat.timer > 100 + Math.random() * 150) {
      if (Math.random() < 0.4) {
        cat.state = 'nap';
        cat.timer = 0;
        const beds = ['bed', 'couch', 'cat_bed', 'lounger'];
        let nearest = null, nearestDist = 9999;
        for (const key of beds) {
          const b = FURNITURE_LAYOUT[key];
          if (!b) continue;
          const dx = b.x + b.w/2 - cat.x;
          const dy = b.y + b.h/2 - cat.y;
          const d = Math.sqrt(dx*dx + dy*dy);
          if (d < nearestDist) { nearestDist = d; nearest = b; }
        }
        if (nearest && nearestDist > 40) {
          setCatTarget(nearest.x + nearest.w/2, nearest.y + nearest.h/2 + 10, 'walk');
        }
      } else {
        cat.state = 'idle';
        cat.timer = 0;
      }
    }
  }

  if (cat.state === 'nap') {
    if (cat.timer > 200 + Math.random() * 300) {
      cat.state = 'idle';
      cat.timer = 0;
    }
  }

  if (cat.state === 'piss') {
    if (cat.timer === 60) {
      const mx = cat.x + (Math.random() - 0.5) * 20;
      const my = cat.y + 20;
      messes.push({ type: 'piss', x: mx, y: my, id: 'temp-' + Date.now() });
      api('POST', '/api/cat/mess', { type: 'piss', x: mx, y: my }).catch(() => {});
      cat.bubble = { text: '*pssss*', timer: 60 };
    }
    if (cat.timer > 120) {
      cat.state = 'idle';
      cat.timer = 0;
    }
  }

  if (cat.state === 'play') {
    if (playBall) {
      // Cat chases the ball
      const dx = playBall.x - cat.x;
      const dy = playBall.y - cat.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 15) {
        cat.vx = (dx / dist) * 2.5;
        cat.vy = (dy / dist) * 2.5;
        cat.facing = cat.vx > 0 ? 1 : -1;
      } else {
        // Pounce! Bat at ball
        cat.vx = 0;
        cat.vy = 0;
        // Knock ball away
        playBall.vx = (Math.random() - 0.5) * 6;
        playBall.vy = -4 - Math.random() * 3;
        cat.bubble = { text: '*bat*', timer: 30 };
      }
      // Update ball physics
      playBall.vy += 0.25; // gravity
      playBall.x += playBall.vx;
      playBall.y += playBall.vy;
      // Floor bounce
      if (playBall.y > ROOM_H - 30) {
        playBall.y = ROOM_H - 30;
        playBall.vy *= -0.7;
        playBall.vx *= 0.95;
        playBall.bounces++;
      }
      // Wall bounce
      if (playBall.x < 10 || playBall.x > ROOM_W - 10) {
        playBall.vx *= -0.8;
        playBall.x = Math.max(10, Math.min(ROOM_W - 10, playBall.x));
      }
      playBall.timer--;
      if (playBall.timer <= 0 || playBall.bounces > 8) {
        playBall = null;
        cat.state = 'idle';
        cat.timer = 0;
      }
    } else {
      // No ball - just bounce in place briefly
      cat.vy = -3 * Math.sin(cat.timer * 0.2);
      if (cat.timer > 60) {
        cat.state = 'idle';
        cat.vy = 0;
        cat.timer = 0;
      }
    }
  }

  if (cat.state === 'petted') {
    // Sit still and purr
    cat.vx = 0;
    cat.vy = 0;
    if (cat.timer > 180) {
      cat.state = 'idle';
      cat.timer = 0;
      pettingHand = null;
    }
    return;
  }

  // Cat scratches couch randomly when near it
  if (cat.state === 'idle' && Math.random() < 0.001 && couchDamage < 5) {
    const couch = FURNITURE_LAYOUT.couch;
    const cx = couch.x + couch.w/2, cy = couch.y + couch.h/2;
    const dx = cat.x - cx, dy = cat.y - cy;
    if (Math.sqrt(dx*dx + dy*dy) < 100) {
      couchDamage++;
      cat.state = 'sit';
      cat.timer = 0;
      cat.bubble = { text: '*scratch scratch*', timer: 60 };
    }
  }
  if (cat.state === 'eat') {
    if (cat.timer > 90) {
      cat.state = 'idle';
      cat.timer = 0;
      foodInBowl = null;
    }
  }

  cat.x += cat.vx;
  cat.y += cat.vy;
  cat.x = Math.max(30, Math.min(ROOM_W - 30, cat.x));
  cat.y = Math.max(100, Math.min(ROOM_H - 40, cat.y));
}

function drawRoom() {
  // Day/night background
  if (isNight) {
    ctx.fillStyle = '#2a2520';
  } else {
    ctx.fillStyle = '#faf3e0';
  }
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);

  ctx.strokeStyle = isNight ? '#3a3530' : '#f0e6d0';
  ctx.lineWidth = 1;
  for (let y = 0; y < ROOM_H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(ROOM_W, y);
    ctx.stroke();
  }

  // Ceiling
  ctx.fillStyle = isNight ? '#3a3530' : '#fff8e7';
  ctx.fillRect(0, 0, ROOM_W, 40);
  ctx.fillStyle = isNight ? '#4a4540' : '#e0d5c0';
  ctx.fillRect(0, 38, ROOM_W, 4);

  // Window
  if (isNight) {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(300, 10, 160, 60);
    ctx.strokeStyle = '#4a4a6e';
    ctx.lineWidth = 4;
    ctx.strokeRect(300, 10, 160, 60);
    // Moon
    ctx.fillStyle = '#f0e6c0';
    ctx.beginPath();
    ctx.arc(380, 40, 12, 0, Math.PI * 2);
    ctx.fill();
    // Stars
    ctx.fillStyle = '#fff';
    for (let sx = 310; sx < 450; sx += 25) {
      for (let sy = 15; sy < 65; sy += 20) {
        if (Math.random() > 0.6) {
          ctx.fillRect(sx, sy, 2, 2);
        }
      }
    }
  } else {
    ctx.fillStyle = '#cceeff';
    ctx.fillRect(300, 10, 160, 60);
    ctx.strokeStyle = '#8ab6d6';
    ctx.lineWidth = 4;
    ctx.strokeRect(300, 10, 160, 60);
    // Sun
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(380, 35, 10, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(380, 10);
  ctx.lineTo(380, 70);
  ctx.moveTo(300, 40);
  ctx.lineTo(460, 40);
  ctx.strokeStyle = isNight ? '#4a4a6e' : '#8ab6d6';
  ctx.lineWidth = 4;
  ctx.stroke();

  // Night overlay for the whole room
  if (isNight) {
    ctx.fillStyle = 'rgba(0, 0, 30, 0.25)';
    ctx.fillRect(0, 40, ROOM_W, ROOM_H - 40);
  }

  // Clock display
  drawClock();
}


function drawClock() {
  const hour = gameHour || 6;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  const min = Math.floor(((currentCat?.game_minutes || 0) % 60));
  const timeStr = `${displayHour}:${min.toString().padStart(2, '0')} ${ampm}`;

  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(10, 48, 80, 24, 6);
  ctx.fill();
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(timeStr, 50, 65);
  ctx.textAlign = 'left';
}

function getFurnitureAt(mx, my) {
  const allFurniture = inventory.furniture || [];
  // Check in reverse order (top-most first)
  for (let i = allFurniture.length - 1; i >= 0; i--) {
    const f = allFurniture[i];
    const layout = FURNITURE_LAYOUT[f.item_type] || { w: 60, h: 60 };
    const fx = (f.x != null && f.x !== 0) ? f.x : (layout.x || 0);
    const fy = (f.y != null && f.y !== 0) ? f.y : (layout.y || 0);
    const fw = layout.w || 60;
    const fh = layout.h || 60;
    if (mx >= fx && mx <= fx + fw && my >= fy && my <= fy + fh) {
      return f;
    }
  }
  return null;
}


function drawClock() {
  const hour12 = gameHour % 12 || 12;
  const ampm = gameHour >= 12 ? 'PM' : 'AM';
  const timeStr = `${hour12}:00 ${ampm}`;

  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.roundRect(ROOM_W - 120, 10, 110, 36, 8);
  ctx.fill();

  ctx.fillStyle = 'white';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(timeStr, ROOM_W - 65, 30);
  ctx.font = '11px sans-serif';
  ctx.fillStyle = gameHour >= 20 || gameHour < 6 ? '#ffcc80' : '#81c784';
  ctx.fillText(gameHour >= 20 || gameHour < 6 ? '🌙 Night' : '☀️ Day', ROOM_W - 65, 42);
  ctx.textAlign = 'left';
}

function drawPaydayCountdown() {
  const hours = paydayCountdown;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.roundRect(10, ROOM_H - 40, 140, 32, 6);
  ctx.fill();
  ctx.fillStyle = '#ffd700';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`💰 Payday in ${hours}h`, 80, ROOM_H - 18);
  ctx.textAlign = 'left';
}

function drawFurnitureItem(key, f) {
  const layout = FURNITURE_LAYOUT[key] || { x: 0, y: 0, w: 60, h: 60, color: '#ccc' };
  const l = layout;
  // Use saved position if available, otherwise fallback to layout default
  const x = (f && f.x != null && f.x !== 0) ? f.x : l.x;
  const y = (f && f.y != null && f.y !== 0) ? f.y : l.y;
  const w = l.w, h = l.h;
  const rot = (f && f.rotation) || 0;

  ctx.save();
  ctx.translate(x + w/2, y + h/2);
  ctx.rotate(rot * Math.PI / 180);
  ctx.translate(-w/2, -h/2);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#a09080';

  if (key === 'bed') {
    // 3D Bed with headboard, mattress, pillow, blanket
    const hx = 0, hy = 0, hw = w, hh = h;
    // Headboard (darker, behind)
    ctx.fillStyle = '#6a9ab5';
    ctx.fillRect(hx + 5, hy - 15, hw - 10, 20);
    ctx.strokeRect(hx + 5, hy - 15, hw - 10, 20);
    // Headboard detail
    ctx.fillStyle = '#5a8aa5';
    ctx.fillRect(hx + 15, hy - 10, hw - 30, 10);
    // Mattress base
    ctx.fillStyle = '#8ab6d6';
    ctx.fillRect(hx, hy + 5, hw, hh - 5);
    ctx.strokeRect(hx, hy + 5, hw, hh - 5);
    // Mattress top (lighter)
    ctx.fillStyle = '#9ec6e6';
    ctx.fillRect(hx + 3, hy + 5, hw - 6, 12);
    // Pillow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(hx + hw/2, hy + 18, hw/2 - 15, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Pillow shadow
    ctx.fillStyle = '#eee';
    ctx.beginPath();
    ctx.ellipse(hx + hw/2, hy + 20, hw/2 - 18, 5, 0, 0, Math.PI*2);
    ctx.fill();
    // Blanket (lower half, draped)
    ctx.fillStyle = '#7ab6c6';
    ctx.beginPath();
    ctx.moveTo(hx, hy + 30);
    ctx.lineTo(hx + hw, hy + 30);
    ctx.lineTo(hx + hw + 5, hy + hh);
    ctx.lineTo(hx - 5, hy + hh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Blanket fold
    ctx.strokeStyle = '#6aa6b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx + 10, hy + 35);
    ctx.quadraticCurveTo(hx + hw/2, hy + 45, hx + hw - 10, hy + 35);
    ctx.stroke();
    // Legs
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(hx + 5, hy + hh, 6, 8);
    ctx.fillRect(hx + hw - 11, hy + hh, 6, 8);

  } else if (key === 'tv') {
    // Flatscreen TV on wall
    const tx = 0, ty = 0, tw = w, th = h;
    // Screen (black, glossy)
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 4);
    ctx.fill();
    ctx.strokeStyle = '#444';
    ctx.stroke();
    // Screen reflection
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.beginPath();
    ctx.moveTo(tx + tw*0.6, ty + 4);
    ctx.lineTo(tx + tw - 4, ty + 4);
    ctx.lineTo(tx + tw - 4, ty + th*0.4);
    ctx.lineTo(tx + tw*0.6, ty + th*0.5);
    ctx.closePath();
    ctx.fill();
    // Stand
    ctx.fillStyle = '#3d3d3d';
    ctx.fillRect(tx + tw/2 - 8, ty + th, 16, 8);
    ctx.fillRect(tx + tw/2 - 20, ty + th + 8, 40, 4);
    // Power LED
    ctx.fillStyle = '#00e676';
    ctx.beginPath();
    ctx.arc(tx + tw - 8, ty + th - 6, 2, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'tv_stand') {
    // Simple TV stand with shelves
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0, 0, w, h);
    // Shelf lines
    ctx.strokeStyle = '#4e342e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(5, h/2);
    ctx.lineTo(w - 5, h/2);
    ctx.stroke();
    // Items on shelf
    ctx.fillStyle = '#78909c';
    ctx.fillRect(8, 4, 12, 8);
    ctx.fillRect(25, 4, 10, 8);

  } else if (key === 'microwave') {
    // Microwave oven
    const mx = 0, my = 0, mw = w, mh = h;
    // Body
    ctx.fillStyle = '#b0bec5';
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);
    // Door window
    ctx.fillStyle = '#37474f';
    ctx.fillRect(mx + 4, my + 4, mw - 20, mh - 8);
    ctx.strokeRect(mx + 4, my + 4, mw - 20, mh - 8);
    // Window reflection
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(mx + 6, my + 6, mw - 28, mh - 14);
    // Control panel
    ctx.fillStyle = '#90a4ae';
    ctx.fillRect(mx + mw - 14, my + 4, 10, mh - 8);
    // Buttons
    ctx.fillStyle = '#455a64';
    ctx.fillRect(mx + mw - 12, my + 7, 6, 3);
    ctx.fillRect(mx + mw - 12, my + 12, 6, 3);
    ctx.fillRect(mx + mw - 12, my + 17, 6, 3);

  } else if (key === 'sink') {
    // Kitchen sink
    const sx = 0, sy = 0, sw = w, sh = h;
    // Countertop
    ctx.fillStyle = '#cfd8dc';
    ctx.fillRect(sx - 5, sy, sw + 10, sh);
    ctx.strokeRect(sx - 5, sy, sw + 10, sh);
    // Basin
    ctx.fillStyle = '#b0bec5';
    ctx.beginPath();
    ctx.ellipse(sx + sw/2, sy + sh/2 + 3, sw/2 - 4, sh/2 - 6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Water
    ctx.fillStyle = '#81d4fa';
    ctx.beginPath();
    ctx.ellipse(sx + sw/2, sy + sh/2 + 5, sw/2 - 8, sh/2 - 10, 0, 0, Math.PI*2);
    ctx.fill();
    // Faucet
    ctx.strokeStyle = '#90a4ae';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx + sw/2, sy - 2);
    ctx.quadraticCurveTo(sx + sw/2, sy - 15, sx + sw/2 + 8, sy - 8);
    ctx.stroke();

  } else if (key === 'table') {
    // Dining table with legs
    const tx = 0, ty = 0, tw = w, th = h;
    // Tabletop
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(tx, ty, tw, th - 10);
    ctx.strokeRect(tx, ty, tw, th - 10);
    // Wood grain lines
    ctx.strokeStyle = '#795548';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(tx + 5, ty + i * (th - 10) / 4);
      ctx.lineTo(tx + tw - 5, ty + i * (th - 10) / 4);
      ctx.stroke();
    }
    // Legs
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(tx + 5, ty + th - 10, 6, 12);
    ctx.fillRect(tx + tw - 11, ty + th - 10, 6, 12);
    ctx.fillRect(tx + tw/2 - 3, ty + th - 10, 6, 12);

  } else if (key === 'chair1' || key === 'chair2') {
    // Simple chair
    const cx = 0, cy = 0, cw = w, ch = h;
    // Seat
    ctx.fillStyle = '#a1887f';
    ctx.fillRect(cx, cy + ch/2, cw, ch/2);
    ctx.strokeRect(cx, cy + ch/2, cw, ch/2);
    // Backrest
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(cx + 2, cy, cw - 4, ch/2);
    ctx.strokeRect(cx + 2, cy, cw - 4, ch/2);
    // Legs
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(cx + 2, cy + ch, 4, 6);
    ctx.fillRect(cx + cw - 6, cy + ch, 4, 6);

  } else if (key === 'couch') {
    // 3D Couch with back, arms, cushions, legs
    const cx = 0, cy = 0, cw = w, ch = h;
    // Backrest (tall, behind)
    ctx.fillStyle = '#b08d5e';
    ctx.beginPath();
    ctx.moveTo(cx + 5, cy - 15);
    ctx.lineTo(cx + cw - 5, cy - 15);
    ctx.quadraticCurveTo(cx + cw, cy - 5, cx + cw, cy + 10);
    ctx.lineTo(cx, cy + 10);
    ctx.quadraticCurveTo(cx, cy - 5, cx + 5, cy - 15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Seat base
    ctx.fillStyle = '#c8a97e';
    ctx.fillRect(cx, cy + 10, cw, ch - 10);
    ctx.strokeRect(cx, cy + 10, cw, ch - 10);
    // Seat cushion 1
    ctx.fillStyle = '#d4b48e';
    ctx.fillRect(cx + 5, cy + 12, cw/2 - 7, ch - 18);
    ctx.strokeRect(cx + 5, cy + 12, cw/2 - 7, ch - 18);
    // Seat cushion 2
    ctx.fillRect(cx + cw/2 + 2, cy + 12, cw/2 - 7, ch - 18);
    ctx.strokeRect(cx + cw/2 + 2, cy + 12, cw/2 - 7, ch - 18);
    // Left armrest
    ctx.fillStyle = '#b08d5e';
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy + 5);
    ctx.quadraticCurveTo(cx - 12, cy + 15, cx - 8, cy + ch - 5);
    ctx.lineTo(cx + 10, cy + ch - 5);
    ctx.quadraticCurveTo(cx + 14, cy + 15, cx + 10, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Right armrest
    ctx.beginPath();
    ctx.moveTo(cx + cw - 10, cy + 5);
    ctx.quadraticCurveTo(cx + cw - 14, cy + 15, cx + cw - 10, cy + ch - 5);
    ctx.lineTo(cx + cw + 8, cy + ch - 5);
    ctx.quadraticCurveTo(cx + cw + 12, cy + 15, cx + cw + 8, cy + 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Legs
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(cx + 2, cy + ch, 6, 8);
    ctx.fillRect(cx + cw - 8, cy + ch, 6, 8);

    // Couch damage (scratch marks)
    if (couchDamage > 0) {
      ctx.strokeStyle = '#5d4037';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < couchDamage * 3; i++) {
        const sx = cx + 20 + (i * 25) % (cw - 30);
        const sy = cy + 15 + (i * 13) % (ch - 20);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx + 8, sy + 12);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + 4, sy);
        ctx.lineTo(sx + 12, sy + 12);
        ctx.stroke();
      }
    }

  } else if (key === 'bed') {
    // 3D Bed with headboard, mattress, pillow, blanket
    const hx = 0, hy = 0, hw = w, hh = h;
    // Headboard (darker, behind)
    ctx.fillStyle = '#6a9ab5';
    ctx.fillRect(hx + 5, hy - 15, hw - 10, 20);
    ctx.strokeRect(hx + 5, hy - 15, hw - 10, 20);
    // Headboard detail
    ctx.fillStyle = '#5a8aa5';
    ctx.fillRect(hx + 15, hy - 10, hw - 30, 10);
    // Mattress base
    ctx.fillStyle = '#8ab6d6';
    ctx.fillRect(hx, hy + 5, hw, hh - 5);
    ctx.strokeRect(hx, hy + 5, hw, hh - 5);
    // Mattress top (lighter)
    ctx.fillStyle = '#9ec6e6';
    ctx.fillRect(hx + 3, hy + 5, hw - 6, 12);
    // Pillow
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(hx + hw/2, hy + 18, hw/2 - 15, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Pillow shadow
    ctx.fillStyle = '#eee';
    ctx.beginPath();
    ctx.ellipse(hx + hw/2, hy + 20, hw/2 - 18, 5, 0, 0, Math.PI*2);
    ctx.fill();
    // Blanket (lower half, draped)
    ctx.fillStyle = '#7ab6c6';
    ctx.beginPath();
    ctx.moveTo(hx, hy + 30);
    ctx.lineTo(hx + hw, hy + 30);
    ctx.lineTo(hx + hw + 5, hy + hh);
    ctx.lineTo(hx - 5, hy + hh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Blanket fold
    ctx.strokeStyle = '#6aa6b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(hx + 10, hy + 35);
    ctx.quadraticCurveTo(hx + hw/2, hy + 45, hx + hw - 10, hy + 35);
    ctx.stroke();
    // Legs
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(hx + 5, hy + hh, 6, 8);
    ctx.fillRect(hx + hw - 11, hy + hh, 6, 8);

  } else if (key === 'cat_bed') {
    // Donut cat bed with fluffy walls
    const cx = w/2, cy = h/2, rx = w/2, ry = h/2;
    // Outer fluffy rim (darker)
    ctx.fillStyle = '#c65a3b';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Fluffy bumps on rim
    ctx.fillStyle = '#d66a4b';
    for (let a = 0; a < Math.PI*2; a += 0.4) {
      const bx = cx + Math.cos(a) * (rx - 2);
      const by = cy + Math.sin(a) * (ry - 2);
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI*2);
      ctx.fill();
    }
    // Inner cushion
    ctx.fillStyle = '#fff3e0';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 12, ry - 12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Cushion shading
    ctx.fillStyle = '#ffe8d0';
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 3, rx - 18, ry - 18, 0, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'water_bowl') {
    // Realistic bowl with water
    const cx = w/2, cy = h/2;
    // Bowl outer (ceramic)
    ctx.fillStyle = '#e0f7fa';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Bowl rim
    ctx.fillStyle = '#b2ebf2';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w/2, h/2 - 4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Water surface
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.ellipse(cx, cy, w/2 - 4, h/2 - 6, 0, 0, Math.PI*2);
    ctx.fill();
    // Water highlight
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(cx - 6, cy - 3, w/4 - 2, h/4 - 3, -0.3, 0, Math.PI*2);
    ctx.fill();
    // Small ripple
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx + 4, cy + 2, 4, 2, 0.2, 0, Math.PI*2);
    ctx.stroke();

  } else if (key === 'food_bowl') {
    // Realistic bowl with food
    const cx = w/2, cy = h/2;
    // Bowl outer
    ctx.fillStyle = '#f5e6d3';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Bowl inner
    ctx.fillStyle = '#e8d5c0';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w/2, h/2 - 4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Food base (dry food color)
    ctx.fillStyle = '#a0522d';
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w/2 - 5, h/2 - 7, 0, 0, Math.PI*2);
    ctx.fill();
    // Food on top if recently fed
    if (foodInBowl && foodInBowl.timer > 0) {
      const foodColors = { dry: '#d2691e', wet: '#8b4513', wagyu: '#ff4444', roadkill: '#556b2f', tuna: '#4682b4', salmon: '#fa8072', chicken: '#daa520', shrimp: '#ff7f50', catnip_treat: '#9acd32', sushi: '#ff69b4' };
      ctx.fillStyle = foodColors[foodInBowl.type] || '#d2691e';
      // Draw food shapes based on type
      if (foodInBowl.type === 'tuna' || foodInBowl.type === 'salmon') {
        // Fish shape
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, w/2 - 8, h/2 - 10, 0, 0, Math.PI*2);
        ctx.fill();
        // Tail
        ctx.beginPath();
        ctx.moveTo(cx + w/2 - 8, cy - 2);
        ctx.lineTo(cx + w/2 + 2, cy - 6);
        ctx.lineTo(cx + w/2 + 2, cy + 2);
        ctx.closePath();
        ctx.fill();
        // Eye
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.arc(cx - 4, cy - 4, 2, 0, Math.PI*2);
        ctx.fill();
      } else if (foodInBowl.type === 'chicken') {
        // Drumstick shape
        ctx.fillStyle = foodColors[foodInBowl.type];
        ctx.beginPath();
        ctx.ellipse(cx, cy + 2, w/2 - 6, h/2 - 8, 0, 0, Math.PI*2);
        ctx.fill();
        // Bone
        ctx.fillStyle = '#f5f5dc';
        ctx.fillRect(cx + 6, cy - 8, 4, 10);
        ctx.beginPath();
        ctx.arc(cx + 8, cy - 10, 3, 0, Math.PI*2);
        ctx.fill();
      } else if (foodInBowl.type === 'shrimp') {
        // Curved shrimp
        ctx.fillStyle = foodColors[foodInBowl.type];
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, w/2 - 8, h/2 - 10, 0.3, 0, Math.PI*2);
        ctx.fill();
        // Segments
        ctx.strokeStyle = '#ff6347';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(cx - 2, cy - 2, w/4 - 2, 0.5, Math.PI - 0.5);
        ctx.stroke();
      } else if (foodInBowl.type === 'catnip_treat') {
        // Star shape
        ctx.fillStyle = foodColors[foodInBowl.type];
        const drawStar = (sx, sy, r) => {
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const angle = (i * 4 * Math.PI / 5) - Math.PI / 2;
            const px = sx + Math.cos(angle) * r;
            const py = sy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        };
        drawStar(cx, cy - 2, w/3 - 2);
        drawStar(cx - 6, cy + 2, w/5);
      } else if (foodInBowl.type === 'sushi') {
        // Sushi rolls
        ctx.fillStyle = '#2f2f2f';
        ctx.beginPath();
        ctx.roundRect(cx - 8, cy - 4, 8, 8, 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(cx + 2, cy - 4, 8, 8, 2);
        ctx.fill();
        // Rice
        ctx.fillStyle = '#fff8dc';
        ctx.beginPath();
        ctx.roundRect(cx - 6, cy - 2, 4, 4, 1);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(cx + 4, cy - 2, 4, 4, 1);
        ctx.fill();
        // Topping
        ctx.fillStyle = '#ff69b4';
        ctx.fillRect(cx - 6, cy - 4, 4, 2);
        ctx.fillRect(cx + 4, cy - 4, 4, 2);
      } else {
        // Default mound
        ctx.beginPath();
        ctx.ellipse(cx, cy - 2, w/2 - 8, h/2 - 10, 0, 0, Math.PI*2);
        ctx.fill();
        // Food chunks/pellets
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        for (let i = 0; i < 5; i++) {
          const angle = (i / 5) * Math.PI * 2 + 0.5;
          const fx = cx + Math.cos(angle) * (w/4 - 2);
          const fy = cy - 2 + Math.sin(angle) * (h/4 - 2);
          ctx.beginPath();
          ctx.arc(fx, fy, 2 + Math.random(), 0, Math.PI*2);
          ctx.fill();
        }
      }
    } else {
      // Default dry food visible
      ctx.fillStyle = '#cd853f';
      ctx.beginPath();
      ctx.ellipse(cx, cy, w/2 - 6, h/2 - 8, 0, 0, Math.PI*2);
      ctx.fill();
      // Pellets
      ctx.fillStyle = '#b87333';
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + 0.3;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(angle)*6, cy + Math.sin(angle)*3, 2.5, 0, Math.PI*2);
        ctx.fill();
      }
    }

  } else if (key === 'sandbox') {
    // Litter box with high sides and litter
    const sx = 0, sy = 0, sw = w, sh = h;
    // Bottom/base shadow
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(sx + 3, sy + sh + 2, sw, 4);
    // Back wall (tall)
    ctx.fillStyle = '#d4a373';
    ctx.fillRect(sx + 5, sy - 8, sw - 10, 12);
    ctx.strokeRect(sx + 5, sy - 8, sw - 10, 12);
    // Left wall
    ctx.fillStyle = '#c49365';
    ctx.beginPath();
    ctx.moveTo(sx, sy + 4);
    ctx.lineTo(sx + 5, sy - 8);
    ctx.lineTo(sx + 5, sy + sh - 5);
    ctx.lineTo(sx, sy + sh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Right wall
    ctx.beginPath();
    ctx.moveTo(sx + sw, sy + 4);
    ctx.lineTo(sx + sw - 5, sy - 8);
    ctx.lineTo(sx + sw - 5, sy + sh - 5);
    ctx.lineTo(sx + sw, sy + sh);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Front wall (lower for cat entry)
    ctx.fillStyle = '#d4a373';
    ctx.fillRect(sx, sy + sh - 12, sw, 12);
    ctx.strokeRect(sx, sy + sh - 12, sw, 12);
    // Litter inside
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(sx + 6, sy + 2, sw - 12, sh - 14);
    // Litter granules texture
    ctx.fillStyle = '#f0d080';
    for (let i = 0; i < 15; i++) {
      const lx = sx + 10 + Math.random() * (sw - 20);
      const ly = sy + 5 + Math.random() * (sh - 20);
      ctx.fillRect(lx, ly, 2, 2);
    }
    ctx.fillStyle = '#d4a350';
    for (let i = 0; i < 10; i++) {
      const lx = sx + 10 + Math.random() * (sw - 20);
      const ly = sy + 5 + Math.random() * (sh - 20);
      ctx.fillRect(lx, ly, 2, 2);
    }
    // Scoop hint on front
    ctx.fillStyle = '#b08d5e';
    ctx.fillRect(sx + sw/2 - 8, sy + sh - 8, 16, 4);

  } else if (key === 'cat_tree') {
    // Cat tree with trunk, platforms, and dangling toy
    const tx = 0, ty = 0, tw = w, th = h;
    // Base
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(tx - 5, ty + th - 12, tw + 10, 12);
    ctx.strokeRect(tx - 5, ty + th - 12, tw + 10, 12);
    // Trunk (textured)
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(tx + tw/2 - 10, ty + 20, 20, th - 32);
    ctx.strokeRect(tx + tw/2 - 10, ty + 20, 20, th - 32);
    // Trunk rope texture lines
    ctx.strokeStyle = '#7a5e52';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.moveTo(tx + tw/2 - 8 + i*3.5, ty + 22);
      ctx.lineTo(tx + tw/2 - 8 + i*3.5, ty + th - 14);
      ctx.stroke();
    }
    // Platform 1 (lower)
    ctx.fillStyle = '#a8d5a2';
    ctx.fillRect(tx - 5, ty + th/2 - 5, tw + 10, 10);
    ctx.strokeRect(tx - 5, ty + th/2 - 5, tw + 10, 10);
    // Platform 2 (upper)
    ctx.fillRect(tx - 5, ty + 20, tw + 10, 10);
    ctx.strokeRect(tx - 5, ty + 20, tw + 10, 10);
    // Dangling toy
    const toyY = ty + th/2 + Math.sin(Date.now() / 500) * 5;
    ctx.strokeStyle = '#e76f51';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tx + tw/2, ty + th/2);
    ctx.lineTo(tx + tw/2, toyY);
    ctx.stroke();
    ctx.fillStyle = '#e76f51';
    ctx.beginPath();
    ctx.arc(tx + tw/2, toyY + 5, 4, 0, Math.PI*2);
    ctx.fill();
    // Top perch
    ctx.fillStyle = '#a8d5a2';
    ctx.beginPath();
    ctx.ellipse(tx + tw/2, ty + 10, tw/2 + 5, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

  } else if (key === 'lounger') {
    // Chaise lounger
    const lx = 0, ly = 0, lw = w, lh = h;
    // Backrest (angled)
    ctx.fillStyle = '#e08d4f';
    ctx.beginPath();
    ctx.moveTo(lx + 5, ly + lh/2);
    ctx.lineTo(lx + lw - 5, ly + lh/2);
    ctx.lineTo(lx + lw - 15, ly);
    ctx.lineTo(lx + 15, ly);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Seat
    ctx.fillStyle = '#f4a261';
    ctx.fillRect(lx, ly + lh/2 - 5, lw, lh/2 + 5);
    ctx.strokeRect(lx, ly + lh/2 - 5, lw, lh/2 + 5);
    // Cushion
    ctx.fillStyle = '#f5b07a';
    ctx.fillRect(lx + 5, ly + lh/2, lw - 10, lh/2 - 8);
    ctx.strokeRect(lx + 5, ly + lh/2, lw - 10, lh/2 - 8);
    // Legs
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(lx + 5, ly + lh, 5, 6);
    ctx.fillRect(lx + lw - 10, ly + lh, 5, 6);

  } else if (key === 'toy_mouse') {
    // Detailed mouse with ears, tail, eyes
    const mx = w/2, my = h/2;
    // Body
    ctx.fillStyle = '#adb5bd';
    ctx.beginPath();
    ctx.ellipse(mx, my, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Ears
    ctx.fillStyle = '#949da6';
    ctx.beginPath();
    ctx.arc(mx - w/3, my - h/2 + 2, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx + w/3, my - h/2 + 2, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffcdd2';
    ctx.beginPath();
    ctx.arc(mx - w/3, my - h/2 + 2, 3, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(mx + w/3, my - h/2 + 2, 3, 0, Math.PI*2);
    ctx.fill();
    // Tail
    ctx.strokeStyle = '#adb5bd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mx + w/2, my);
    ctx.quadraticCurveTo(mx + w/2 + 10, my - 5, mx + w/2 + 15, my + 3);
    ctx.stroke();
    // Eye
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(mx - 3, my - 2, 2, 0, Math.PI*2);
    ctx.fill();
    // Nose
    ctx.fillStyle = '#ffcdd2';
    ctx.beginPath();
    ctx.arc(mx - w/2 + 2, my, 2, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'scratch_post') {
    // Cylindrical scratching post with rope texture
    const sx = 0, sy = 0, sw = w, sh = h;
    // Base
    ctx.fillStyle = '#6d4c41';
    ctx.fillRect(sx - 10, sy + sh - 10, sw + 20, 10);
    ctx.strokeRect(sx - 10, sy + sh - 10, sw + 20, 10);
    // Post cylinder
    ctx.fillStyle = '#c4a47c';
    ctx.fillRect(sx + 5, sy + 5, sw - 10, sh - 15);
    ctx.strokeRect(sx + 5, sy + 5, sw - 10, sh - 15);
    // Rope texture (diagonal lines)
    ctx.strokeStyle = '#b08d5e';
    ctx.lineWidth = 1;
    for (let i = -3; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(sx + 5, sy + 10 + i * 10);
      ctx.lineTo(sx + sw - 5, sy + 20 + i * 10);
      ctx.stroke();
    }
    // Top cap
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(sx, sy, sw, 10);
    ctx.strokeRect(sx, sy, sw, 10);
    ctx.fillStyle = '#a1887f';
    ctx.fillRect(sx + 3, sy + 2, sw - 6, 4);

  } else {
    ctx.fillStyle = l.color;
    ctx.fillRect(0, 0, l.w || 60, l.h || 60);
    ctx.strokeRect(0, 0, l.w || 60, l.h || 60);
  }
  ctx.restore();
}

function drawMess(m) {
  const t = Date.now() / 1000;
  if (m.type === 'piss') {
    // Animated puddle: slowly pulses and has a steam wisp
    const pulse = 1 + Math.sin(t * 3 + m.x) * 0.1;
    ctx.fillStyle = 'rgba(230, 200, 50, 0.6)';
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 16 * pulse, 10 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 170, 30, 0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Inner brighter puddle
    ctx.fillStyle = 'rgba(255, 230, 100, 0.3)';
    ctx.beginPath();
    ctx.ellipse(m.x, m.y, 10 * pulse, 6 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();
    // Steam wisp
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    const sy = m.y - 15 - ((t * 20 + m.x) % 30);
    const sx = m.x + Math.sin(t * 2 + m.x) * 5;
    ctx.beginPath();
    ctx.ellipse(sx, sy, 3, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Animated poop: wiggles slightly, occasional fly
    const wiggleX = Math.sin(t * 4 + m.y) * 1.5;
    const wiggleY = Math.cos(t * 3 + m.x) * 1;
    ctx.fillStyle = '#5d4037';
    ctx.beginPath();
    ctx.ellipse(m.x + wiggleX, m.y + wiggleY, 8, 6, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(m.x + 5 + wiggleX, m.y - 3 + wiggleY, 6, 5, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // Occasional fly
    const flyPhase = (t * 0.8 + m.x) % 10;
    if (flyPhase < 4) {
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(m.x + 10 + Math.sin(t * 8) * 8, m.y - 12 + Math.cos(t * 6) * 5, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Fly wings
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(m.x + 10 + Math.sin(t * 8) * 8 - 2, m.y - 12 + Math.cos(t * 6) * 5, 3, 1, t * 4, 0, Math.PI * 2);
      ctx.fill();
    }
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
  const type = cat.type || 'Tabby';

  // Shadow (breed-sized)
  const shadowScale = type === 'Maine Coon' ? 1.2 : 1.0;
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(0, 35, 25 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  if (catSleeping && c.state !== 'play' && c.state !== 'eat' && c.state !== 'piss') {
    drawNapCat(fur, eye, type, c.frame);
  } else if (c.state === 'nap') {
    drawNapCat(fur, eye, type, c.frame);
  } else if (c.state === 'loaf') {
    drawLoafCat(fur, eye, type, c.frame);
  } else if (c.state === 'sit') {
    drawSitCat(fur, eye, type, bounce, c.frame);
  } else if (c.state === 'piss') {
    drawPissCat(fur, eye, type, bounce, c.frame);
  } else if (c.state === 'eat') {
    drawEatCat(fur, eye, type, bounce, c.frame);
  } else if (c.state === 'petted') {
    drawPettedCat(fur, eye, type, bounce, c.frame);
  } else if (c.state === 'play') {
    drawPlayCat(fur, eye, type, bounce, isWalking, c.frame);
  } else {
    drawStandingCat(fur, eye, type, bounce, isWalking, c.frame);
  }

  ctx.restore();

  // Hearts when petted
  if (c.heartTimer > 0) {
    ctx.fillStyle = '#e76f51';
    const hx = x + (Math.random() - 0.5) * 30;
    const hy = y - 40 - (60 - c.heartTimer);
    ctx.font = '20px sans-serif';
    ctx.fillText('❤', hx, hy);
  }

  // Zzz when napping
  if (c.state === 'nap') {
    ctx.fillStyle = '#666';
    ctx.font = '16px sans-serif';
    const zy = y - 40 - Math.sin(c.frame * 0.05) * 10;
    ctx.fillText('Z', x + 20, zy);
    if (c.frame % 120 > 60) ctx.fillText('z', x + 28, zy - 12);
  }

  // Hand petting animation
  if (pettingHand && pettingHand.timer > 0) {
    const bob = Math.sin(pettingHand.timer * 0.3) * 5;
    const hx = pettingHand.x;
    const hy = pettingHand.y + bob;
    // Rounded cartoon hand with sausage fingers
    ctx.fillStyle = '#f5cba7';
    ctx.strokeStyle = '#c4956a';
    ctx.lineWidth = 1.5;
    // Palm
    ctx.beginPath();
    ctx.ellipse(hx, hy, 18, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Four rounded fingers (sausage style)
    const fingerW = 5, fingerH = 14;
    const fingerSpacing = 7;
    const fingerStart = hx - 10;
    for (let i = 0; i < 4; i++) {
      const fx = fingerStart + i * fingerSpacing;
      const fy = hy - 18;
      ctx.fillStyle = '#f5cba7';
      ctx.beginPath();
      ctx.roundRect(fx - fingerW/2, fy, fingerW, fingerH, 3);
      ctx.fill();
      ctx.stroke();
      // Fingertip
      ctx.fillStyle = '#ffccbc';
      ctx.beginPath();
      ctx.arc(fx, fy + 2, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Thumb
    ctx.fillStyle = '#f5cba7';
    ctx.beginPath();
    ctx.ellipse(hx + 14, hy + 2, 5, 10, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
    if (ctx.roundRect) {
      ctx.roundRect(bx, by, bw, 30, 8);
    } else {
      ctx.rect(bx, by, bw, 30);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(c.bubble.text, x, by + 20);
    ctx.textAlign = 'left';
  }
}


// ===== BREED HELPERS =====
function getBreedScale(type) {
  if (type === 'Maine Coon') return 1.15;
  if (type === 'Persian') return 1.05;
  return 1.0;
}

function getPointColor(fur) {
  // Darken fur color for Siamese points
  return shadeColor(fur, -40);
}

function shadeColor(color, percent) {
  const num = parseInt(color.replace('#',''), 16);
  const amt = Math.round(2.55 * percent);
  const R = Math.max(0, Math.min(255, (num >> 16) + amt));
  const G = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amt));
  const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
  return '#' + (0x1000000 + R*0x10000 + G*0x100 + B).toString(16).slice(1);
}

function drawBreedEars(ctx, type, fur, bounce, xOff, yOff) {
  ctx.fillStyle = fur;
  if (type === 'Scottish Fold') {
    // Folded ears - rounded, no points
    ctx.beginPath();
    ctx.ellipse(-2 + xOff, -32 + bounce + yOff, 7, 5, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22 + xOff, -32 + bounce + yOff, 7, 5, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.ellipse(-2 + xOff, -32 + bounce + yOff, 4, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22 + xOff, -32 + bounce + yOff, 4, 3, 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'Sphynx') {
    // Large bat-like ears
    ctx.beginPath();
    ctx.moveTo(-4 + xOff, -22 + bounce + yOff);
    ctx.lineTo(-18 + xOff, -48 + bounce + yOff);
    ctx.lineTo(6 + xOff, -28 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(24 + xOff, -22 + bounce + yOff);
    ctx.lineTo(38 + xOff, -48 + bounce + yOff);
    ctx.lineTo(16 + xOff, -28 + bounce + yOff);
    ctx.fill();
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(-2 + xOff, -24 + bounce + yOff);
    ctx.lineTo(-14 + xOff, -42 + bounce + yOff);
    ctx.lineTo(4 + xOff, -28 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22 + xOff, -24 + bounce + yOff);
    ctx.lineTo(34 + xOff, -42 + bounce + yOff);
    ctx.lineTo(16 + xOff, -28 + bounce + yOff);
    ctx.fill();
  } else if (type === 'Maine Coon') {
    // Tufted ears - tall with extra tuft
    ctx.beginPath();
    ctx.moveTo(-2 + xOff, -24 + bounce + yOff);
    ctx.lineTo(-12 + xOff, -56 + bounce + yOff);
    ctx.lineTo(6 + xOff, -30 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20 + xOff, -26 + bounce + yOff);
    ctx.lineTo(30 + xOff, -56 + bounce + yOff);
    ctx.lineTo(30 + xOff, -28 + bounce + yOff);
    ctx.fill();
    // Tufts
    ctx.strokeStyle = fur;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12 + xOff, -56 + bounce + yOff);
    ctx.lineTo(-16 + xOff, -62 + bounce + yOff);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(30 + xOff, -56 + bounce + yOff);
    ctx.lineTo(34 + xOff, -62 + bounce + yOff);
    ctx.stroke();
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(0 + xOff, -30 + bounce + yOff);
    ctx.lineTo(-8 + xOff, -48 + bounce + yOff);
    ctx.lineTo(4 + xOff, -34 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20 + xOff, -30 + bounce + yOff);
    ctx.lineTo(26 + xOff, -48 + bounce + yOff);
    ctx.lineTo(26 + xOff, -32 + bounce + yOff);
    ctx.fill();
  } else if (type === 'Persian') {
    // Small ears, round head
    ctx.beginPath();
    ctx.ellipse(-2 + xOff, -30 + bounce + yOff, 5, 4, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22 + xOff, -30 + bounce + yOff, 5, 4, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.ellipse(-2 + xOff, -30 + bounce + yOff, 3, 2, -0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(22 + xOff, -30 + bounce + yOff, 3, 2, 0.2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Default pointy ears (Tabby, Siamese, Calico)
    ctx.beginPath();
    ctx.moveTo(-2 + xOff, -22 + bounce + yOff);
    ctx.lineTo(-10 + xOff, -46 + bounce + yOff);
    ctx.lineTo(6 + xOff, -28 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(16 + xOff, -24 + bounce + yOff);
    ctx.lineTo(26 + xOff, -46 + bounce + yOff);
    ctx.lineTo(30 + xOff, -28 + bounce + yOff);
    ctx.fill();
    ctx.fillStyle = '#ffccbc';
    ctx.beginPath();
    ctx.moveTo(0 + xOff, -26 + bounce + yOff);
    ctx.lineTo(-6 + xOff, -40 + bounce + yOff);
    ctx.lineTo(4 + xOff, -30 + bounce + yOff);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(18 + xOff, -28 + bounce + yOff);
    ctx.lineTo(24 + xOff, -40 + bounce + yOff);
    ctx.lineTo(26 + xOff, -28 + bounce + yOff);
    ctx.fill();
  }
}

function drawTabbyStripes(ctx, fur, x, y, w, h) {
  ctx.strokeStyle = shadeColor(fur, -25);
  ctx.lineWidth = 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x - w/2 + 5, y - h/2 + 8 + i * 10);
    ctx.lineTo(x + w/2 - 5, y - h/2 + 12 + i * 10);
    ctx.stroke();
  }
}

function drawCalicoPatches(ctx, fur, x, y, w, h) {
  const patchColors = ['#e67e22', '#2c3e50', '#ecf0f1'];
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = patchColors[i % 3];
    const px = x + (Math.sin(i * 2.7) * w * 0.3);
    const py = y + (Math.cos(i * 1.9) * h * 0.3);
    ctx.beginPath();
    ctx.ellipse(px, py, 6 + i * 2, 5 + i, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSiamesePoints(ctx, fur, x, y) {
  const dark = getPointColor(fur);
  ctx.fillStyle = dark;
  // Face mask
  ctx.beginPath();
  ctx.ellipse(x + 12, y - 15, 14, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  // Paws
  ctx.beginPath();
  ctx.ellipse(x - 15, y + 25, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + 12, y + 25, 6, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawSphynxWrinkles(ctx, x, y) {
  ctx.strokeStyle = 'rgba(200, 150, 150, 0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 5); ctx.lineTo(x + 5, y - 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, y + 5); ctx.lineTo(x + 10, y + 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 2, y - 12); ctx.quadraticCurveTo(x + 8, y - 15, x + 12, y - 10);
  ctx.stroke();
}

function drawStandingCat(fur, eye, type, bounce, isWalking, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Tail
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 11 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const tailWag = Math.sin(frame * 0.15) * 10;
  const tailLen = type === 'Maine Coon' ? -50 : -35;
  ctx.moveTo(-20, 10);
  ctx.quadraticCurveTo(-40, -10 + tailWag, tailLen, -30 + tailWag * 0.5);
  ctx.stroke();
  if (type === 'Maine Coon') {
    // Bushy tail tip
    ctx.fillStyle = fur;
    ctx.beginPath();
    ctx.ellipse(tailLen, -30 + tailWag * 0.5, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Body
  ctx.fillStyle = fur;
  ctx.beginPath();
  if (type === 'Persian') {
    ctx.ellipse(0, 10, 30, 24, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(0, 10, 28, 22, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  // Body patterns
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 10, 28, 22);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 10, 28, 22);
  if (type === 'Sphynx') drawSphynxWrinkles(ctx, 0, 10);

  // Legs
  const legOffset = isWalking ? Math.sin(frame * 0.3) * 6 : 0;
  ctx.fillStyle = fur;
  ctx.fillRect(-18, 20 + legOffset, 10, 16);
  ctx.fillRect(8, 20 - legOffset, 10, 16);
  if (type === 'Siamese') {
    ctx.fillStyle = getPointColor(fur);
    ctx.beginPath(); ctx.ellipse(-13, 28 + legOffset, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(13, 28 - legOffset, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Head
  ctx.fillStyle = fur;
  if (type === 'Persian') {
    ctx.beginPath();
    ctx.ellipse(12, -15 + bounce, 24, 20, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(12, -15 + bounce, 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ears
  drawBreedEars(ctx, type, fur, bounce, 0, 0);

  // Face
  if (type === 'Persian') {
    // Flat face - pushed in
    ctx.fillStyle = shadeColor(fur, -10);
    ctx.beginPath();
    ctx.ellipse(14, -10 + bounce, 10, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    // Squished nose
    ctx.fillStyle = '#ffab91';
    ctx.beginPath();
    ctx.ellipse(14, -8 + bounce, 4, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = '#ffab91';
    ctx.beginPath();
    ctx.arc(14, -8 + bounce, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(4, -18 + bounce, 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22, -18 + bounce, 7, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = eyeColor;
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

  // Mouth
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  if (type === 'Persian') {
    ctx.beginPath();
    ctx.arc(10, -4 + bounce, 3, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, -4 + bounce, 3, 0, Math.PI);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(10, -5 + bounce, 4, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(18, -5 + bounce, 4, 0, Math.PI);
    ctx.stroke();
  }

  // Whiskers
  ctx.strokeStyle = type === 'Sphynx' ? 'rgba(180,120,120,0.4)' : '#bbb';
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
}

function drawSitCat(fur, eye, type, bounce, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Tail curled around
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 11 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-15, 15, 18, Math.PI, Math.PI * 1.7);
  ctx.stroke();

  // Body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 5, 22, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 5, 22, 26);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 5, 22, 26);
  if (type === 'Sphynx') drawSphynxWrinkles(ctx, 0, 5);

  // Front legs
  ctx.fillStyle = fur;
  ctx.fillRect(-12, 18, 8, 14);
  ctx.fillRect(4, 18, 8, 14);
  if (type === 'Siamese') {
    ctx.fillStyle = getPointColor(fur);
    ctx.beginPath(); ctx.ellipse(-8, 25, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8, 25, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Head
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(10, -22 + bounce, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, bounce, -2, 10);

  // Eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.ellipse(4, -24 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(20, -24 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath(); ctx.arc(5, -23 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(21, -23 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();

  // Pupils
  ctx.fillStyle = '#222';
  ctx.beginPath(); ctx.arc(5, -23 + bounce, 1.8, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(21, -23 + bounce, 1.8, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawNapCat(fur, eye, type, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Curled body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 10, 26, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 10, 26, 20);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 10, 26, 20);

  // Head tucked in
  ctx.beginPath();
  ctx.arc(14, 8, 16, 0, Math.PI * 2);
  ctx.fill();

  // Tail wrapped around
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 11 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-10, 12, 20, Math.PI * 0.8, Math.PI * 1.6);
  ctx.stroke();

  // Closed eyes (lines)
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(8, 6); ctx.lineTo(14, 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(18, 6); ctx.lineTo(24, 6);
  ctx.stroke();

  ctx.restore();
}


function drawLoafCat(fur, eye, type, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Loaf body - compact oval
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 15, 30, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shadeColor(fur, -20);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tucked paws (just little bumps)
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(-18, 22, 8, 5, 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(18, 22, 8, 5, -0.3, 0, Math.PI * 2);
  ctx.fill();

  // Head
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(0, -10, 18, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, 0, 0, 0);

  // Face (consistent, not random)
  drawCatFace(ctx, eye, type, 0, -10, false);

  // Tail wrapped around
  ctx.strokeStyle = fur;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(25, 15, 15, -Math.PI * 0.5, Math.PI * 0.8);
  ctx.stroke();

  ctx.restore();
}

function drawPissCat(fur, eye, type, bounce, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Squatting body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 18, 26, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 18, 26, 16);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 18, 26, 16);

  // Legs splayed
  ctx.fillStyle = fur;
  ctx.fillRect(-20, 22, 10, 10);
  ctx.fillRect(10, 22, 10, 10);
  if (type === 'Siamese') {
    ctx.fillStyle = getPointColor(fur);
    ctx.beginPath(); ctx.ellipse(-15, 27, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(15, 27, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Tail straight out
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 11 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, 15);
  ctx.lineTo(-45, 10 + Math.sin(frame * 0.3) * 3);
  ctx.stroke();

  // Head
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(12, -5 + bounce, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, bounce, 0, 17);

  // Eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.ellipse(4, -8 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(22, -8 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath(); ctx.arc(5, -7 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(23, -7 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

function drawEatCat(fur, eye, type, bounce, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Body
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 10, 28, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 10, 28, 22);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 10, 28, 22);

  // Head
  ctx.beginPath();
  ctx.arc(12, -5 + bounce, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, bounce, 0, 17);

  // Eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  ctx.fillStyle = 'white';
  ctx.beginPath(); ctx.ellipse(4, -8 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(22, -8 + bounce, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath(); ctx.arc(5, -7 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(23, -7 + bounce, 3.5, 0, Math.PI * 2); ctx.fill();

  // Mouth chewing
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  const chew = Math.sin(frame * 0.2) * 2;
  ctx.beginPath();
  ctx.arc(10, 2 + bounce + chew, 3, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(18, 2 + bounce + chew, 3, 0, Math.PI);
  ctx.stroke();

  ctx.restore();
}


function drawPettedCat(fur, eye, type, bounce, frame) {
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);
  const purrVibe = Math.sin(frame * 0.8) * 1.5;

  // Tail curled, twitching slightly
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 11 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-15 + purrVibe, 15, 18, Math.PI, Math.PI * 1.7);
  ctx.stroke();

  // Body vibrating
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(purrVibe, 5, 22, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, purrVibe, 5, 22, 26);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, purrVibe, 5, 22, 26);

  // Front legs tucked
  ctx.fillRect(-12 + purrVibe, 18, 8, 14);
  ctx.fillRect(4 + purrVibe, 18, 8, 14);

  // Head
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.arc(10 + purrVibe, -22 + bounce, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, bounce, -2 + purrVibe, 10);

  // Closed happy eyes
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(4 + purrVibe, -22 + bounce, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(20 + purrVibe, -22 + bounce, 4, 0.2, Math.PI - 0.2);
  ctx.stroke();

  // Tiny smile
  ctx.beginPath();
  ctx.arc(12 + purrVibe, -12 + bounce, 5, 0.1, Math.PI - 0.1);
  ctx.stroke();

  ctx.restore();
}

function drawPlayCat(fur, eye, type, bounce, isWalking, frame) {
  // Similar to standing but more energetic - pounce pose
  const scale = getBreedScale(type);
  ctx.save();
  ctx.scale(scale, scale);

  // Body (crouched, ready to pounce)
  ctx.fillStyle = fur;
  ctx.beginPath();
  ctx.ellipse(0, 15, 26, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 15, 26, 18);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 15, 26, 18);

  // Back legs (coiled)
  ctx.fillRect(-18, 20, 10, 12);
  ctx.fillRect(8, 20, 10, 12);
  // Front legs (reaching)
  ctx.fillRect(-10, 22, 7, 14);
  ctx.fillRect(6, 22, 7, 14);

  // Head (alert, looking forward)
  ctx.beginPath();
  ctx.arc(12, -12 + bounce, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears (alert, forward)
  drawBreedEars(ctx, type, fur, bounce, 0, 0);

  // Wide alert eyes
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  ctx.fillStyle = 'white';
  ctx.beginPath();
  ctx.ellipse(4, -16 + bounce, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22, -16 + bounce, 8, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(5, -15 + bounce, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -15 + bounce, 4.5, 0, Math.PI * 2);
  ctx.fill();

  // Pupils (dilated - excited)
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(5, -15 + bounce, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -15 + bounce, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Nose
  ctx.fillStyle = '#ffab91';
  ctx.beginPath();
  ctx.arc(14, -7 + bounce, 3, 0, Math.PI * 2);
  ctx.fill();

  // Open mouth (excited)
  ctx.fillStyle = '#ffab91';
  ctx.beginPath();
  ctx.ellipse(14, -2 + bounce, 4, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawGame() {
  ctx.clearRect(0, 0, ROOM_W, ROOM_H);
  drawRoom();

  // Draw furniture
  const allFurniture = inventory.furniture || [];
  for (const f of allFurniture) {
    drawFurnitureItem(f.item_type, f);
  }

  // Draw messes
  for (const m of messes) drawMess(m);

  // Draw play ball
  if (playBall) drawPlayBall();

  updateCatAI();
  drawCat();
}

function drawPlayBall() {
  const b = playBall;
  if (!b) return;
  // Ball shadow
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(b.x, b.y + 8, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();
  // Ball body
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath();
  ctx.arc(b.x, b.y, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#c0392b';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Ball highlight
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath();
  ctx.arc(b.x - 2, b.y - 2, 3, 0, Math.PI * 2);
  ctx.fill();
  // Ball stripe
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(b.x, b.y, 7, 0.5, Math.PI - 0.5);
  ctx.stroke();
}

function gameLoop() {
  if (!screens.game.classList.contains('hidden')) {
    drawGame();
  }
  requestAnimationFrame(gameLoop);
}


// ===== PURR SOUND =====
let purrAudioCtx = null;
function playPurrSound() {
  try {
    if (!purrAudioCtx) purrAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = purrAudioCtx;
    const t = ctx.currentTime;
    // Low frequency rumble
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(25, t);
    osc1.frequency.linearRampToValueAtTime(28, t + 0.1);
    osc1.frequency.linearRampToValueAtTime(25, t + 0.2);
    gain1.gain.setValueAtTime(0.08, t);
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.5);
    // Second layer for texture
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(50, t);
    gain2.gain.setValueAtTime(0.04, t);
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(t + 0.05);
    osc2.stop(t + 0.45);
    // Choppy modulation for purr rhythm
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.setValueAtTime(25, t);
    lfoGain.gain.setValueAtTime(5, t);
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);
    lfo.start(t);
    lfo.stop(t + 0.5);
  } catch (e) { /* audio not supported */ }
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
        catEntity.heartTimer = 180;
        catEntity.bubble = { text: 'Purr...', timer: 180 };
        // Hand on cat's head
        pettingHand = { x: catEntity.x + (catEntity.facing * 12), y: catEntity.y - 35, timer: 180 };
        catEntity.state = 'petted';
        catEntity.timer = 0;
        catEntity.targetX = null;
        catEntity.targetY = null;
        catEntity.vx = 0;
        catEntity.vy = 0;
        playPurrSound();
      } else if (action === 'talk') {
        catEntity.bubble = { text: data.message, timer: 120 };
      } else if (action === 'play') {
        catEntity.state = 'play';
        catEntity.timer = 0;
        catEntity.bubble = { text: 'Meow!', timer: 90 };
        // Spawn a ball for the cat to chase
        const bx = 100 + Math.random() * 600;
        const by = 120 + Math.random() * 300;
        playBall = { x: bx, y: by, vx: (Math.random() - 0.5) * 3, vy: -3 - Math.random() * 2, timer: 300, bounces: 0 };
        setCatTarget(bx, by + 20, 'walk');
      }
    } catch (e) {
      logChat(e.message, true);
    }
  };
});

feedOptions.querySelectorAll('button[data-food]').forEach(btn => {
  btn.onclick = async () => {
    try {
      const foodType = btn.dataset.food;
      const data = await api('POST', '/api/cat/feed', { foodType });
      currentCat = data.cat;
      updateStats();
      logChat(data.message, false);
      catEntity.bubble = { text: 'Meow!', timer: 90 };
      foodInBowl = { type: foodType, timer: 600 };
      // Walk to food bowl
      const bowl = FURNITURE_LAYOUT.food_bowl;
      catEntity.pendingState = 'eat';
      setCatTarget(bowl.x, bowl.y + 10, 'walk');
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

// Clean
document.getElementById('btn-clean').onclick = async () => {
  try {
    const data = await api('POST', '/api/cat/clean');
    currentCat = data.cat;
    messes = [];
    updateStats();
    logChat(data.message, true);
  } catch (e) {
    logChat(e.message, true);
  }
};

// Reset game
document.getElementById('btn-reset-game').onclick = async () => {
  if (!confirm('Are you sure? This will delete your cat and all progress!')) return;
  try {
    await api('POST', '/api/cat/reset');
    currentCat = null;
    inventory = { items: [], furniture: [], money: 0 };
    messes = [];
    foodInBowl = null;
    pettingHand = null;
    catEntity.pendingState = null;
    showScreen('create');
    buildBreedGrid();
    updatePreview();
  } catch (e) {
    logChat(e.message, true);
  }
};

async function claimMorningBonus() {
  try {
    const data = await api('GET', '/api/morning-bonus');
    currentCat = data.cat;
    updateStats();
    logChat(`Morning bonus! +$${data.amount}`, true);
  } catch (e) { /* Already claimed or not 6am */ }
}

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
    if (data.gameDay) statGameDay.textContent = data.gameDay;
  } catch (e) { /* ignore */ }
}

// SHOP
const SHOP_DEF = [
  { id: 'dry_food', name: 'Dry Cat Food', cost: 5, desc: 'Basic nutrition' },
  { id: 'wet_food', name: 'Wet Cat Food', cost: 12, desc: 'Tasty and nutritious' },
  { id: 'wagyu_food', name: 'A5 Wagyu', cost: 50, desc: 'Ultra premium treat' },
  { id: 'roadkill_food', name: 'Roadkill', cost: 0, desc: 'Free... but gross' },
  { id: 'zucchini_food', name: 'Zucchini', cost: 8, desc: 'Green and healthy' },
  { id: 'tuna_food', name: 'Fresh Tuna', cost: 18, desc: 'Fish shaped!' },
  { id: 'salmon_food', name: 'Wild Salmon', cost: 22, desc: 'Pink and tasty' },
  { id: 'chicken_food', name: 'Chicken Drumstick', cost: 15, desc: 'Poultry treat' },
  { id: 'shrimp_food', name: 'Jumbo Shrimp', cost: 20, desc: 'Curved delight' },
  { id: 'catnip_treat_food', name: 'Catnip Treat', cost: 25, desc: 'Star shaped bliss' },
  { id: 'sushi_food', name: 'Cat Sushi', cost: 35, desc: 'Premium rolls' },
  { id: 'cat_tree', name: 'Cat Tree', cost: 80, desc: 'Climbing fun' },
  { id: 'lounger', name: 'Cat Lounger', cost: 45, desc: 'Comfy resting spot' },
  { id: 'toy_mouse', name: 'Toy Mouse', cost: 15, desc: 'Hunting practice' },
  { id: 'scratch_post', name: 'Scratching Post', cost: 30, desc: 'Save your furniture' },
  { id: 'tv', name: 'Flatscreen TV', cost: 120, desc: 'Watch cat videos' },
  { id: 'tv_stand', name: 'TV Stand', cost: 60, desc: 'Hold that TV' },
  { id: 'microwave', name: 'Microwave', cost: 40, desc: 'Heat up fish' },
  { id: 'sink', name: 'Kitchen Sink', cost: 55, desc: 'Wash paws' },
  { id: 'table', name: 'Dining Table', cost: 70, desc: 'Eat in style' },
  { id: 'chair1', name: 'Dining Chair', cost: 35, desc: 'Take a seat' },
  { id: 'chair2', name: 'Dining Chair', cost: 35, desc: 'Take a seat' }
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
  cdStartTime = Date.now();
  cdEarnings = 0;
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
let cdStartTime = 0;
let cdEarnings = 0;
let cdChatQueue = [];
const VIEWER_NAMES = ['CatLover99', 'WhiskerWatcher', 'MeowMaster', 'FelineFriend', 'PurrfectView',
  'TabbyTracker', 'KittenFan', 'CatDad42', 'FurryFanatic', 'PawPrint', 'MittensMOM',
  'LordOfCats', 'MeowserFan', 'Cattitude', 'FurReal', 'PawsomeViewer', 'CatLady4Life',
  'Clawdius', 'SirPurrAlot', 'CatVenturer', 'WhiskerWizard', 'Purrgrammer',
  'FluffyButt', 'ToeBeanCollector', 'NapQueen', 'ZoomiesExpert', 'TreatDispenser',
  'LaserPointerPro', 'BoxEnthusiast', 'SunbeamChaser', 'YarnConnoisseur', 'MrrpMrrp',
  'TailChaser3000', 'CatnipDealer', 'WindowWatcher', 'KeyboardSitter', 'PlantNibbler',
  'HairTieHoarder', 'CurtainClimber', 'ShoeSleeper', 'BagExplorer', 'SinkSitter'];
const VIEWER_COMMENTS = [
  'awww so cute!', 'what breed is that?', 'look at those eyes!', 'meow meow 🐱',
  'this cat is adorable', 'omg the fur color!', 'can i adopt this cat?',
  'so fluffy!', 'boop the snoot!', '*pets screen*',
  'best cat stream ever', 'i love cats', 'look at that tail!', 'so graceful',
  'big stretch!', 'those toe beans 😍', 'I would die for this cat',
  'is it nap time yet?', 'play with the mouse!', 'the paw! 🐾', 'fluffy baby!',
  'he\'s sitting like a perfect loaf', 'such a good kitty', 'that purr though',
  'look at those whiskers!', '10/10 would pet', 'majesty in motion',
  'where did you get this cat?', 'I want to squish that face',
  'kneading the blanket 🥰', 'judging me from the screen',
  'silent meow!!!', 'catching invisible bugs', 'rolling around!',
  'just fell off the couch lol', 'attacking own tail', 'making biscuits!',
  'show us the toe beans!', 'such polite paws', 'little gentleman',
  'queen behavior', 'derpy and perfect', 'chonk alert!',
  'liquid cat confirmed', 'fit in the box!', 'zoomies incoming!'
];
const DONATION_MESSAGES = [
  'just donated $5!', 'gifted 10 subs!', 'donated $10!', 'is now a member!',
  'sent a super chat!', 'tipped $3!', 'became a VIP!'
];
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

  cdCtx.fillStyle = '#b2ebf2';
  for (let i = 0; i < 5; i++) {
    cdCtx.beginPath();
    cdCtx.arc(100 + i * 150, 400, 40 + i * 5, 0, Math.PI * 2);
    cdCtx.fill();
  }

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

  for (const [id, c] of catdergartenCats) {
    drawSimpleCat(cdCtx, c.x, c.y, c.furColor || '#d4a373', c.name, c.frame);
  }

  // LIVESTREAM OVERLAY
  const now = Date.now();
  
  // LIVE badge with pulse
  cdCtx.fillStyle = '#ff0000';
  cdCtx.beginPath();
  cdCtx.roundRect(10, 10, 60, 28, 4);
  cdCtx.fill();
  cdCtx.fillStyle = 'white';
  cdCtx.font = 'bold 14px sans-serif';
  cdCtx.textAlign = 'center';
  cdCtx.fillText('LIVE', 40, 29);
  // Pulsing dot
  const pulse = 0.5 + Math.sin(now / 200) * 0.5;
  cdCtx.fillStyle = `rgba(255, 255, 255, ${pulse})`;
  cdCtx.beginPath();
  cdCtx.arc(52, 24, 4, 0, Math.PI * 2);
  cdCtx.fill();
  
  // Viewer count - changes slowly by 1
  const now2 = Date.now();
  if (now2 - lastViewerChange > 2000) {
    targetViewerCount = catdergartenCats.size + Math.floor(Math.random() * 50) + 10;
    lastViewerChange = now;
  }
  if (currentViewerCount < targetViewerCount) currentViewerCount++;
  if (currentViewerCount > targetViewerCount) currentViewerCount--;
  cdCtx.fillStyle = 'rgba(0,0,0,0.6)';
  cdCtx.beginPath();
  cdCtx.roundRect(75, 10, 100, 28, 4);
  cdCtx.fill();
  cdCtx.fillStyle = 'white';
  cdCtx.font = '12px sans-serif';
  cdCtx.textAlign = 'left';
  cdCtx.fillText(`👁 ${currentViewerCount} viewers`, 85, 29);
  
  // Stream title
  cdCtx.fillStyle = 'rgba(0,0,0,0.6)';
  cdCtx.beginPath();
  cdCtx.roundRect(180, 10, 200, 28, 4);
  cdCtx.fill();
  cdCtx.fillStyle = 'white';
  cdCtx.font = '12px sans-serif';
  cdCtx.fillText(`📹 ${currentCat?.name || 'Cat'}'s Catdergarden`, 190, 29);
  
  // Earnings counter
  if (cdStartTime > 0) {
    const elapsed = (now - cdStartTime) / 1000; // seconds
    cdEarnings = (elapsed / 360) * 10; // 10 coins per hour (scaled to ~10 mins for gameplay)
    cdCtx.fillStyle = 'rgba(0,100,0,0.8)';
    cdCtx.beginPath();
    cdCtx.roundRect(680, 10, 110, 28, 4);
    cdCtx.fill();
    cdCtx.fillStyle = '#4ade80';
    cdCtx.font = 'bold 12px sans-serif';
    cdCtx.textAlign = 'center';
    cdCtx.fillText(`💰 ${cdEarnings.toFixed(1)} MC`, 735, 29);
  }
  
  // Recent events (donations/subscriptions)
  if (Math.random() < 0.008 && cdChatQueue.length < 3) {
    const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
    // Small donations mostly, very rare big one
    const isBig = Math.random() < 0.02;
    const amount = isBig ? (20 + Math.floor(Math.random() * 30)) : [1, 2, 3, 5, 5, 10][Math.floor(Math.random() * 6)];
    const msg = `donated $${amount}!`;
    cdChatQueue.push({ name, msg, time: now });
    cdLog(`💎 ${name} ${msg}`);
  }
  
  // Random viewer comments
  if (Math.random() < 0.02) {
    const name = VIEWER_NAMES[Math.floor(Math.random() * VIEWER_NAMES.length)];
    let msg = VIEWER_COMMENTS[Math.floor(Math.random() * VIEWER_COMMENTS.length)];
    // Only show loaf message if cat has been still for > 2 seconds
    if (msg.includes('sitting like a perfect loaf') && (catStillSince === 0 || Date.now() - catStillSince < 2000)) {
      msg = 'such a cute kitty!';
    }
    cdLog(`${name}: ${msg}`);
  }
  
  // Draw floating donation alerts on canvas
  cdChatQueue = cdChatQueue.filter(evt => now - evt.time < 3000);
  for (let i = 0; i < cdChatQueue.length; i++) {
    const evt = cdChatQueue[i];
    const alpha = 1 - (now - evt.time) / 3000;
    const y = 80 + i * 30;
    cdCtx.fillStyle = `rgba(255, 215, 0, ${alpha * 0.9})`;
    cdCtx.beginPath();
    cdCtx.roundRect(10, y - 18, 200, 24, 4);
    cdCtx.fill();
    cdCtx.fillStyle = `rgba(0,0,0,${alpha})`;
    cdCtx.font = '12px sans-serif';
    cdCtx.textAlign = 'left';
    cdCtx.fillText(`💎 ${evt.name} ${evt.msg}`, 18, y);
  }

  requestAnimationFrame(drawCatdergarten);
}

function drawSimpleCat(sctx, x, y, color, name, frame) {
  const t = frame || 0;
  const bounce = Math.sin(t * 0.1) * 2;
  // Random loaf state based on name hash + time
  const nameHash = name.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
  const isLoaf = ((Math.floor(t / 300) + nameHash) % 8) === 0; // loaf every ~5 seconds
  const isRolling = ((Math.floor(t / 300) + nameHash) % 8) === 2;
  const isSitting = ((Math.floor(t / 300) + nameHash) % 8) === 4;

  sctx.save();
  sctx.translate(x, y);

  sctx.fillStyle = 'rgba(0,0,0,0.1)';
  sctx.beginPath();
  sctx.ellipse(0, 20, 18, 5, 0, 0, Math.PI * 2);
  sctx.fill();

  if (isRolling) {
    // Rolling over
    sctx.rotate(Math.sin(t * 0.05) * 0.5);
    sctx.fillStyle = color;
    sctx.beginPath();
    sctx.ellipse(0, 5, 18, 14, 0, 0, Math.PI * 2);
    sctx.fill();
    // Legs in air
    sctx.beginPath();
    sctx.ellipse(-12, -5, 5, 10, -0.5, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.ellipse(12, -5, 5, 10, 0.5, 0, Math.PI * 2);
    sctx.fill();
  } else if (isLoaf) {
    // Loaf position
    sctx.fillStyle = color;
    sctx.beginPath();
    sctx.ellipse(0, 8, 20, 14, 0, 0, Math.PI * 2);
    sctx.fill();
    // Head tucked
    sctx.beginPath();
    sctx.arc(0, -10, 14, 0, Math.PI * 2);
    sctx.fill();
    // Tucked paws
    sctx.beginPath();
    sctx.ellipse(-15, 12, 6, 4, 0.3, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.ellipse(15, 12, 6, 4, -0.3, 0, Math.PI * 2);
    sctx.fill();
  } else if (isSitting) {
    // Sitting
    sctx.fillStyle = color;
    sctx.beginPath();
    sctx.ellipse(0, 8, 16, 18, 0, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.arc(0, -14 + bounce, 14, 0, Math.PI * 2);
    sctx.fill();
    // Front paws
    sctx.fillStyle = shadeColor(color, -20);
    sctx.beginPath();
    sctx.ellipse(-6, 20, 4, 6, 0, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.ellipse(6, 20, 4, 6, 0, 0, Math.PI * 2);
    sctx.fill();
  } else {
    // Walking/standing
    sctx.fillStyle = color;
    sctx.beginPath();
    sctx.ellipse(0, 5, 18, 14, 0, 0, Math.PI * 2);
    sctx.fill();
    sctx.beginPath();
    sctx.arc(0, -14 + bounce, 14, 0, Math.PI * 2);
    sctx.fill();
  }

  // Ears
  sctx.fillStyle = color;
  sctx.beginPath();
  sctx.moveTo(-10, -22 + bounce);
  sctx.lineTo(-14, -36 + bounce);
  sctx.lineTo(-2, -26 + bounce);
  sctx.fill();
  sctx.beginPath();
  sctx.moveTo(10, -22 + bounce);
  sctx.lineTo(14, -36 + bounce);
  sctx.lineTo(2, -26 + bounce);
  sctx.fill();

  // Eyes
  sctx.fillStyle = 'white';
  sctx.beginPath();
  sctx.arc(-5, -16 + bounce, 4, 0, Math.PI * 2);
  sctx.fill();
  sctx.beginPath();
  sctx.arc(5, -16 + bounce, 4, 0, Math.PI * 2);
  sctx.fill();
  sctx.fillStyle = '#333';
  sctx.beginPath();
  sctx.arc(-5, -16 + bounce, 2, 0, Math.PI * 2);
  sctx.fill();
  sctx.beginPath();
  sctx.arc(5, -16 + bounce, 2, 0, Math.PI * 2);
  sctx.fill();

  // Nose
  sctx.fillStyle = '#ffab91';
  sctx.beginPath();
  sctx.arc(0, -12 + bounce, 2, 0, Math.PI * 2);
  sctx.fill();

  // Name
  sctx.fillStyle = '#333';
  sctx.font = '11px sans-serif';
  sctx.textAlign = 'center';
  sctx.fillText(name, 0, 35);

  sctx.restore();
}

drawCatdergarten();

// Canvas mouse handlers for cat movement and furniture dragging
canvas.addEventListener('mousedown', (e) => {
  const pos = getCanvasMousePos(e);
  const mx = pos.x;
  const my = pos.y;
  const clickedFurn = getFurnitureAt(mx, my);
  if (clickedFurn) {
    const layout = FURNITURE_LAYOUT[clickedFurn.item_type] || { w: 60, h: 60 };
    const fx = (clickedFurn.x != null && clickedFurn.x !== 0) ? clickedFurn.x : (layout.x || 0);
    const fy = (clickedFurn.y != null && clickedFurn.y !== 0) ? clickedFurn.y : (layout.y || 0);
    dragFurniture = clickedFurn;
    dragOffsetX = mx - fx;
    dragOffsetY = my - fy;
    isDragging = false;
    // Shift+click to rotate
    if (e.shiftKey) {
      e.preventDefault();
      clickedFurn.rotation = ((clickedFurn.rotation || 0) + 90) % 360;
      api('POST', '/api/furniture/move', {
        furnitureId: clickedFurn.id,
        x: Math.round(clickedFurn.x),
        y: Math.round(clickedFurn.y),
        rotation: clickedFurn.rotation
      }).catch(err => console.error('Failed to save rotation:', err));
      dragFurniture = null;
    }
  }
});

canvas.addEventListener('mousemove', (e) => {
  if (!dragFurniture) return;
  const pos = getCanvasMousePos(e);
  const mx = pos.x;
  const my = pos.y;
  isDragging = true;
  let nx = mx - dragOffsetX;
  let ny = my - dragOffsetY;
  // Clamp to room bounds
  const layout = FURNITURE_LAYOUT[dragFurniture.item_type] || { w: 60, h: 60 };
  const fw = layout.w || 60;
  const fh = layout.h || 60;
  nx = Math.max(0, Math.min(ROOM_W - fw, nx));
  ny = Math.max(0, Math.min(ROOM_H - fh, ny));
  dragFurniture.x = nx;
  dragFurniture.y = ny;
});

canvas.addEventListener('mouseup', async (e) => {
  if (!dragFurniture) return;
  if (isDragging) {
    // Save position to server
    try {
      await api('POST', '/api/furniture/move', {
        furnitureId: dragFurniture.id,
        x: Math.round(dragFurniture.x),
        y: Math.round(dragFurniture.y)
      });
    } catch (err) {
      console.error('Failed to save furniture position:', err);
    }
  } else {
    // It was a click, move cat to that spot
    const pos = getCanvasMousePos(e);
    setCatTarget(pos.x, pos.y, 'walk');
  }
  dragFurniture = null;
  isDragging = false;
});

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
        const prevDay = currentCat.game_day || 1;
        currentCat = data.cat;
        updateStats();
        // Re-check UBI status when game day changes
        if ((currentCat.game_day || 1) > prevDay) {
          checkUbiStatus();
        }
      }
    } catch (e) { /* ignore */ }
  }
}, 30000);

// Refresh messes and UBI status periodically
setInterval(async () => {
  if (token && currentCat && !screens.game.classList.contains('hidden')) {
    await loadMesses();
  }
}, 30000);
setInterval(async () => {
  if (token && currentCat && !screens.game.classList.contains('hidden')) {
    await checkUbiStatus();
  }
}, 120000);
