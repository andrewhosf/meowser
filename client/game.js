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
  const scaleX = ROOM_W / rect.width;   // logical coords, DPR-independent
  const scaleY = ROOM_H / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

// ===== HiDPI SHARP RENDERING =====
// Back the canvas with devicePixelRatio pixels; drawing code keeps using
// logical 800x500 coordinates via the base transform (never reset elsewhere).
function setupHiDPI(cvs, lw, lh) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cvs.width = Math.round(lw * dpr);
  cvs.height = Math.round(lh * dpr);
  const c = cvs.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  return c;
}
let dprLast = window.devicePixelRatio || 1;
window.addEventListener('resize', () => {
  if ((window.devicePixelRatio || 1) !== dprLast) {
    dprLast = window.devicePixelRatio || 1;
    setupHiDPI(canvas, ROOM_W, ROOM_H);
    setupHiDPI(cdCanvas, 800, 500);
    bgKey = '';          // force bg caches to rebuild at the new density
    if (typeof cdBgBuilt !== 'undefined') cdBgBuilt = false;
  }
});
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
// ctx is swapped to the catdergarten canvas while drawing multiplayer cats
let ctx = canvas.getContext('2d');
setupHiDPI(canvas, 800, 500);   // ROOM_W/ROOM_H defined below at 800x500
let activeCdCat = null;   // catdergarten cat whose colors the pose helpers should use
function withCtx(other, fn) {
  const saved = ctx; ctx = other;
  try { fn(); } finally { ctx = saved; }
}
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

function getCalicoColors() {
  return {
    patch: document.getElementById('patch-color') ? document.getElementById('patch-color').value : '#e67e22',
    dark: document.getElementById('dark-color') ? document.getElementById('dark-color').value : '#3a3f4a'
  };
}

function setCalicoVisible(show) {
  for (const id of ['patch-label', 'patch-color', 'dark-label', 'dark-color']) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', !show);
  }
}

function buildBreedGrid() {
  const grid = document.getElementById('cat-type-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const cc = getCalicoColors();
  for (const breed of CAT_BREEDS) {
    const card = document.createElement('div');
    card.className = 'breed-card' + (breed.value === selectedBreed ? ' selected' : '');
    card.innerHTML = `<canvas width="80" height="60"></canvas><div class="breed-name">${breed.label}</div><div class="breed-desc">${breed.desc}</div>`;
    const cvs = card.querySelector('canvas');
    drawPreviewCat(cvs.getContext('2d'), 40, 35, breed.value, document.getElementById('fur-color').value, document.getElementById('eye-color').value, 0.5, cc.patch, cc.dark);
    card.onclick = () => {
      selectedBreed = breed.value;
      setCalicoVisible(selectedBreed === 'Calico');
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
  const cc = getCalicoColors();
  const pctx = cvs.getContext('2d');
  pctx.clearRect(0, 0, 200, 150);
  drawPreviewCat(pctx, 100, 75, selectedBreed, fur, eye, 1.2, cc.patch, cc.dark);
}

// ===== PREVIEW COLOR/SHAPE HELPERS =====
function mixColor(c1, c2, t) {
  const n1 = parseInt(c1.replace('#',''), 16), n2 = parseInt(c2.replace('#',''), 16);
  const ch = (n, s) => (n >> s) & 0xFF;
  const m = ch(n1,16)*(1-t) + ch(n2,16)*t;
  const g = ch(n1,8)*(1-t) + ch(n2,8)*t;
  const b = ch(n1,0)*(1-t) + ch(n2,0)*t;
  return '#' + (0x1000000 + Math.round(m)*0x10000 + Math.round(g)*0x100 + Math.round(b)).toString(16).slice(1);
}

// Fuzzy silhouette: short fur spikes around an ellipse
function pvFluff(pctx, cx, cy, rx, ry, color, n, len) {
  pctx.strokeStyle = color;
  pctx.lineWidth = 2;
  pctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pctx.beginPath();
    pctx.moveTo(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
    pctx.lineTo(cx + Math.cos(a) * (rx + len), cy + Math.sin(a) * (ry + len));
    pctx.stroke();
  }
}

function drawPreviewCat(pctx, x, y, type, fur, eye, scale, patch, darkPatch) {
  if (!patch) patch = '#e67e22';
  if (!darkPatch) darkPatch = '#3a3f4a';
  pctx.save();
  pctx.translate(x, y);
  pctx.scale(scale, scale);
  const bScale = type === 'Maine Coon' ? 1.15 : (type === 'Persian' ? 1.05 : 1.0);
  pctx.scale(bScale, bScale);

  // ----- Per-breed geometry -----
  const dark = shadeColor(fur, -40);          // Siamese points
  const skin = type === 'Sphynx' ? mixColor(fur, '#c98d7f', 0.55) : fur;
  let body = skin;
  let bodyRX = 25, bodyRY = 18;
  let headR = 18, headX = 12, headY = -12, headRY = 18;
  if (type === 'Siamese')       { bodyRX = 22; bodyRY = 15; headR = 15; headRY = 15; }
  if (type === 'Maine Coon')    { bodyRX = 28; bodyRY = 20; headR = 19; headRY = 19; }
  if (type === 'Persian')       { bodyRX = 28; bodyRY = 19; headR = 19; headRY = 17; }
  if (type === 'Sphynx')        { bodyRX = 22; bodyRY = 15; headR = 16; headRY = 16; }
  if (type === 'Scottish Fold') { bodyRX = 24; bodyRY = 17; headR = 17; headRY = 16; headY = -17; }
  const white = '#f7f2ea';                    // Calico base
  if (type === 'Calico')        { body = white; }

  // ----- Tail (breed-shaped) -----
  pctx.lineCap = 'round';
  if (type === 'Maine Coon') {
    pctx.strokeStyle = fur; pctx.lineWidth = 10;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-44, -8, -46, -34); pctx.stroke();
    pvFluff(pctx, -44, -22, 7, 16, shadeColor(fur, -12), 10, 5);
  } else if (type === 'Persian') {
    pctx.strokeStyle = fur; pctx.lineWidth = 9;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-40, -4, -40, -26); pctx.stroke();
    pvFluff(pctx, -40, -26, 6, 6, shadeColor(fur, -12), 10, 5);
  } else if (type === 'Siamese') {
    pctx.strokeStyle = fur; pctx.lineWidth = 3.5;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-42, -6, -48, -30); pctx.stroke();
    pctx.fillStyle = dark;                       // pointed tail tip
    pctx.beginPath(); pctx.arc(-48, -30, 3, 0, Math.PI * 2); pctx.fill();
  } else if (type === 'Sphynx') {
    pctx.strokeStyle = skin; pctx.lineWidth = 3;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-40, 4, -46, -14); pctx.stroke();
  } else if (type === 'Scottish Fold') {
    pctx.strokeStyle = fur; pctx.lineWidth = 7;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-36, 2, -36, -12); pctx.stroke();
  } else if (type === 'Tabby') {
    pctx.strokeStyle = fur; pctx.lineWidth = 5;
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-40, -4, -40, -22); pctx.stroke();
    pctx.strokeStyle = shadeColor(fur, -25); pctx.lineWidth = 2;
    const P0 = [-20, 8], C = [-40, -4], P1 = [-40, -22];   // rings ON the tail curve
    for (let i = 0; i < 3; i++) {
      const t = 0.5 + i * 0.18, u = 1 - t;
      const qx = u*u*P0[0] + 2*u*t*C[0] + t*t*P1[0];
      const qy = u*u*P0[1] + 2*u*t*C[1] + t*t*P1[1];
      pctx.beginPath(); pctx.moveTo(qx - 2.5, qy); pctx.lineTo(qx + 2.5, qy - 1.5); pctx.stroke();
    }
  } else if (type === 'Calico') {
    pctx.strokeStyle = fur; pctx.lineWidth = 5;           // fur-colored base so the tail reads
    pctx.beginPath(); pctx.moveTo(-20, 8); pctx.quadraticCurveTo(-40, -4, -40, -22); pctx.stroke();
    pctx.strokeStyle = patch;                             // patch-colored tip drawn ALONG the curve (t 0.6→1)
    pctx.beginPath(); pctx.moveTo(-36.8, -8.6); pctx.quadraticCurveTo(-40, -14.8, -40, -22); pctx.stroke();
  }

  // ----- Body (+ fluffy silhouette) -----
  if (type === 'Maine Coon' || type === 'Persian') {
    pvFluff(pctx, 0, 5, bodyRX, bodyRY, shadeColor(fur, -14), 18, 5);
  }
  pctx.fillStyle = body;
  pctx.beginPath();
  pctx.ellipse(0, 5, bodyRX, bodyRY, 0, 0, Math.PI * 2);
  pctx.fill();

  // Body patterns
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
    const patches = [fur, patch, darkPatch];
    const spots = [[-10, 0, 8, 7], [6, 10, 7, 5], [-2, -6, 5, 4]];
    for (let i = 0; i < 3; i++) {
      pctx.fillStyle = patches[i];
      pctx.beginPath();
      pctx.ellipse(spots[i][0], spots[i][1], spots[i][2], spots[i][3], 0, 0, Math.PI * 2);
      pctx.fill();
    }
  }
  if (type === 'Sphynx') {
    pctx.strokeStyle = 'rgba(120,70,60,0.4)';
    pctx.lineWidth = 1;
    pctx.beginPath(); pctx.moveTo(-10, 0); pctx.quadraticCurveTo(-2, -3, 5, -1); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(-6, 8); pctx.quadraticCurveTo(2, 5, 9, 7); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(-1, 14); pctx.quadraticCurveTo(4, 12, 8, 14); pctx.stroke();
  }
  if (type === 'Siamese') {
    // sleek lighter belly line
    pctx.strokeStyle = shadeColor(fur, 12);
    pctx.lineWidth = 2;
    pctx.beginPath(); pctx.moveTo(-12, 14); pctx.quadraticCurveTo(0, 18, 10, 14); pctx.stroke();
  }

  // ----- Legs / paws (Siamese points) -----
  if (type === 'Siamese') {
    pctx.fillStyle = dark;
    pctx.beginPath(); pctx.ellipse(-12, 20, 5, 3.5, 0, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(8, 20, 5, 3.5, 0, 0, Math.PI * 2); pctx.fill();
  }

  // ----- Head (+ fluffy ruff) -----
  if (type === 'Maine Coon' || type === 'Persian') {
    pvFluff(pctx, headX, headY, headR + 1, headRY + 1, shadeColor(fur, -14), 16, 5);
  }
  pctx.fillStyle = (type === 'Calico') ? white : skin;
  pctx.beginPath();
  pctx.ellipse(headX, headY, headR, headRY, 0, 0, Math.PI * 2);
  pctx.fill();
  if (type === 'Calico') {                       // half-and-half face
    pctx.save();
    pctx.beginPath(); pctx.rect(headX - headR - 2, headY - headRY - 2, headR + 2, headRY * 2 + 4); pctx.clip();
    pctx.fillStyle = patch;
    pctx.beginPath(); pctx.ellipse(headX, headY, headR, headRY, 0, 0, Math.PI * 2); pctx.fill();
    pctx.restore();
    // dark patch over the other ear/eye region
    pctx.save();
    pctx.beginPath(); pctx.rect(headX, headY - headRY - 2, headR + 2, headRY + 4); pctx.clip();
    pctx.fillStyle = darkPatch;
    pctx.beginPath(); pctx.ellipse(headX + 4, headY - 10, 9, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.restore();
  }
  if (type === 'Siamese') {                      // dark face mask (full points look)
    pctx.fillStyle = dark;
    pctx.beginPath(); pctx.ellipse(headX, headY + 4, 10.5, 9, 0, 0, Math.PI * 2); pctx.fill();
  }
  if (type === 'Tabby') {                        // forehead "M"
    pctx.strokeStyle = shadeColor(fur, -30);
    pctx.lineWidth = 1.5;
    pctx.beginPath();
    pctx.moveTo(headX - 6, headY - 10); pctx.lineTo(headX - 3, headY - 14);
    pctx.lineTo(headX, headY - 10); pctx.lineTo(headX + 3, headY - 14);
    pctx.lineTo(headX + 6, headY - 10);
    pctx.stroke();
  }

  // ----- Ears (breed-shaped, positioned off head geometry) -----
  const eL = headX - headR * 0.72, eR = headX + headR * 0.72, eT = headY - headRY * 0.82;
  pctx.fillStyle = (type === 'Calico') ? '#e67e22' : skin;
  const inner = (type === 'Calico') ? mixColor('#e67e22', '#ffccbc', 0.5) : '#ffccbc';
  if (type === 'Scottish Fold') {
    // Small ears folded forward over the skull
    pctx.beginPath(); pctx.ellipse(eL, eT + 2, 7, 4.5, -0.5, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eR, eT + 2, 7, 4.5, 0.5, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = inner;
    pctx.beginPath(); pctx.ellipse(eL + 1, eT + 3, 4, 2.5, -0.5, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eR - 1, eT + 3, 4, 2.5, 0.5, 0, Math.PI * 2); pctx.fill();
  } else if (type === 'Sphynx') {
    // Huge bat ears
    pctx.beginPath(); pctx.moveTo(eL - 4, eT + 6); pctx.lineTo(eL - 16, eT - 22); pctx.lineTo(eL + 8, eT - 2); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 4, eT + 6); pctx.lineTo(eR + 16, eT - 22); pctx.lineTo(eR - 8, eT - 2); pctx.fill();
    pctx.fillStyle = inner;
    pctx.beginPath(); pctx.moveTo(eL - 2, eT + 3); pctx.lineTo(eL - 11, eT - 16); pctx.lineTo(eL + 5, eT - 2); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 2, eT + 3); pctx.lineTo(eR + 11, eT - 16); pctx.lineTo(eR - 5, eT - 2); pctx.fill();
  } else if (type === 'Maine Coon') {
    // Tall tufted ears
    pctx.beginPath(); pctx.moveTo(eL - 3, eT + 4); pctx.lineTo(eL - 6, eT - 20); pctx.lineTo(eL + 9, eT - 2); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 3, eT + 4); pctx.lineTo(eR + 6, eT - 20); pctx.lineTo(eR - 9, eT - 2); pctx.fill();
    pctx.strokeStyle = shadeColor(fur, -20); pctx.lineWidth = 1.5;
    pctx.beginPath(); pctx.moveTo(eL - 6, eT - 20); pctx.lineTo(eL - 9, eT - 27); pctx.stroke();
    pctx.beginPath(); pctx.moveTo(eR + 6, eT - 20); pctx.lineTo(eR + 9, eT - 27); pctx.stroke();
    pctx.fillStyle = inner;
    pctx.beginPath(); pctx.moveTo(eL - 1, eT + 1); pctx.lineTo(eL - 4, eT - 14); pctx.lineTo(eL + 6, eT - 2); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 1, eT + 1); pctx.lineTo(eR + 4, eT - 14); pctx.lineTo(eR - 6, eT - 2); pctx.fill();
  } else if (type === 'Persian') {
    // Tiny round ears, wide set
    pctx.beginPath(); pctx.ellipse(eL, eT + 2, 5.5, 4.5, -0.25, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eR, eT + 2, 5.5, 4.5, 0.25, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = inner;
    pctx.beginPath(); pctx.ellipse(eL, eT + 2, 3, 2.2, -0.25, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eR, eT + 2, 3, 2.2, 0.25, 0, Math.PI * 2); pctx.fill();
  } else if (type === 'Siamese') {
    // Large, wide-based ears
    pctx.beginPath(); pctx.moveTo(eL - 5, eT + 6); pctx.lineTo(eL - 7, eT - 16); pctx.lineTo(eL + 8, eT); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 5, eT + 6); pctx.lineTo(eR + 7, eT - 16); pctx.lineTo(eR - 8, eT); pctx.fill();
    pctx.fillStyle = inner;
    pctx.beginPath(); pctx.moveTo(eL - 2, eT + 3); pctx.lineTo(eL - 4, eT - 11); pctx.lineTo(eL + 5, eT); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 2, eT + 3); pctx.lineTo(eR + 4, eT - 11); pctx.lineTo(eR - 5, eT); pctx.fill();
  } else {
    // Standard triangle (Tabby, Calico)
    pctx.beginPath(); pctx.moveTo(eL - 3, eT + 5); pctx.lineTo(eL - 3, eT - 13); pctx.lineTo(eL + 8, eT - 1); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 3, eT + 5); pctx.lineTo(eR + 3, eT - 13); pctx.lineTo(eR - 8, eT - 1); pctx.fill();
    pctx.fillStyle = inner;
    if (type === 'Calico') pctx.fillStyle = mixColor('#e67e22', '#ffccbc', 0.6);
    pctx.beginPath(); pctx.moveTo(eL - 1, eT + 2); pctx.lineTo(eL - 1, eT - 8); pctx.lineTo(eL + 5, eT - 1); pctx.fill();
    pctx.beginPath(); pctx.moveTo(eR + 1, eT + 2); pctx.lineTo(eR + 1, eT - 8); pctx.lineTo(eR - 5, eT - 1); pctx.fill();
  }

  // ----- Muzzle / face -----
  if (type === 'Persian') {
    // Flat pushed-in face: bold white muzzle pad, big nose centered between the eyes, mouth below
    pctx.fillStyle = mixColor(skin, '#ffffff', 0.62);
    pctx.beginPath(); pctx.ellipse(headX, headY + 2, 12.5, 9, 0, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = '#e2725b';
    pctx.beginPath(); pctx.ellipse(headX, headY + 1, 3.6, 2.8, 0, 0, Math.PI * 2); pctx.fill();
    pctx.strokeStyle = mixColor(skin, '#000000', 0.3);
    pctx.lineWidth = 1.2;
    pctx.beginPath(); pctx.arc(headX - 3.5, headY + 5.5, 3.2, 0, Math.PI); pctx.stroke();
    pctx.beginPath(); pctx.arc(headX + 3.5, headY + 5.5, 3.2, 0, Math.PI); pctx.stroke();
  } else if (type === 'Sphynx') {
    pctx.fillStyle = '#ffab91';
    pctx.beginPath(); pctx.arc(headX + 2, headY + 4, 2.2, 0, Math.PI * 2); pctx.fill();
  } else {
    pctx.fillStyle = '#ffab91';
    pctx.beginPath(); pctx.arc(headX + 2, headY + 6, 2.6, 0, Math.PI * 2); pctx.fill();
  }

  // ----- Eyes (breed-shaped) -----
  let eyeColor = (type === 'Siamese') ? '#48cae4' : eye;
  const eLx = headX - headR * 0.45, eRx = headX + headR * 0.45, ey = headY - 2;
  if (type === 'Persian') {
    // Big round wide-set eyes
    pctx.fillStyle = 'white';
    pctx.beginPath(); pctx.ellipse(eLx - 1, ey, 6.5, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eRx + 1, ey, 6.5, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = eyeColor;
    pctx.beginPath(); pctx.arc(eLx - 1, ey + 0.5, 4.5, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.arc(eRx + 1, ey + 0.5, 4.5, 0, Math.PI * 2); pctx.fill();
  } else if (type === 'Siamese') {
    // Almond eyes, angled toward the mask center
    pctx.fillStyle = 'white';
    pctx.save(); pctx.translate(eLx, ey); pctx.rotate(-0.35);
    pctx.beginPath(); pctx.ellipse(0, 0, 5.5, 4, 0, 0, Math.PI * 2); pctx.fill(); pctx.restore();
    pctx.save(); pctx.translate(eRx, ey); pctx.rotate(0.35);
    pctx.beginPath(); pctx.ellipse(0, 0, 5.5, 4, 0, 0, Math.PI * 2); pctx.fill(); pctx.restore();
    pctx.fillStyle = eyeColor;
    pctx.beginPath(); pctx.arc(eLx, ey, 2.6, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.arc(eRx, ey, 2.6, 0, Math.PI * 2); pctx.fill();
  } else {
    pctx.fillStyle = 'white';
    pctx.beginPath(); pctx.ellipse(eLx, ey, 6, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.ellipse(eRx, ey, 6, 7, 0, 0, Math.PI * 2); pctx.fill();
    pctx.fillStyle = eyeColor;
    pctx.beginPath(); pctx.arc(eLx + 1, ey + 0.5, 3.5, 0, Math.PI * 2); pctx.fill();
    pctx.beginPath(); pctx.arc(eRx - 1, ey + 0.5, 3.5, 0, Math.PI * 2); pctx.fill();
  }

  // Whiskers (Sphynx has almost none)
  if (type !== 'Sphynx') {
    pctx.strokeStyle = 'rgba(255,255,255,0.75)';
    pctx.lineWidth = 0.8;
    pctx.beginPath();
    pctx.moveTo(headX + 8, headY + 6); pctx.lineTo(headX + 22, headY + 3);
    pctx.moveTo(headX + 8, headY + 8); pctx.lineTo(headX + 23, headY + 9);
    pctx.stroke();
  }

  pctx.restore();
}

// Update preview when colors change
document.getElementById('fur-color').oninput = () => { updatePreview(); buildBreedGrid(); };
document.getElementById('eye-color').oninput = () => { updatePreview(); buildBreedGrid(); };
document.getElementById('patch-color').oninput = () => { updatePreview(); buildBreedGrid(); };
document.getElementById('dark-color').oninput = () => { updatePreview(); buildBreedGrid(); };

document.getElementById('btn-adopt').onclick = async () => {
  const name = document.getElementById('cat-name').value.trim();
  const fur = document.getElementById('fur-color').value;
  const eye = document.getElementById('eye-color').value;
  if (!name) return alert('Name your cat!');
  try {
    const cc = getCalicoColors();
    await api('POST', '/api/cat', { name, type: selectedBreed, fur_color: fur, eye_color: eye, patch_color: cc.patch, dark_color: cc.dark });
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
    if (!chatLog.children.length) {
      logChat(`${currentCat.name} looks up at you expectantly...`, true);
    }
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
  document.getElementById('stat-age-unit').textContent = (currentCat.age || 0) === 1 ? 'day' : 'days';
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
  catTypeDisplay.textContent = (currentCat.type || 'Tabby').replace(/^./, c => c.toUpperCase());

  const h = Math.round(currentCat.happiness || 0);
  const hu = Math.round(currentCat.hunger || 0);

  barHappiness.style.width = h + '%';
  barHappiness.className = h < 30 ? 'low' : h < 60 ? 'mid' : '';

  barHunger.style.width = hu + '%';
  barHunger.className = hu < 30 ? 'low' : hu < 60 ? 'mid' : '';

  // Mood (tamagotchi-style readout)
  const moodEl = document.getElementById('cat-mood');
  if (moodEl) {
    let mood;
    if (hu < 25) mood = '😿 Hungry';
    else if (h < 25) mood = '😾 Grumpy';
    else if (h < 55) mood = '😐 Meh';
    else if (h >= 80 && hu >= 60) mood = '😸 Thriving';
    else mood = '🙂 Content';
    moodEl.textContent = mood;
  }
}

// ===== CAT-INITIATED NEEDS (tamagotchi nudges) =====
// Every so often the cat speaks up based on how it's feeling — this is what
// pulls the player back into interactions instead of waiting on decay.
setInterval(() => {
  if (!currentCat || !screens.game || screens.game.classList.contains('hidden')) return;
  if (catSleeping || catEntity.state === 'nap') return;
  if (catEntity.bubble || catEntity.heartTimer > 0) return;
  if (Math.random() > 0.5) return; // keep it ambient, not nagging
  const hu = currentCat.hunger || 0;
  const h = currentCat.happiness || 0;
  let text = null;
  if (hu < 20) text = 'Feed me! Meow!';
  else if (hu < 40) text = 'Meow... *looks at bowl*';
  else if (messes.length > 0 && Math.random() < 0.35) text = 'It stinks over here...';
  else if (h < 35) text = 'Play with me?';
  else if (h < 55) text = 'Pet me?';
  else if (Math.random() < 0.25) text = ['Meow.', 'Mrrp?', 'Purrrr...', '*blinks slowly*', 'Mew!'][Math.floor(Math.random() * 5)];
  if (text) {
    catEntity.bubble = { text, timer: 180 };
    // come to the player when really needy
    if (hu < 20 || h < 35) { catEntity.targetX = 400; catEntity.targetY = 300; catEntity.state = 'walk'; }
  }
}, 25000);

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

// ===== BACKGROUND CACHE =====
// The room is nearly static — walls/floor/window render once per day-night
// flip into an offscreen canvas and get blitted each frame. Fixes the
// per-frame Math.random() star flicker and cuts drawing cost ~10x.
const bgCache = document.createElement('canvas');
let bgKey = '';
function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function drawRoom() {
  const key = isNight ? 'n' : 'd';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (key !== bgKey || bgCache._dpr !== dpr) {
    bgKey = key;
    bgCache._dpr = dpr;
    bgCache.width = ROOM_W * dpr; bgCache.height = ROOM_H * dpr;
    const b = bgCache.getContext('2d');
    b.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Floor: warm gradient + plank seams
    const floor = b.createLinearGradient(0, 42, 0, ROOM_H);
    if (isNight) { floor.addColorStop(0, '#322b23'); floor.addColorStop(1, '#27211a'); }
    else { floor.addColorStop(0, '#f8eedb'); floor.addColorStop(1, '#eedfc2'); }
    b.fillStyle = floor;
    b.fillRect(0, 42, ROOM_W, ROOM_H - 42);
    b.strokeStyle = isNight ? 'rgba(255,235,190,0.035)' : 'rgba(150,110,55,0.07)';
    b.lineWidth = 1;
    for (let y = 78; y < ROOM_H; y += 56) {
      b.beginPath(); b.moveTo(0, y); b.lineTo(ROOM_W, y); b.stroke();
    }
    // Staggered plank butt-joints (short, not full-height — reads as wood, not grid)
    b.strokeStyle = isNight ? 'rgba(255,235,190,0.06)' : 'rgba(150,110,55,0.14)';
    let rowIdx = 0;
    for (let y = 78; y < ROOM_H; y += 56, rowIdx++) {
      const off = rowIdx % 2 ? 80 : 0;
      for (let x = off + 40; x < ROOM_W; x += 160) {
        b.beginPath(); b.moveTo(x, y - 46); b.lineTo(x, y - 6); b.stroke();
      }
    }

    // Wall band + baseboard with highlight edge
    b.fillStyle = isNight ? '#3a332b' : '#fff8e9';
    b.fillRect(0, 0, ROOM_W, 40);
    b.fillStyle = isNight ? '#241f19' : '#e3d6bd';
    b.fillRect(0, 38, ROOM_W, 6);
    b.fillStyle = isNight ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.55)';
    b.fillRect(0, 38, ROOM_W, 1.5);

    // Window: rounded frame with sill
    const wx = 300, wy = 8, ww = 160, wh = 64;
    b.fillStyle = isNight ? '#55483a' : '#c9b18a';
    b.beginPath(); b.roundRect(wx - 6, wy - 6, ww + 12, wh + 16, 6); b.fill();
    b.save();
    b.beginPath(); b.roundRect(wx, wy, ww, wh, 3); b.clip();
    if (isNight) {
      const sky = b.createLinearGradient(0, wy, 0, wy + wh);
      sky.addColorStop(0, '#141a33'); sky.addColorStop(1, '#232a4d');
      b.fillStyle = sky; b.fillRect(wx, wy, ww, wh);
      const rnd = seededRand(1337);
      for (let i = 0; i < 26; i++) {
        const sx = wx + rnd() * ww, sy = wy + rnd() * wh, r = rnd() * 1.2 + 0.4;
        b.fillStyle = `rgba(255,255,240,${0.35 + rnd() * 0.55})`;
        b.beginPath(); b.arc(sx, sy, r, 0, Math.PI * 2); b.fill();
      }
      // Moon with soft glow
      const glow = b.createRadialGradient(398, 30, 4, 398, 30, 22);
      glow.addColorStop(0, 'rgba(240,235,200,0.5)'); glow.addColorStop(1, 'rgba(240,235,200,0)');
      b.fillStyle = glow; b.beginPath(); b.arc(398, 30, 22, 0, Math.PI * 2); b.fill();
      b.fillStyle = '#f2ecca';
      b.beginPath(); b.arc(398, 30, 11, 0, Math.PI * 2); b.fill();
      // Crescent: overlay a circle in the top sky color (no destination-out —
      // that would punch a transparent hole through the cache)
      b.fillStyle = '#181e38';
      b.beginPath(); b.arc(404, 26, 9, 0, Math.PI * 2); b.fill();
      b.fillStyle = 'rgba(200,190,150,0.5)';
      b.beginPath(); b.arc(394, 32, 2, 0, Math.PI * 2); b.fill();
      b.beginPath(); b.arc(399, 36, 1.3, 0, Math.PI * 2); b.fill();
    } else {
      const sky = b.createLinearGradient(0, wy, 0, wy + wh);
      sky.addColorStop(0, '#aee0ff'); sky.addColorStop(1, '#dff3ff');
      b.fillStyle = sky; b.fillRect(wx, wy, ww, wh);
      // Distant hills + sun with glow + clouds
      b.fillStyle = '#b8dcb0';
      b.beginPath(); b.arc(wx + 30, wy + wh + 14, 34, 0, Math.PI * 2); b.fill();
      b.beginPath(); b.arc(wx + 110, wy + wh + 20, 42, 0, Math.PI * 2); b.fill();
      const sglow = b.createRadialGradient(420, 26, 3, 420, 26, 24);
      sglow.addColorStop(0, 'rgba(255,220,110,0.9)'); sglow.addColorStop(1, 'rgba(255,220,110,0)');
      b.fillStyle = sglow; b.beginPath(); b.arc(420, 26, 24, 0, Math.PI * 2); b.fill();
      b.fillStyle = '#ffd766'; b.beginPath(); b.arc(420, 26, 9, 0, Math.PI * 2); b.fill();
      b.fillStyle = 'rgba(255,255,255,0.85)';
      for (const [cx, cy, cr] of [[330, 26, 7], [341, 24, 9], [352, 27, 6], [368, 44, 5], [376, 42, 7]]) {
        b.beginPath(); b.arc(cx, cy, cr, 0, Math.PI * 2); b.fill();
      }
    }
    b.restore();
    // Muntins + glass sheen
    b.strokeStyle = isNight ? '#55483a' : '#c9b18a';
    b.lineWidth = 4;
    b.beginPath(); b.moveTo(wx + ww / 2, wy); b.lineTo(wx + ww / 2, wy + wh); b.stroke();
    b.beginPath(); b.moveTo(wx, wy + wh / 2); b.lineTo(wx + ww, wy + wh / 2); b.stroke();
    b.strokeStyle = 'rgba(255,255,255,0.22)';
    b.lineWidth = 6;
    b.beginPath(); b.moveTo(wx + 18, wy + wh - 6); b.lineTo(wx + 60, wy + 6); b.stroke();
  }

  ctx.drawImage(bgCache, 0, 0, ROOM_W, ROOM_H);

  // Clock display
  drawClock();
}

// Soft cinematic edge darkening, stronger at night
function drawNightVignette() {
  const v = ctx.createRadialGradient(ROOM_W / 2, ROOM_H / 2, ROOM_H * 0.45, ROOM_W / 2, ROOM_H / 2, ROOM_H * 0.95);
  if (isNight) {
    v.addColorStop(0, 'rgba(8,8,30,0)');
    v.addColorStop(1, 'rgba(8,8,30,0.38)');
  } else {
    v.addColorStop(0, 'rgba(60,40,10,0)');
    v.addColorStop(1, 'rgba(60,40,10,0.10)');
  }
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, ROOM_W, ROOM_H);
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
  _vfH = h; // vfill() gradient span for this item

  // Contact shadow (drawn unrotated, on the floor plane)
  ctx.fillStyle = 'rgba(50,35,15,0.10)';
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h - 2, w * 0.52, Math.max(5, h * 0.12), 0, 0, Math.PI * 2);
  ctx.fill();

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
    ctx.fillStyle = vfill('#6a9ab5');
    ctx.fillRect(hx + 5, hy - 15, hw - 10, 20);
    ctx.strokeRect(hx + 5, hy - 15, hw - 10, 20);
    // Headboard detail
    ctx.fillStyle = vfill('#5a8aa5');
    ctx.fillRect(hx + 15, hy - 10, hw - 30, 10);
    // Mattress base
    ctx.fillStyle = vfill('#8ab6d6');
    ctx.fillRect(hx, hy + 5, hw, hh - 5);
    ctx.strokeRect(hx, hy + 5, hw, hh - 5);
    // Mattress top (lighter)
    ctx.fillStyle = vfill('#9ec6e6');
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
    ctx.fillStyle = vfill('#7ab6c6');
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
    ctx.fillStyle = vfill('#8d6e63');
    ctx.fillRect(hx + 5, hy + hh, 6, 8);
    ctx.fillRect(hx + hw - 11, hy + hh, 6, 8);

  } else if (key === 'tv') {
    // Flatscreen TV on wall
    const tx = 0, ty = 0, tw = w, th = h;
    // Screen (deep charcoal gradient, reads as glass, not a black hole)
    const scr = ctx.createLinearGradient(tx, ty, tx + tw * 0.6, ty + th);
    scr.addColorStop(0, '#2b3138');
    scr.addColorStop(0.5, '#16191d');
    scr.addColorStop(1, '#0a0c0e');
    ctx.fillStyle = scr;
    ctx.beginPath();
    ctx.roundRect(tx, ty, tw, th, 4);
    ctx.fill();
    ctx.strokeStyle = '#3a424a';
    ctx.stroke();
    // Bezel top highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx + 5, ty + 1.5);
    ctx.lineTo(tx + tw - 5, ty + 1.5);
    ctx.stroke();
    ctx.strokeStyle = '#a09080';
    // Screen reflection
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath();
    ctx.moveTo(tx + tw*0.6, ty + 4);
    ctx.lineTo(tx + tw - 4, ty + 4);
    ctx.lineTo(tx + tw - 4, ty + th*0.4);
    ctx.lineTo(tx + tw*0.6, ty + th*0.5);
    ctx.closePath();
    ctx.fill();
    // Stand
    ctx.fillStyle = vfill('#3d3d3d');
    ctx.fillRect(tx + tw/2 - 8, ty + th, 16, 8);
    ctx.fillRect(tx + tw/2 - 20, ty + th + 8, 40, 4);
    // Power LED
    ctx.fillStyle = vfill('#00e676');
    ctx.beginPath();
    ctx.arc(tx + tw - 8, ty + th - 6, 2, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'tv_stand') {
    // Simple TV stand with shelves
    ctx.fillStyle = vfill('#5d4037');
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
    ctx.fillStyle = vfill('#78909c');
    ctx.fillRect(8, 4, 12, 8);
    ctx.fillRect(25, 4, 10, 8);

  } else if (key === 'microwave') {
    // Microwave oven
    const mx = 0, my = 0, mw = w, mh = h;
    // Body
    ctx.fillStyle = vfill('#b0bec5');
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeRect(mx, my, mw, mh);
    // Door window
    ctx.fillStyle = vfill('#37474f');
    ctx.fillRect(mx + 4, my + 4, mw - 20, mh - 8);
    ctx.strokeRect(mx + 4, my + 4, mw - 20, mh - 8);
    // Window reflection
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(mx + 6, my + 6, mw - 28, mh - 14);
    // Control panel
    ctx.fillStyle = vfill('#90a4ae');
    ctx.fillRect(mx + mw - 14, my + 4, 10, mh - 8);
    // Buttons
    ctx.fillStyle = vfill('#455a64');
    ctx.fillRect(mx + mw - 12, my + 7, 6, 3);
    ctx.fillRect(mx + mw - 12, my + 12, 6, 3);
    ctx.fillRect(mx + mw - 12, my + 17, 6, 3);

  } else if (key === 'sink') {
    // Kitchen sink
    const sx = 0, sy = 0, sw = w, sh = h;
    // Countertop
    ctx.fillStyle = vfill('#cfd8dc');
    ctx.fillRect(sx - 5, sy, sw + 10, sh);
    ctx.strokeRect(sx - 5, sy, sw + 10, sh);
    // Basin
    ctx.fillStyle = vfill('#b0bec5');
    ctx.beginPath();
    ctx.ellipse(sx + sw/2, sy + sh/2 + 3, sw/2 - 4, sh/2 - 6, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Water
    ctx.fillStyle = vfill('#81d4fa');
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
    ctx.fillStyle = vfill('#8d6e63');
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
    ctx.fillStyle = vfill('#6d4c41');
    ctx.fillRect(tx + 5, ty + th - 10, 6, 12);
    ctx.fillRect(tx + tw - 11, ty + th - 10, 6, 12);
    ctx.fillRect(tx + tw/2 - 3, ty + th - 10, 6, 12);

  } else if (key === 'chair1' || key === 'chair2') {
    // Simple chair
    const cx = 0, cy = 0, cw = w, ch = h;
    // Seat
    ctx.fillStyle = vfill('#a1887f');
    ctx.fillRect(cx, cy + ch/2, cw, ch/2);
    ctx.strokeRect(cx, cy + ch/2, cw, ch/2);
    // Backrest
    ctx.fillStyle = vfill('#8d6e63');
    ctx.fillRect(cx + 2, cy, cw - 4, ch/2);
    ctx.strokeRect(cx + 2, cy, cw - 4, ch/2);
    // Legs
    ctx.fillStyle = vfill('#6d4c41');
    ctx.fillRect(cx + 2, cy + ch, 4, 6);
    ctx.fillRect(cx + cw - 6, cy + ch, 4, 6);

  } else if (key === 'couch') {
    // 3D Couch with back, arms, cushions, legs
    const cx = 0, cy = 0, cw = w, ch = h;
    // Backrest (tall, behind)
    ctx.fillStyle = vfill('#b08d5e');
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
    ctx.fillStyle = vfill('#c8a97e');
    ctx.fillRect(cx, cy + 10, cw, ch - 10);
    ctx.strokeRect(cx, cy + 10, cw, ch - 10);
    // Seat cushion 1
    ctx.fillStyle = vfill('#d4b48e');
    ctx.fillRect(cx + 5, cy + 12, cw/2 - 7, ch - 18);
    ctx.strokeRect(cx + 5, cy + 12, cw/2 - 7, ch - 18);
    // Seat cushion 2
    ctx.fillRect(cx + cw/2 + 2, cy + 12, cw/2 - 7, ch - 18);
    ctx.strokeRect(cx + cw/2 + 2, cy + 12, cw/2 - 7, ch - 18);
    // Left armrest
    ctx.fillStyle = vfill('#b08d5e');
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
    ctx.fillStyle = vfill('#6d4c41');
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
    ctx.fillStyle = vfill('#6a9ab5');
    ctx.fillRect(hx + 5, hy - 15, hw - 10, 20);
    ctx.strokeRect(hx + 5, hy - 15, hw - 10, 20);
    // Headboard detail
    ctx.fillStyle = vfill('#5a8aa5');
    ctx.fillRect(hx + 15, hy - 10, hw - 30, 10);
    // Mattress base
    ctx.fillStyle = vfill('#8ab6d6');
    ctx.fillRect(hx, hy + 5, hw, hh - 5);
    ctx.strokeRect(hx, hy + 5, hw, hh - 5);
    // Mattress top (lighter)
    ctx.fillStyle = vfill('#9ec6e6');
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
    ctx.fillStyle = vfill('#7ab6c6');
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
    ctx.fillStyle = vfill('#8d6e63');
    ctx.fillRect(hx + 5, hy + hh, 6, 8);
    ctx.fillRect(hx + hw - 11, hy + hh, 6, 8);

  } else if (key === 'cat_bed') {
    // Donut cat bed with fluffy walls
    const cx = w/2, cy = h/2, rx = w/2, ry = h/2;
    // Outer fluffy rim (darker)
    ctx.fillStyle = vfill('#c65a3b');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Fluffy bumps on rim
    ctx.fillStyle = vfill('#d66a4b');
    for (let a = 0; a < Math.PI*2; a += 0.4) {
      const bx = cx + Math.cos(a) * (rx - 2);
      const by = cy + Math.sin(a) * (ry - 2);
      ctx.beginPath();
      ctx.arc(bx, by, 6, 0, Math.PI*2);
      ctx.fill();
    }
    // Inner cushion
    ctx.fillStyle = vfill('#fff3e0');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx - 12, ry - 12, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Cushion shading
    ctx.fillStyle = vfill('#ffe8d0');
    ctx.beginPath();
    ctx.ellipse(cx + 3, cy + 3, rx - 18, ry - 18, 0, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'water_bowl') {
    // Realistic bowl with water
    const cx = w/2, cy = h/2;
    // Bowl outer (ceramic)
    ctx.fillStyle = vfill('#e0f7fa');
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Bowl rim
    ctx.fillStyle = vfill('#b2ebf2');
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w/2, h/2 - 4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Water surface
    ctx.fillStyle = vfill('#4fc3f7');
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
    ctx.fillStyle = vfill('#f5e6d3');
    ctx.beginPath();
    ctx.ellipse(cx, cy + 6, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Bowl inner
    ctx.fillStyle = vfill('#e8d5c0');
    ctx.beginPath();
    ctx.ellipse(cx, cy + 2, w/2, h/2 - 4, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Food base (dry food color)
    ctx.fillStyle = vfill('#a0522d');
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
        ctx.fillStyle = vfill('#f5f5dc');
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
        ctx.fillStyle = vfill('#2f2f2f');
        ctx.beginPath();
        ctx.roundRect(cx - 8, cy - 4, 8, 8, 2);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(cx + 2, cy - 4, 8, 8, 2);
        ctx.fill();
        // Rice
        ctx.fillStyle = vfill('#fff8dc');
        ctx.beginPath();
        ctx.roundRect(cx - 6, cy - 2, 4, 4, 1);
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(cx + 4, cy - 2, 4, 4, 1);
        ctx.fill();
        // Topping
        ctx.fillStyle = vfill('#ff69b4');
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
          ctx.arc(fx, fy, 2 + (i % 3) * 0.5, 0, Math.PI*2);
          ctx.fill();
        }
      }
    } else {
      // Default dry food visible
      ctx.fillStyle = vfill('#cd853f');
      ctx.beginPath();
      ctx.ellipse(cx, cy, w/2 - 6, h/2 - 8, 0, 0, Math.PI*2);
      ctx.fill();
      // Pellets
      ctx.fillStyle = vfill('#b87333');
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
    ctx.fillStyle = vfill('#d4a373');
    ctx.fillRect(sx + 5, sy - 8, sw - 10, 12);
    ctx.strokeRect(sx + 5, sy - 8, sw - 10, 12);
    // Left wall
    ctx.fillStyle = vfill('#c49365');
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
    ctx.fillStyle = vfill('#d4a373');
    ctx.fillRect(sx, sy + sh - 12, sw, 12);
    ctx.strokeRect(sx, sy + sh - 12, sw, 12);
    // Litter inside
    ctx.fillStyle = vfill('#e9c46a');
    ctx.fillRect(sx + 6, sy + 2, sw - 12, sh - 14);
    // Litter granules texture (deterministic — stable, no per-frame flicker)
    ctx.fillStyle = '#f0d080';
    for (let i = 0; i < 15; i++) {
      const lx = sx + 10 + ((i * 37 + 11) % (sw - 22));
      const ly = sy + 5 + ((i * 53 + 7) % (sh - 22));
      ctx.fillRect(lx, ly, 2, 2);
    }
    ctx.fillStyle = '#d4a350';
    for (let i = 0; i < 10; i++) {
      const lx = sx + 10 + ((i * 61 + 23) % (sw - 22));
      const ly = sy + 5 + ((i * 41 + 17) % (sh - 22));
      ctx.fillRect(lx, ly, 2, 2);
    }
    // Scoop hint on front
    ctx.fillStyle = vfill('#b08d5e');
    ctx.fillRect(sx + sw/2 - 8, sy + sh - 8, 16, 4);

  } else if (key === 'cat_tree') {
    // Cat tree with trunk, platforms, and dangling toy
    const tx = 0, ty = 0, tw = w, th = h;
    // Base
    ctx.fillStyle = vfill('#6d4c41');
    ctx.fillRect(tx - 5, ty + th - 12, tw + 10, 12);
    ctx.strokeRect(tx - 5, ty + th - 12, tw + 10, 12);
    // Trunk (textured)
    ctx.fillStyle = vfill('#8d6e63');
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
    ctx.fillStyle = vfill('#a8d5a2');
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
    ctx.fillStyle = vfill('#e76f51');
    ctx.beginPath();
    ctx.arc(tx + tw/2, toyY + 5, 4, 0, Math.PI*2);
    ctx.fill();
    // Top perch (reset stroke — the toy string left an orange strokeStyle)
    ctx.strokeStyle = '#7fae79';
    ctx.fillStyle = vfill('#a8d5a2');
    ctx.beginPath();
    ctx.ellipse(tx + tw/2, ty + 10, tw/2 + 5, 8, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();

  } else if (key === 'lounger') {
    // Chaise lounger
    const lx = 0, ly = 0, lw = w, lh = h;
    // Backrest (angled)
    ctx.fillStyle = vfill('#e08d4f');
    ctx.beginPath();
    ctx.moveTo(lx + 5, ly + lh/2);
    ctx.lineTo(lx + lw - 5, ly + lh/2);
    ctx.lineTo(lx + lw - 15, ly);
    ctx.lineTo(lx + 15, ly);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Seat
    ctx.fillStyle = vfill('#f4a261');
    ctx.fillRect(lx, ly + lh/2 - 5, lw, lh/2 + 5);
    ctx.strokeRect(lx, ly + lh/2 - 5, lw, lh/2 + 5);
    // Cushion
    ctx.fillStyle = vfill('#f5b07a');
    ctx.fillRect(lx + 5, ly + lh/2, lw - 10, lh/2 - 8);
    ctx.strokeRect(lx + 5, ly + lh/2, lw - 10, lh/2 - 8);
    // Legs
    ctx.fillStyle = vfill('#6d4c41');
    ctx.fillRect(lx + 5, ly + lh, 5, 6);
    ctx.fillRect(lx + lw - 10, ly + lh, 5, 6);

  } else if (key === 'toy_mouse') {
    // Detailed mouse with ears, tail, eyes
    const mx = w/2, my = h/2;
    // Body
    ctx.fillStyle = vfill('#adb5bd');
    ctx.beginPath();
    ctx.ellipse(mx, my, w/2, h/2, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    // Ears
    ctx.fillStyle = vfill('#949da6');
    ctx.beginPath();
    ctx.arc(mx - w/3, my - h/2 + 2, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx + w/3, my - h/2 + 2, 5, 0, Math.PI*2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = vfill('#ffcdd2');
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
    ctx.fillStyle = vfill('#ffcdd2');
    ctx.beginPath();
    ctx.arc(mx - w/2 + 2, my, 2, 0, Math.PI*2);
    ctx.fill();

  } else if (key === 'scratch_post') {
    // Cylindrical scratching post with rope texture
    const sx = 0, sy = 0, sw = w, sh = h;
    // Base
    ctx.fillStyle = vfill('#6d4c41');
    ctx.fillRect(sx - 10, sy + sh - 10, sw + 20, 10);
    ctx.strokeRect(sx - 10, sy + sh - 10, sw + 20, 10);
    // Post cylinder
    ctx.fillStyle = vfill('#c4a47c');
    ctx.fillRect(sx + 5, sy + 5, sw - 10, sh - 15);
    ctx.strokeRect(sx + 5, sy + 5, sw - 10, sh - 15);
    // Rope texture (diagonal wrap, clipped to the post body)
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx + 5, sy + 5, sw - 10, sh - 15);
    ctx.clip();
    ctx.strokeStyle = '#b08d5e';
    ctx.lineWidth = 1;
    for (let y = sy + 12; y < sy + sh - 12; y += 9) {
      ctx.beginPath();
      ctx.moveTo(sx + 5, y);
      ctx.lineTo(sx + sw - 5, y + 7);
      ctx.stroke();
    }
    ctx.restore();
    // Top cap
    ctx.fillStyle = vfill('#8d6e63');
    ctx.fillRect(sx, sy, sw, 10);
    ctx.strokeRect(sx, sy, sw, 10);
    ctx.fillStyle = vfill('#a1887f');
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
  const isNapping = (catSleeping && c.state !== 'play' && c.state !== 'eat' && c.state !== 'piss') || c.state === 'nap';

  // Breathing: slow vertical swell whenever the cat isn't walking
  const breathe = isWalking ? 1 : 1 + Math.sin(c.frame * 0.05) * 0.015;

  // Blink scheduling (awake poses with open eyes)
  if (c.frame > blink.next) { blink.until = c.frame + 8; blink.next = c.frame + 180 + Math.random() * 360; }
  const isBlinking = c.frame < blink.until;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);
  ctx.scale(1, breathe);

  const fur0 = cat.fur_color || '#d4a373';
  const rawType = cat.type || 'Tabby';
  // Normalize legacy lowercase types (older rows stored 'tabby' etc.)
  const type = rawType.charAt(0).toUpperCase() + rawType.slice(1);
  // Sphynx renders in a skin tone wherever the room draw functions use fur
  const fur = type === 'Sphynx' ? mixColor(fur0, '#c98d7f', 0.55) : fur0;
  const eye = cat.eye_color || '#4caf50';

  // Shadow (breed-sized)
  const shadowScale = type === 'Maine Coon' ? 1.2 : 1.0;
  ctx.fillStyle = 'rgba(0,0,0,0.1)';
  ctx.beginPath();
  ctx.ellipse(0, 35, 25 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fill();

  const poseState = isNapping ? 'nap' : c.state;
  if (isNapping) {
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
  // Breed detail layered on top of the pose (fluff, points mask, flat face, forehead M)
  if (!isNapping) drawBreedExtras(fur, eye, type, bounce, c.state);

  // Blink overlay: lids sweep over the pose's eye positions (stand/sit only)
  if (isBlinking && !isNapping) {
    const g = POSE_GEO[poseState];
    if (g && g.eye) {
      const bScale = getBreedScale(type);
      ctx.save();
      ctx.scale(bScale, bScale);
      ctx.fillStyle = fur;
      ctx.lineCap = 'round';
      ctx.strokeStyle = shadeColor(fur, -25);
      ctx.lineWidth = 1.4;
      for (const [ex, ey, er] of g.eye) {
        ctx.beginPath();
        ctx.ellipse(ex, ey + bounce, er + 1.2, er + 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(ex, ey + bounce + 0.5, er * 0.75, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  ctx.restore();

  // Particle emitters for petting hearts and sleep Zzz
  if (c.heartTimer > 0 && c.frame % 14 === 0) emitParticles('heart', x, y - 45, 1);
  if (isNapping && c.frame % 55 === 0) emitParticles('zzz', x + 22 * facing, y - 28, 1);

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

  // Speech bubble — soft card with tail and fade-out
  if (c.bubble) {
    const total = c.bubble.total || c.bubble.timer;
    c.bubble.total = total;
    const alpha = Math.min(1, c.bubble.timer / 25);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const bw = ctx.measureText(c.bubble.text).width + 22;
    const bh = 28;
    const bx = x - bw / 2;
    const by = y - 86;
    ctx.shadowColor = 'rgba(60,40,20,0.18)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 10);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    // Tail pointing at the cat
    ctx.beginPath();
    ctx.moveTo(x - 5, by + bh);
    ctx.lineTo(x + 5, by + bh);
    ctx.lineTo(x, by + bh + 7);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(210,195,170,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 10); ctx.stroke();
    ctx.fillStyle = '#4a4038';
    ctx.textAlign = 'center';
    ctx.fillText(c.bubble.text, x, by + 18);
    ctx.textAlign = 'left';
    ctx.restore();
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

// Furniture lighting: vertical gradient (light top -> dark bottom) so pieces share one light source.
// _vfH is set by drawFurnitureItem to the current item height (gradient spans the piece + trim above).
let _vfH = 60;
function vfill(color, y0, y1) {
  const g = ctx.createLinearGradient(0, y0 === undefined ? -20 : y0, 0, y1 === undefined ? _vfH + 20 : y1);
  g.addColorStop(0, shadeColor(color, 10));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shadeColor(color, -12));
  return g;
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
  // Player-chosen Calico trio (older cats fall back to classic orange/charcoal)
  const src = activeCdCat || currentCat;
  const patch = (src && src.patch_color) || '#e67e22';
  const dark = (src && src.dark_color) || '#2c3e50';
  const patchColors = [patch, dark, '#ecf0f1'];
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

// ===== BREED EXTRAS (room cat) =====
// Per-pose head/body geometry table, matched to each pose renderer.
// head: [hx, hy, r]   body: [cx, cy, rx, ry]
const POSE_GEO = {
  walk:   { h: [12, -15, 22], b: [0, 10, 28, 22], eyes: [-7, 9, -18, 5], eye: [[4, -18, 6.8], [22, -18, 6.8]] },
  stand:  { h: [12, -15, 22], b: [0, 10, 28, 22], eyes: [-7, 9, -18, 5], eye: [[4, -18, 6.8], [22, -18, 6.8]] },
  sit:    { h: [10, -22, 20], b: [0, 5, 22, 26],  eyes: [-6, 10, -24, 4.5], eye: [[4, -24, 6.5], [20, -24, 6.5]] },
  eat:    { h: [12, -5, 20],  b: [0, 10, 28, 22], eyes: [-8, 10, -8, 4.5], eye: null },
  piss:   { h: [12, -5, 20],  b: [0, 18, 26, 16], eyes: [-8, 10, -8, 4.5], eye: null },
  play:   { h: [12, -12, 20], b: [0, 15, 26, 18], eyes: [-8, 10, -16, 5.5], eye: null },
  petted: { h: [10, -22, 20], b: [0, 5, 22, 26],  eyes: null, eye: null },   // closed happy eyes
  loaf:   { h: [0, -10, 18],  b: [0, 12, 22, 13], eyes: null, eye: null }    // shared face helper
};

function drawBreedExtras(fur, eye, type, bounce, state) {
  if (state === 'nap') return;   // sleeping face: leave the closed-eye art alone
  const g = POSE_GEO[state] || POSE_GEO.stand;
  const [hx, hy0, hr] = g.h;
  const hy = hy0 + bounce;
  const skin = type === 'Sphynx' ? mixColor(fur, '#c98d7f', 0.55) : fur;
  const dark = shadeColor(fur, -40);

  ctx.save();
  const s = getBreedScale(type);
  ctx.scale(s, s);

  // Fluffy silhouette for long-haired breeds
  if (type === 'Maine Coon' || type === 'Persian') {
    pvFluff(ctx, g.b[0], g.b[1], g.b[2] + 1, g.b[3] + 1, shadeColor(fur, -14), 20, 6);
    pvFluff(ctx, hx, hy, hr + 1, hr + 1, shadeColor(fur, -14), 14, 5);
  }

  if (type === 'Tabby') {
    // Forehead "M" — sits above the eyes in every pose
    ctx.strokeStyle = shadeColor(fur, -30);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(hx - 6, hy - hr + 8); ctx.lineTo(hx - 3, hy - hr + 4);
    ctx.lineTo(hx, hy - hr + 8); ctx.lineTo(hx + 3, hy - hr + 4);
    ctx.lineTo(hx + 6, hy - hr + 8);
    ctx.stroke();
  }

  // Face-level detail only where the eye row is known, so closed-eye
  // poses (petted/loaf) are never painted over.
  if (g.eyes && type === 'Siamese') {
    const [dxL, dxR, ey0, er] = g.eyes;
    ctx.fillStyle = dark;
    ctx.beginPath(); ctx.ellipse(hx + 1, hy + 6, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
    // redraw almond blue eyes over the mask at the pose's eye row
    for (const [dx, rot] of [[dxL, -0.3], [dxR, 0.3]]) {
      ctx.save();
      ctx.translate(hx + dx, ey0 + bounce);
      ctx.rotate(rot);
      ctx.fillStyle = 'white';
      ctx.beginPath(); ctx.ellipse(0, 0, er, er * 0.72, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#48cae4';
      ctx.beginPath(); ctx.arc(0, 0, er * 0.55, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  if (g.eyes && type === 'Persian') {
    // Flat face: white muzzle pad + nose + mouth under the big eyes
    const my = hy + 7;
    ctx.fillStyle = mixColor(skin, '#ffffff', 0.6);
    ctx.beginPath(); ctx.ellipse(hx + 2, my, 10, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e2725b';
    ctx.beginPath(); ctx.ellipse(hx + 2, my - 1, 3, 2.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = shadeColor(skin, -30);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(hx - 1, my + 3, 2.8, 0, Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(hx + 5, my + 3, 2.8, 0, Math.PI); ctx.stroke();
  }

  ctx.restore();
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

  // Body with soft volume shading
  const bodyG = ctx.createRadialGradient(-6, 0, 4, 0, 12, 34);
  bodyG.addColorStop(0, shadeColor(fur, 16));
  bodyG.addColorStop(0.65, fur);
  bodyG.addColorStop(1, shadeColor(fur, -18));
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  if (type === 'Persian') {
    ctx.ellipse(0, 10, 30, 24, 0, 0, Math.PI * 2);
  } else {
    ctx.ellipse(0, 10, 28, 22, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  // Belly highlight
  ctx.fillStyle = 'rgba(255,250,240,0.14)';
  ctx.beginPath();
  ctx.ellipse(2, 18, 16, 11, 0, 0, Math.PI * 2);
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

  // Head with gradient
  const headG = ctx.createRadialGradient(8, -22 + bounce, 3, 12, -15 + bounce, 24);
  headG.addColorStop(0, shadeColor(fur, 14));
  headG.addColorStop(1, fur);
  ctx.fillStyle = headG;
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
  ctx.ellipse(4, -18 + bounce, 5.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(22, -18 + bounce, 5.5, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(5, -17 + bounce, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -17 + bounce, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // Pupils + catchlight (the "spark of life")
  ctx.fillStyle = '#222';
  ctx.beginPath();
  ctx.arc(5, -17 + bounce, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, -17 + bounce, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.arc(6.2, -18.4 + bounce, 1.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(24.2, -18.4 + bounce, 1.1, 0, Math.PI * 2);
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

  // Gentle breathing swell
  const breath = 1 + Math.sin(frame * 0.045) * 0.02;
  ctx.scale(1, breath);

  const dark = shadeColor(fur, -25);
  const light = shadeColor(fur, 18);

  // Tail wrapped around the front of the curl
  ctx.strokeStyle = fur;
  ctx.lineWidth = type === 'Maine Coon' ? 12 : 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(-8, 14, 24, Math.PI * 0.75, Math.PI * 1.9);
  ctx.stroke();
  // Tail tip tucked near the face
  ctx.fillStyle = type === 'Siamese' ? getPointColor(fur) : fur;
  ctx.beginPath(); ctx.arc(16, 2, 5.5, 0, Math.PI * 2); ctx.fill();

  // Curled body with volume shading
  const body = ctx.createRadialGradient(-6, 2, 4, -4, 10, 30);
  body.addColorStop(0, light);
  body.addColorStop(0.7, fur);
  body.addColorStop(1, dark);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(-2, 10, 27, 19, -0.08, 0, Math.PI * 2);
  ctx.fill();

  if (type === 'Tabby') drawTabbyStripes(ctx, fur, -2, 10, 27, 19);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, -2, 10, 27, 19);
  if (type === 'Maine Coon') pvFluff(ctx, -2, 10, 27, 19, fur, 14, 6);

  // Head resting on the curl
  const head = ctx.createRadialGradient(12, 2, 2, 14, 8, 18);
  head.addColorStop(0, light);
  head.addColorStop(1, fur);
  ctx.fillStyle = head;
  ctx.beginPath(); ctx.arc(14, 6, 15, 0, Math.PI * 2); ctx.fill();

  // Ears (flattened against the head while asleep)
  const earC = type === 'Siamese' ? getPointColor(fur) : fur;
  ctx.fillStyle = earC;
  ctx.beginPath(); ctx.moveTo(3, -4); ctx.lineTo(-2, -14); ctx.lineTo(9, -9); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(20, -6); ctx.lineTo(27, -14); ctx.lineTo(27, -3); ctx.closePath(); ctx.fill();

  // Closed eyes: soft curved lashes
  ctx.strokeStyle = '#3a3532';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(8, 4, 3.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.arc(20, 4, 3.2, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();

  // Nose + tiny mouth
  ctx.fillStyle = '#ffab91';
  ctx.beginPath(); ctx.moveTo(14, 8); ctx.lineTo(11.8, 11); ctx.lineTo(16.2, 11); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(80,60,50,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(14, 12.5, 2.2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();

  // Front paws tucked under the chin
  ctx.fillStyle = type === 'Siamese' ? getPointColor(fur) : light;
  ctx.beginPath(); ctx.ellipse(6, 18, 5, 3.4, 0.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(16, 19, 5, 3.4, -0.1, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}


// Generic face for poses that don't draw eyes individually (e.g. loaf).
// Signature kept for the existing call site: drawCatFace(ctx, eye, type, x, y, sleeping)
function drawCatFace(c, eye, type, x, y, sleeping) {
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  if (sleeping) {
    c.strokeStyle = '#333'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x - 8, y - 2); c.lineTo(x - 2, y - 2); c.stroke();
    c.beginPath(); c.moveTo(x + 2, y - 2); c.lineTo(x + 8, y - 2); c.stroke();
  } else {
    c.fillStyle = 'white';
    c.beginPath(); c.ellipse(x - 5, y - 2, 4.5, 5.5, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(x + 5, y - 2, 4.5, 5.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = eyeColor;
    c.beginPath(); c.arc(x - 5, y - 1.5, 2.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(x + 5, y - 1.5, 2.6, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#ffab91';
  c.beginPath(); c.arc(x, y + 4, 2, 0, Math.PI * 2); c.fill();
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

  // Head dips toward the bowl with the chewing rhythm
  const dip = Math.sin(frame * 0.18) * 2;
  const hy = -3 + bounce + dip;

  // Body with soft volume shading
  const bodyG = ctx.createRadialGradient(-6, 0, 4, 0, 10, 34);
  bodyG.addColorStop(0, shadeColor(fur, 16));
  bodyG.addColorStop(0.65, fur);
  bodyG.addColorStop(1, shadeColor(fur, -18));
  ctx.fillStyle = bodyG;
  ctx.beginPath();
  ctx.ellipse(0, 10, 28, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  if (type === 'Tabby') drawTabbyStripes(ctx, fur, 0, 10, 28, 22);
  if (type === 'Calico') drawCalicoPatches(ctx, fur, 0, 10, 28, 22);
  // Belly highlight
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  ctx.ellipse(-2, 22, 16, 8, 0, 0, Math.PI * 2);
  ctx.fill();

  // Head, lowered and gradient-shaded
  const headG = ctx.createRadialGradient(8, hy - 8, 3, 12, hy, 24);
  headG.addColorStop(0, shadeColor(fur, 14));
  headG.addColorStop(1, fur);
  ctx.fillStyle = headG;
  ctx.beginPath();
  ctx.arc(12, hy, 20, 0, Math.PI * 2);
  ctx.fill();

  // Ears
  drawBreedEars(ctx, type, fur, bounce + dip, 0, 15);

  // Content half-closed eyes while eating (upper lid cuts the eye, small shine below)
  const eyeColor = type === 'Siamese' ? '#48cae4' : eye;
  for (const ex of [4, 22]) {
    ctx.fillStyle = 'white';
    ctx.beginPath(); ctx.ellipse(ex, -6 + bounce + dip, 5.5, 4, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = eyeColor;
    ctx.beginPath(); ctx.arc(ex + 1, -5 + bounce + dip, 3, 0, Math.PI * 2); ctx.fill();
    // upper lid — eyes lowered in food-focus
    ctx.fillStyle = shadeColor(fur, -10);
    ctx.beginPath(); ctx.ellipse(ex, -8.5 + bounce + dip, 6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(ex + 2, -4 + bounce + dip, 0.9, 0, Math.PI * 2); ctx.fill();
  }

  // Nose
  ctx.fillStyle = '#e08a8a';
  ctx.beginPath();
  ctx.moveTo(11, 1 + bounce + dip);
  ctx.lineTo(15, 1 + bounce + dip);
  ctx.lineTo(13, 3.2 + bounce + dip);
  ctx.closePath();
  ctx.fill();

  // Mouth chewing
  ctx.strokeStyle = '#555';
  ctx.lineWidth = 1.5;
  const chew = Math.sin(frame * 0.2) * 2;
  ctx.beginPath();
  ctx.arc(10, 5 + bounce + dip + chew * 0.5, 3, 0, Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(16, 5 + bounce + dip + chew * 0.5, 3, 0, Math.PI);
  ctx.stroke();

  // Whiskers fanning from each cheek
  ctx.strokeStyle = 'rgba(80,60,50,0.5)';
  ctx.lineWidth = 1;
  for (const s of [-1, 1]) {
    const bx = 13 + s * 6;
    ctx.beginPath(); ctx.moveTo(bx, 2 + bounce + dip); ctx.lineTo(bx + s * 13, 0 + bounce + dip); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, 4 + bounce + dip); ctx.lineTo(bx + s * 13, 6 + bounce + dip); ctx.stroke();
  }

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

// ===== PARTICLES =====
// Unified fx system: hearts, Zzz, clean-up poofs, play sparkles.
const particles = [];
function emitParticles(kind, x, y, count = 1) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const p = { kind, x: x + (Math.random() - 0.5) * 16, y: y + (Math.random() - 0.5) * 8, life: 0 };
    if (kind === 'heart') Object.assign(p, { vx: (Math.random() - 0.5) * 0.6, vy: -0.9 - Math.random() * 0.5, max: 70 + Math.random() * 25, size: 9 + Math.random() * 5 });
    else if (kind === 'zzz') Object.assign(p, { vx: 0.25, vy: -0.45, max: 110, size: 11 + Math.random() * 5 });
    else if (kind === 'poof') Object.assign(p, { vx: Math.cos(a) * (1 + Math.random() * 1.6), vy: Math.sin(a) * (0.8 + Math.random() * 1.2) - 0.6, max: 32 + Math.random() * 14, size: 5 + Math.random() * 5 });
    else if (kind === 'sparkle') Object.assign(p, { vx: (Math.random() - 0.5) * 1.4, vy: -0.5 - Math.random() * 0.9, max: 45, size: 5 + Math.random() * 4 });
    particles.push(p);
  }
  if (particles.length > 120) particles.splice(0, particles.length - 120);
}
function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life++;
    p.x += p.vx; p.y += p.vy;
    if (p.kind === 'poof') { p.vx *= 0.92; p.vy = p.vy * 0.92 - 0.02; }
    if (p.kind === 'heart') p.x += Math.sin(p.life * 0.18) * 0.5;
    if (p.life >= p.max) particles.splice(i, 1);
  }
}
function drawParticles() {
  if (!particles.length) return;
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of particles) {
    const t = p.life / p.max;
    ctx.globalAlpha = Math.max(0, t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85);
    if (p.kind === 'heart') {
      ctx.fillStyle = '#e85d75';
      ctx.font = `bold ${p.size}px sans-serif`;
      ctx.fillText('\u2665', p.x, p.y);
    } else if (p.kind === 'zzz') {
      ctx.fillStyle = 'rgba(125,135,190,0.95)';
      ctx.font = `bold ${p.size}px Georgia, serif`;
      ctx.fillText(p.life % 40 < 20 ? 'z' : 'Z', p.x, p.y);
    } else if (p.kind === 'poof') {
      ctx.fillStyle = 'rgba(228,222,210,0.75)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1 + t), 0, Math.PI * 2); ctx.fill();
    } else if (p.kind === 'sparkle') {
      ctx.fillStyle = '#f4a261';
      const s = p.size * (1 - t * 0.5);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.3, p.y - s * 0.3);
      ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x + s * 0.3, p.y + s * 0.3);
      ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s * 0.3, p.y + s * 0.3);
      ctx.lineTo(p.x - s, p.y); ctx.lineTo(p.x - s * 0.3, p.y - s * 0.3);
      ctx.closePath(); ctx.fill();
    }
  }
  ctx.restore();
}

// Blink scheduling (frame-based; shared by room cat)
const blink = { until: 0, next: 200 };

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

  // Vignette sits under the cat so the sprite always reads crisp
  drawNightVignette();

  updateCatAI();
  updateParticles();
  drawCat();
  drawParticles();
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
let petCooldownUntil = 0;
async function doPet() {
  if (Date.now() < petCooldownUntil) return;   // mash-proof, saves API calls
  petCooldownUntil = Date.now() + 1500;
  try {
    const data = await api('POST', '/api/cat/pet');
    currentCat = data.cat;
    updateStats();
    logChat(data.message, false);
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
  } catch (e) {
    logChat(e.message, true);
  }
}

chatOptions.querySelectorAll('button[data-action]').forEach(btn => {
  btn.onclick = async () => {
    const action = btn.dataset.action;
    if (action === 'feed') {
      chatOptions.classList.add('hidden');
      feedOptions.classList.remove('hidden');
      return;
    }
    if (action === 'pet') { await doPet(); return; }
    try {
      const data = await api('POST', `/api/cat/${action}`);
      currentCat = data.cat;
      updateStats();
      logChat(data.message, false);

      if (action === 'talk') {
        catEntity.bubble = { text: data.message, timer: 120 };
      } else if (action === 'play') {
        catEntity.state = 'play';
        catEntity.timer = 0;
        catEntity.bubble = { text: 'Meow!', timer: 90 };
        emitParticles('sparkle', catEntity.x, catEntity.y - 30, 5);
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
    for (const m of messes) emitParticles('poof', m.x, m.y, 6);
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
      btn.classList.remove('ready');
    } else {
      btn.disabled = false;
      btn.textContent = 'Claim Daily Catstream';
      btn.classList.add('ready');
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
  const money = currentCat ? (currentCat.total_earnings || 0) : 0;
  const sections = [
    { title: 'Food', items: SHOP_DEF.filter(i => i.id.endsWith('_food')) },
    { title: 'Furniture & Toys', items: SHOP_DEF.filter(i => !i.id.endsWith('_food')) }
  ];
  for (const sec of sections) {
    const h = document.createElement('div');
    h.className = 'shop-section-title';
    h.textContent = sec.title;
    shopItems.appendChild(h);
    for (const item of sec.items) {
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.innerHTML = `<div class="shop-item-info"><span>${item.name}</span><small>${item.desc}</small></div><button ${money < item.cost ? 'disabled' : ''}>$${item.cost}</button>`;
      div.querySelector('button').onclick = async () => {
        try {
          const data = await api('POST', '/api/shop/buy', { itemId: item.id });
          await loadInventory();
          currentCat.total_earnings = data.money;
          updateStats();
          logChat(data.message, true);
          document.getElementById('btn-shop').onclick(); // refresh affordability
        } catch (e) {
          logChat(e.message, true);
        }
      };
      shopItems.appendChild(div);
    }
  }
  shopModal.classList.remove('hidden');
};

// Tap the dim backdrop to dismiss the shop (mobile-friendly)
shopModal.addEventListener('click', (e) => {
  if (e.target === shopModal) shopModal.classList.add('hidden');
});

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
    furColor: currentCat.fur_color,
    eyeColor: currentCat.eye_color,
    patchColor: currentCat.patch_color,
    darkColor: currentCat.dark_color
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
const cdCtx = setupHiDPI(cdCanvas, 800, 500);

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

// Catdergarten park background — cached like the room (gradients, grass, fence, bushes)
const cdBg = document.createElement('canvas');
let cdBgBuilt = false;
function buildCdBg() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cdBg._dpr = dpr;
  cdBg.width = 800 * dpr; cdBg.height = 500 * dpr;
  cdBgBuilt = true;
  const b = cdBg.getContext('2d');
  b.setTransform(dpr, 0, 0, dpr, 0, 0);
  const sky = b.createLinearGradient(0, 0, 0, 220);
  sky.addColorStop(0, '#aee5ff'); sky.addColorStop(1, '#d8f4ff');
  b.fillStyle = sky; b.fillRect(0, 0, 800, 220);
  // Sun
  const sg = b.createRadialGradient(700, 55, 6, 700, 55, 40);
  sg.addColorStop(0, 'rgba(255,225,130,0.95)'); sg.addColorStop(1, 'rgba(255,225,130,0)');
  b.fillStyle = sg; b.beginPath(); b.arc(700, 55, 40, 0, Math.PI * 2); b.fill();
  b.fillStyle = '#ffd766'; b.beginPath(); b.arc(700, 55, 16, 0, Math.PI * 2); b.fill();
  // Lawn
  const lawn = b.createLinearGradient(0, 200, 0, 500);
  lawn.addColorStop(0, '#9fd08a'); lawn.addColorStop(1, '#79b868');
  b.fillStyle = lawn; b.fillRect(0, 195, 800, 305);
  // Mower stripes
  b.fillStyle = 'rgba(255,255,255,0.07)';
  for (let i = 0; i < 8; i++) if (i % 2 === 0) b.fillRect(0, 200 + i * 38, 800, 38);
  // Path
  b.fillStyle = '#e8dab8';
  b.beginPath(); b.ellipse(400, 470, 300, 46, 0, 0, Math.PI * 2); b.fill();
  b.fillStyle = 'rgba(0,0,0,0.05)';
  b.beginPath(); b.ellipse(400, 470, 300, 46, 0, 0, Math.PI * 2); b.lineWidth = 3;
  b.strokeStyle = 'rgba(120,100,60,0.25)'; b.stroke();
  // Fence
  b.fillStyle = '#a1887f';
  b.fillRect(0, 178, 800, 6);
  for (let x = 10; x < 800; x += 46) {
    b.fillStyle = '#bcaaa4';
    b.beginPath();
    b.roundRect(x, 148, 12, 40, 3); b.fill();
    b.fillStyle = '#a1887f';
    b.beginPath();
    b.moveTo(x, 152); b.lineTo(x + 6, 143); b.lineTo(x + 12, 152); b.closePath(); b.fill();
  }
  b.fillStyle = '#8d6e63'; b.fillRect(0, 160, 800, 5);
  // Bushes
  for (const [bx, by, s] of [[60, 200, 1], [230, 205, 0.8], [560, 202, 0.9], [740, 206, 1.1]]) {
    b.fillStyle = '#6aa85c';
    b.beginPath(); b.arc(bx, by, 22 * s, 0, Math.PI * 2); b.fill();
    b.beginPath(); b.arc(bx + 20 * s, by + 4 * s, 16 * s, 0, Math.PI * 2); b.fill();
    b.beginPath(); b.arc(bx - 18 * s, by + 5 * s, 14 * s, 0, Math.PI * 2); b.fill();
    b.fillStyle = 'rgba(255,255,255,0.12)';
    b.beginPath(); b.arc(bx - 5 * s, by - 8 * s, 8 * s, 0, Math.PI * 2); b.fill();
  }
  // Grass tufts
  b.strokeStyle = 'rgba(70,120,55,0.5)'; b.lineWidth = 1.5; b.lineCap = 'round';
  const rnd = seededRand(4242);
  for (let i = 0; i < 60; i++) {
    const gx = rnd() * 800, gy = 230 + rnd() * 250, gh = 5 + rnd() * 4;
    b.beginPath();
    b.moveTo(gx, gy); b.lineTo(gx - 2, gy - gh);
    b.moveTo(gx, gy); b.lineTo(gx + 2.5, gy - gh * 0.8);
    b.stroke();
  }
}

function drawCatdergarten() {
  if (screens.catdergarten.classList.contains('hidden')) {
    requestAnimationFrame(drawCatdergarten);
    return;
  }
  if (!cdBgBuilt) buildCdBg();
  cdCtx.drawImage(cdBg, 0, 0, 800, 500);

  for (const [id, c] of catdergartenCats) {
    withCtx(cdCtx, () => {
      const savedCd = activeCdCat;
      activeCdCat = { patch_color: c.patchColor, dark_color: c.darkColor };
      try {
        cdCtx.save();
        cdCtx.translate(c.x, c.y);
        const cType = (c.type || 'Tabby'); const type2 = cType.charAt(0).toUpperCase() + cType.slice(1);
        const fur = type2 === 'Sphynx' ? mixColor(c.furColor || '#d4a373', '#c98d7f', 0.55) : (c.furColor || '#d4a373');
        const bounce = Math.sin(c.frame * 0.1) * 2;
        cdCtx.fillStyle = 'rgba(0,0,0,0.1)';
        cdCtx.beginPath(); cdCtx.ellipse(0, 35, 25, 8, 0, 0, Math.PI * 2); cdCtx.fill();
        drawStandingCat(fur, c.eyeColor || '#4caf50', type2, bounce, true, c.frame);
        drawBreedExtras(fur, c.eyeColor || '#4caf50', type2, bounce, 'stand');
        cdCtx.fillStyle = '#333';
        cdCtx.font = '11px sans-serif';
        cdCtx.textAlign = 'center';
        cdCtx.fillText(c.name, 0, 48);
        cdCtx.restore();
      } finally { activeCdCat = savedCd; }
    });
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
    const age = now - evt.time;
    const alpha = age < 2000 ? 1 : 1 - (age - 2000) / 1000;
    const y = 80 + i * 30;
    cdCtx.fillStyle = `rgba(255, 215, 0, ${Math.max(0, alpha * 0.95)})`;
    cdCtx.beginPath();
    cdCtx.roundRect(10, y - 18, 200, 24, 6);
    cdCtx.fill();
    cdCtx.strokeStyle = `rgba(180, 140, 0, ${Math.max(0, alpha * 0.6)})`;
    cdCtx.lineWidth = 1;
    cdCtx.stroke();
    cdCtx.fillStyle = `rgba(30,25,0,${Math.max(0, alpha)})`;
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
canvas.addEventListener('pointerdown', (e) => {
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

canvas.addEventListener('pointermove', (e) => {
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

canvas.addEventListener('pointerup', async (e) => {
  if (!dragFurniture) {
    // Tapping the cat directly = pet it (works with touch)
    const pos = getCanvasMousePos(e);
    const dx = pos.x - catEntity.x, dy = pos.y - (catEntity.y - 15);
    if (Math.sqrt(dx * dx + dy * dy) < 45) { await doPet(); return; }
    if (!catSleeping) setCatTarget(pos.x, pos.y, 'walk');
    return;
  }
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

canvas.addEventListener('pointercancel', () => {
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
