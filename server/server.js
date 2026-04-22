const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

const JWT_SECRET = process.env.JWT_SECRET || 'meowser-secret-key-change-me';
const PORT = process.env.PORT || 3000;

// ===== DATABASE SETUP =====
const db = new Database(path.join(__dirname, 'meowser.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    reset_token TEXT,
    reset_expires INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS cats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    fur_color TEXT NOT NULL,
    eye_color TEXT NOT NULL,
    happiness REAL DEFAULT 50,
    hunger REAL DEFAULT 50,
    age INTEGER DEFAULT 0,
    growth_stage TEXT DEFAULT 'kitten',
    last_fed INTEGER DEFAULT 0,
    last_petted INTEGER DEFAULT 0,
    last_played INTEGER DEFAULT 0,
    last_ubi_claim INTEGER DEFAULT 0,
    is_in_catdergarten INTEGER DEFAULT 0,
    catdergarten_arrived INTEGER DEFAULT 0,
    total_earnings REAL DEFAULT 0,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    quantity INTEGER DEFAULT 0,
    UNIQUE(user_id, item_type)
  );

  CREATE TABLE IF NOT EXISTS furniture (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    item_type TEXT NOT NULL,
    x INTEGER DEFAULT 0,
    y INTEGER DEFAULT 0,
    room_type TEXT DEFAULT 'home'
  );

  CREATE TABLE IF NOT EXISTS ubi_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    claim_date TEXT NOT NULL,
    amount REAL NOT NULL,
    bonus_percent REAL DEFAULT 0,
    UNIQUE(user_id, claim_date)
  );

  CREATE TABLE IF NOT EXISTS messes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    created_at INTEGER DEFAULT (unixepoch())
  );
`);

// Migration: add game time columns if not exist
function addColumnIfNotExists(table, col, def) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  } catch (e) {
    // likely already exists
  }
}
addColumnIfNotExists('cats', 'game_minutes', 'INTEGER DEFAULT 0');
addColumnIfNotExists('cats', 'game_day', 'INTEGER DEFAULT 1');
addColumnIfNotExists('cats', 'last_game_tick', 'INTEGER DEFAULT 0');
addColumnIfNotExists('cats', 'last_ubi_game_day', 'INTEGER DEFAULT 0');

// Seed default furniture for new cats
const STARTER_FURNITURE = ['bed', 'couch', 'cat_bed', 'water_bowl', 'food_bowl', 'sandbox'];

// ===== EMAIL SETUP (Ethereal for demo) =====
let transporter = null;
async function setupEmail() {
  const testAccount = await nodemailer.createTestAccount();
  transporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    auth: { user: testAccount.user, pass: testAccount.pass }
  });
  console.log('Email preview account:', testAccount.web);
}
setupEmail().catch(() => {
  console.log('Email setup failed, password reset will log to console');
});

// ===== MIDDLEWARE =====
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ===== HELPERS =====
function getNow() { return Math.floor(Date.now() / 1000); }
function getToday() { return new Date().toISOString().split('T')[0]; }

function updateGameTime(cat) {
  const now = getNow();
  if (!cat.last_game_tick) {
    return { ...cat, game_minutes: cat.game_minutes || 0, game_day: cat.game_day || 1 };
  }
  const elapsed = now - cat.last_game_tick;
  // Cap at 2 minutes per update to prevent huge jumps
  const capped = Math.min(elapsed, 120);
  const newMinutes = (cat.game_minutes || 0) + Math.floor(capped / 60);
  const newDay = Math.floor(newMinutes / 30) + 1;
  db.prepare('UPDATE cats SET game_minutes = ?, game_day = ?, last_game_tick = ? WHERE id = ?')
    .run(newMinutes, newDay, now, cat.id);
  return { ...cat, game_minutes: newMinutes, game_day: newDay, last_game_tick: now };
}

function calculateCatStats(cat) {
  const now = getNow();
  const hoursSinceFed = (now - cat.last_fed) / 3600;
  const hoursSincePetted = (now - cat.last_petted) / 3600;
  const hoursSincePlayed = (now - cat.last_played) / 3600;

  let hunger = cat.hunger - (hoursSinceFed * 5);
  let happiness = cat.happiness;

  // Hunger affects happiness
  if (hunger < 20) happiness -= 10;
  else if (hunger < 50) happiness -= 3;

  // Social needs affect happiness
  if (hoursSincePetted > 8) happiness -= 5;
  if (hoursSincePlayed > 12) happiness -= 5;

  // Messes affect happiness
  const messCount = db.prepare('SELECT COUNT(*) as c FROM messes WHERE user_id = ?').get(cat.user_id)?.c || 0;
  if (messCount > 0) happiness -= messCount * 3;

  // Cap values
  hunger = Math.max(0, Math.min(100, hunger));
  happiness = Math.max(0, Math.min(100, happiness));

  // Growth stage based on age (days)
  const ageDays = (now - cat.created_at) / 86400;
  let stage = 'newborn';
  if (ageDays > 14) stage = 'kitten';
  if (ageDays > 30) stage = 'teen';
  if (ageDays > 60) stage = 'adult';
  if (ageDays > 200) stage = 'elder';

  return { hunger, happiness, growth_stage: stage, age: Math.floor(ageDays), game_day: cat.game_day || 1, mess_count: messCount };
}

function getWellCaredBonus(happiness) {
  return happiness >= 70 ? 0.20 : 0;
}

// ===== AUTH ROUTES =====
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email required, password min 6 chars' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
    for (const item of STARTER_FURNITURE) {
      db.prepare('INSERT INTO furniture (user_id, item_type) VALUES (?, ?)').run(result.lastInsertRowid, item);
    }
    db.prepare('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, ?)').run(result.lastInsertRowid, 'dry_food', 3);
    const token = jwt.sign({ userId: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: result.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Email already registered' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ message: 'If email exists, reset sent' });

  const token = uuidv4();
  const expires = getNow() + 3600;
  db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expires, user.id);

  const resetUrl = `http://localhost:${PORT}/?token=${token}`;
  if (transporter) {
    const info = await transporter.sendMail({
      from: 'meowser@game.local',
      to: email,
      subject: 'Meowser Password Reset',
      text: `Reset your password: ${resetUrl}`
    });
    console.log('Password reset email preview:', nodemailer.getTestMessageUrl(info));
  }
  console.log(`RESET URL for ${email}: ${resetUrl}`);
  res.json({ message: 'If email exists, reset sent', previewUrl: transporter ? 'check console' : null });
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || user.reset_expires < getNow()) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  const hash = await bcrypt.hash(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = 0 WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password updated' });
});

// ===== CAT ROUTES =====
app.get('/api/cat', authMiddleware, (req, res) => {
  let cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.json({ cat: null });

  // Update game time
  cat = updateGameTime(cat);

  // Random chance to create mess if enough time passed
  const now = getNow();
  const elapsed = now - (cat.last_game_tick || now);
  const messCount = db.prepare('SELECT COUNT(*) as c FROM messes WHERE user_id = ?').get(req.user.userId)?.c || 0;
  if (messCount < 5 && elapsed > 300) {
    // 15% chance per 5+ minute period
    if (Math.random() < 0.15) {
      const type = Math.random() < 0.7 ? 'piss' : 'poop';
      const mx = 80 + Math.random() * 640;
      const my = 120 + Math.random() * 320;
      db.prepare('INSERT INTO messes (user_id, type, x, y) VALUES (?, ?, ?, ?)')
        .run(req.user.userId, type, mx, my);
    }
  }

  const stats = calculateCatStats(cat);
  res.json({ cat: { ...cat, ...stats } });
});

app.post('/api/cat', authMiddleware, (req, res) => {
  const { name, type, fur_color, eye_color } = req.body;
  const existing = db.prepare('SELECT id FROM cats WHERE user_id = ?').get(req.user.userId);
  if (existing) return res.status(400).json({ error: 'You already have a cat' });

  const now = getNow();
  const result = db.prepare(
    'INSERT INTO cats (user_id, name, type, fur_color, eye_color, last_fed, last_petted, last_played, last_ubi_claim, last_game_tick, game_minutes, game_day, last_ubi_game_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(req.user.userId, name, type, fur_color, eye_color, now, now, now, now, now, 0, 1, 0);

  const cat = db.prepare('SELECT * FROM cats WHERE id = ?').get(result.lastInsertRowid);
  res.json({ cat: { ...cat, ...calculateCatStats(cat) } });
});

app.post('/api/cat/feed', authMiddleware, (req, res) => {
  const { foodType } = req.body;
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Cat is at catdergarten' });

  const foods = {
    dry: { hunger: 15, happiness: 2, cost: 5 },
    wet: { hunger: 30, happiness: 5, cost: 12 },
    wagyu: { hunger: 60, happiness: 25, cost: 50 },
    roadkill: { hunger: 10, happiness: -5, cost: 0 }
  };
  const food = foods[foodType];
  if (!food) return res.status(400).json({ error: 'Unknown food' });

  const inv = db.prepare('SELECT * FROM inventory WHERE user_id = ? AND item_type = ?').get(req.user.userId, foodType + '_food');
  if (!inv || inv.quantity < 1) {
    return res.status(400).json({ error: `No ${foodType} food in inventory. Visit the shop!` });
  }

  db.prepare('UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?').run(req.user.userId, foodType + '_food');

  const newHunger = Math.min(100, cat.hunger + food.hunger);
  const newHappiness = Math.min(100, Math.max(0, cat.happiness + food.happiness));
  db.prepare('UPDATE cats SET hunger = ?, happiness = ?, last_fed = ? WHERE id = ?').run(newHunger, newHappiness, getNow(), cat.id);

  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, message: `Fed ${foodType}! Meow!` });
});

app.post('/api/cat/pet', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const newHappiness = Math.min(100, cat.happiness + 8);
  db.prepare('UPDATE cats SET happiness = ?, last_petted = ? WHERE id = ?').run(newHappiness, getNow(), cat.id);

  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, message: 'You petted the cat. Meow!' });
});

app.post('/api/cat/play', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Cat is at catdergarten' });

  const newHappiness = Math.min(100, cat.happiness + 12);
  const newHunger = Math.max(0, cat.hunger - 5);
  db.prepare('UPDATE cats SET happiness = ?, hunger = ?, last_played = ? WHERE id = ?').run(newHappiness, newHunger, getNow(), cat.id);

  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, message: 'You played with the cat! Meow!' });
});

app.post('/api/cat/talk', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const newHappiness = Math.min(100, cat.happiness + 2);
  db.prepare('UPDATE cats SET happiness = ? WHERE id = ?').run(newHappiness, cat.id);

  const meows = ['Meow!', 'Mrrrow?', 'Purr...', 'Meow meow!', 'Mew!'];
  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, message: meows[Math.floor(Math.random() * meows.length)] });
});

app.post('/api/cat/clean', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const messes = db.prepare('SELECT * FROM messes WHERE user_id = ?').all(req.user.userId);
  if (messes.length === 0) return res.status(400).json({ error: 'Nothing to clean!' });

  const earnings = messes.length * 1;
  db.prepare('DELETE FROM messes WHERE user_id = ?').run(req.user.userId);
  db.prepare('UPDATE cats SET total_earnings = total_earnings + ? WHERE id = ?').run(earnings, cat.id);

  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, earnings, message: `Cleaned up ${messes.length} messes! +$${earnings}` });
});

app.post('/api/cat/reset', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (cat) {
    db.prepare('DELETE FROM cats WHERE user_id = ?').run(req.user.userId);
    db.prepare('DELETE FROM inventory WHERE user_id = ?').run(req.user.userId);
    db.prepare('DELETE FROM furniture WHERE user_id = ?').run(req.user.userId);
    db.prepare('DELETE FROM messes WHERE user_id = ?').run(req.user.userId);
    db.prepare('DELETE FROM ubi_claims WHERE user_id = ?').run(req.user.userId);
  }
  // Re-seed starter furniture and items
  const existingFurn = db.prepare('SELECT COUNT(*) as c FROM furniture WHERE user_id = ?').get(req.user.userId).c;
  if (existingFurn === 0) {
    for (const item of STARTER_FURNITURE) {
      db.prepare('INSERT INTO furniture (user_id, item_type) VALUES (?, ?)').run(req.user.userId, item);
    }
    db.prepare('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, ?)').run(req.user.userId, 'dry_food', 3);
  }
  res.json({ message: 'Game reset. Adopt a new cat!' });
});

// ===== MESSES =====
app.get('/api/messes', authMiddleware, (req, res) => {
  const messes = db.prepare('SELECT * FROM messes WHERE user_id = ?').all(req.user.userId);
  res.json({ messes });
});

app.post('/api/cat/mess', authMiddleware, (req, res) => {
  const { type, x, y } = req.body;
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const messCount = db.prepare('SELECT COUNT(*) as c FROM messes WHERE user_id = ?').get(req.user.userId)?.c || 0;
  if (messCount >= 5) return res.status(400).json({ error: 'Too messy!' });

  db.prepare('INSERT INTO messes (user_id, type, x, y) VALUES (?, ?, ?, ?)')
    .run(req.user.userId, type || 'piss', x || 400, y || 300);
  res.json({ message: 'Mess created' });
});

// ===== CATDERGARTEN =====
app.post('/api/catdergarten/send', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Already there' });

  db.prepare('UPDATE cats SET is_in_catdergarten = 1, catdergarten_arrived = ? WHERE id = ?').run(getNow(), cat.id);
  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, message: 'Cat went to catdergarten!' });
});

app.post('/api/catdergarten/return', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat || !cat.is_in_catdergarten) return res.status(400).json({ error: 'Not at catdergarten' });

  const now = getNow();
  const hours = Math.max(0, (now - cat.catdergarten_arrived) / 3600);
  const stats = calculateCatStats(cat);
  const bonus = getWellCaredBonus(stats.happiness);
  const earnings = Math.floor(hours * 2 * (1 + bonus) * 10) / 10;

  db.prepare('UPDATE cats SET is_in_catdergarten = 0, catdergarten_arrived = 0, total_earnings = total_earnings + ? WHERE id = ?').run(earnings, cat.id);

  const updated = db.prepare('SELECT * FROM cats WHERE id = ?').get(cat.id);
  res.json({ cat: { ...updated, ...calculateCatStats(updated) }, earnings, message: `Cat returned! Earned $${earnings}` });
});

// ===== SHOP & INVENTORY =====
app.get('/api/inventory', authMiddleware, (req, res) => {
  const items = db.prepare('SELECT * FROM inventory WHERE user_id = ?').all(req.user.userId);
  const furn = db.prepare('SELECT * FROM furniture WHERE user_id = ? AND room_type = ?').all(req.user.userId, 'home');
  const cat = db.prepare('SELECT total_earnings FROM cats WHERE user_id = ?').get(req.user.userId);
  res.json({ items, furniture: furn, money: cat?.total_earnings || 0 });
});

const SHOP_ITEMS = {
  dry_food: { name: 'Dry Cat Food', cost: 5, type: 'food' },
  wet_food: { name: 'Wet Cat Food', cost: 12, type: 'food' },
  wagyu_food: { name: 'A5 Wagyu', cost: 50, type: 'food' },
  roadkill_food: { name: 'Roadkill', cost: 0, type: 'food' },
  cat_tree: { name: 'Cat Tree', cost: 80, type: 'furniture' },
  lounger: { name: 'Cat Lounger', cost: 45, type: 'furniture' },
  toy_mouse: { name: 'Toy Mouse', cost: 15, type: 'furniture' },
  scratch_post: { name: 'Scratching Post', cost: 30, type: 'furniture' }
};

app.post('/api/shop/buy', authMiddleware, (req, res) => {
  const { itemId } = req.body;
  const item = SHOP_ITEMS[itemId];
  if (!item) return res.status(400).json({ error: 'Unknown item' });

  const cat = db.prepare('SELECT total_earnings FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat || cat.total_earnings < item.cost) return res.status(400).json({ error: 'Not enough money' });

  db.prepare('UPDATE cats SET total_earnings = total_earnings - ? WHERE user_id = ?').run(item.cost, req.user.userId);

  if (item.type === 'food') {
    db.prepare('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, 1) ON CONFLICT(user_id, item_type) DO UPDATE SET quantity = quantity + 1').run(req.user.userId, itemId);
  } else {
    db.prepare('INSERT INTO furniture (user_id, item_type, room_type) VALUES (?, ?, ?)').run(req.user.userId, itemId, 'home');
  }

  res.json({ message: `Bought ${item.name}!`, money: cat.total_earnings - item.cost });
});

// ===== UBI / CATSTREAM (per game day) =====
app.get('/api/ubi/claim', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const updatedCat = updateGameTime(cat);
  const currentGameDay = updatedCat.game_day || 1;
  const lastClaimDay = updatedCat.last_ubi_game_day || 0;

  if (currentGameDay <= lastClaimDay) {
    return res.status(400).json({ error: 'Already claimed this game day' });
  }

  const stats = calculateCatStats(updatedCat);
  const bonus = getWellCaredBonus(stats.happiness);
  const baseAmount = 20;
  const totalAmount = Math.floor(baseAmount * (1 + bonus) * 100) / 100;

  db.prepare('UPDATE cats SET total_earnings = total_earnings + ?, last_ubi_game_day = ? WHERE id = ?')
    .run(totalAmount, currentGameDay, updatedCat.id);

  const refreshed = db.prepare('SELECT * FROM cats WHERE id = ?').get(updatedCat.id);
  res.json({ amount: totalAmount, bonus: bonus * 100, cat: { ...refreshed, ...calculateCatStats(refreshed) } });
});

app.get('/api/ubi/status', authMiddleware, (req, res) => {
  const cat = db.prepare('SELECT * FROM cats WHERE user_id = ?').get(req.user.userId);
  if (!cat) return res.json({ claimedToday: false, amount: null });

  const updatedCat = updateGameTime(cat);
  const currentGameDay = updatedCat.game_day || 1;
  const lastClaimDay = updatedCat.last_ubi_game_day || 0;

  res.json({ claimedToday: currentGameDay <= lastClaimDay, amount: null, gameDay: currentGameDay });
});

// ===== SOCKET.IO CATDERGARTEN =====
const catdergartenCats = new Map();

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-catdergarten', (data) => {
    const { name, type, furColor } = data;
    catdergartenCats.set(socket.id, {
      x: 100 + Math.random() * 600,
      y: 100 + Math.random() * 400,
      vx: 0, vy: 0,
      name, type, furColor,
      frame: 0,
      targetX: null, targetY: null
    });
    socket.join('catdergarten');
    socket.emit('catdergarten-state', Array.from(catdergartenCats.entries()).map(([id, c]) => ({ id, ...c })));
    socket.to('catdergarten').emit('cat-joined', { id: socket.id, ...catdergartenCats.get(socket.id) });
  });

  socket.on('cat-move', (data) => {
    const cat = catdergartenCats.get(socket.id);
    if (cat) {
      cat.targetX = data.x;
      cat.targetY = data.y;
    }
  });

  socket.on('chat-message', (msg) => {
    const cat = catdergartenCats.get(socket.id);
    if (cat) {
      io.to('catdergarten').emit('chat-message', { name: cat.name, text: msg });
    }
  });

  socket.on('disconnect', () => {
    catdergartenCats.delete(socket.id);
    io.to('catdergarten').emit('cat-left', socket.id);
  });
});

// Catdergarten tick: move cats randomly
setInterval(() => {
  for (const [id, cat] of catdergartenCats) {
    if (cat.targetX !== null) {
      const dx = cat.targetX - cat.x;
      const dy = cat.targetY - cat.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 5) { cat.targetX = null; cat.targetY = null; }
      else { cat.vx = (dx / dist) * 2; cat.vy = (dy / dist) * 2; }
    } else if (Math.random() < 0.02) {
      cat.targetX = 50 + Math.random() * 700;
      cat.targetY = 50 + Math.random() * 500;
    }
    cat.x += cat.vx || 0;
    cat.y += cat.vy || 0;
    cat.vx *= 0.95;
    cat.vy *= 0.95;
    cat.frame += 1;
  }
  if (catdergartenCats.size > 0) {
    io.to('catdergarten').emit('cats-update', Array.from(catdergartenCats.entries()).map(([id, c]) => ({ id, x: c.x, y: c.y, frame: c.frame })));
  }
}, 50);

// ===== START =====
server.listen(PORT, () => {
  console.log(`Meowser server running on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser to play!`);
});
