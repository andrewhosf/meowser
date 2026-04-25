const express = require('express');
const { Pool } = require('pg');
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
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Helper to convert ? placeholders to $1, $2, ...
function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function run(sql, ...params) {
  return pool.query(convertPlaceholders(sql), params);
}

async function get(sql, ...params) {
  const result = await run(sql, ...params);
  return result.rows[0];
}

async function all(sql, ...params) {
  const result = await run(sql, ...params);
  return result.rows;
}

async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      reset_token TEXT,
      reset_expires INTEGER,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())
    );

    CREATE TABLE IF NOT EXISTS cats (
      id SERIAL PRIMARY KEY,
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
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW()),
      game_minutes INTEGER DEFAULT 0,
      game_day INTEGER DEFAULT 1,
      last_game_tick INTEGER DEFAULT 0,
      last_ubi_game_day INTEGER DEFAULT 0,
      game_hour INTEGER DEFAULT 6,
      last_mess_time INTEGER DEFAULT 0,
      morning_bonus_claimed INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      quantity INTEGER DEFAULT 0,
      UNIQUE(user_id, item_type)
    );

    CREATE TABLE IF NOT EXISTS furniture (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      item_type TEXT NOT NULL,
      x INTEGER DEFAULT 0,
      y INTEGER DEFAULT 0,
      room_type TEXT DEFAULT 'home'
    );

    CREATE TABLE IF NOT EXISTS ubi_claims (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      claim_date TEXT NOT NULL,
      amount REAL NOT NULL,
      bonus_percent REAL DEFAULT 0,
      UNIQUE(user_id, claim_date)
    );

    CREATE TABLE IF NOT EXISTS messes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      created_at INTEGER DEFAULT EXTRACT(EPOCH FROM NOW())
    );
  `);

  // Migration: add game time columns if not exist
  async function addColumnIfNotExists(table, col, def) {
    const check = await get(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
      table, col
    );
    if (!check) {
      await run(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    }
  }

  await addColumnIfNotExists('cats', 'game_minutes', 'INTEGER DEFAULT 0');
  await addColumnIfNotExists('cats', 'game_day', 'INTEGER DEFAULT 1');
  await addColumnIfNotExists('cats', 'last_game_tick', 'INTEGER DEFAULT 0');
  await addColumnIfNotExists('cats', 'last_ubi_game_day', 'INTEGER DEFAULT 0');
  await addColumnIfNotExists('cats', 'game_hour', 'INTEGER DEFAULT 6');
  await addColumnIfNotExists('cats', 'last_mess_time', 'INTEGER DEFAULT 0');
  await addColumnIfNotExists('cats', 'morning_bonus_claimed', 'INTEGER DEFAULT 0');
}

initDb().catch(err => {
  console.error('DB init error:', err);
  process.exit(1);
});

// Seed default furniture for new cats
const STARTER_FURNITURE = ['bed', 'couch', 'cat_bed', 'water_bowl', 'food_bowl', 'sandbox', 'tv', 'tv_stand', 'microwave', 'sink', 'table', 'chair1', 'chair2'];
const STARTER_FURNITURE_POS = {
  bed: {x: 40, y: 80},
  couch: {x: 200, y: 60},
  cat_bed: {x: 380, y: 380},
  water_bowl: {x: 500, y: 380},
  food_bowl: {x: 560, y: 380},
  sandbox: {x: 650, y: 60},
  tv: {x: 420, y: 55},
  tv_stand: {x: 415, y: 110},
  microwave: {x: 685, y: 145},
  sink: {x: 685, y: 200},
  table: {x: 500, y: 185},
  chair1: {x: 485, y: 250},
  chair2: {x: 590, y: 250}
};

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

async function updateGameTime(cat) {
  const now = getNow();
  if (!cat.last_game_tick) {
    return { ...cat, game_minutes: cat.game_minutes || 0, game_day: cat.game_day || 1, game_hour: cat.game_hour || 6 };
  }
  const elapsed = now - cat.last_game_tick;
  // Cap at 2 minutes per update to prevent huge jumps
  const capped = Math.min(elapsed, 120);
  // 1 game hour = 12.5 real seconds = 750ms per game minute
  const gameMinutesPassed = Math.floor(capped / 12.5 * 60);
  let newMinutes = (cat.game_minutes || 0) + gameMinutesPassed;
  let newHour = Math.floor((newMinutes % (24 * 60)) / 60);
  let newDay = Math.floor(newMinutes / (24 * 60)) + 1;

  // Reset morning bonus and UBI flags on a new game day
  let morningBonus = cat.morning_bonus_claimed || 0;
  let lastUbiDay = cat.last_ubi_game_day || 0;
  if (newDay > (cat.game_day || 1)) {
    morningBonus = 0;
    lastUbiDay = newDay - 1; // effectively allows claiming on new day
  }
  // Also reset morning bonus whenever we cross into 6am+
  if (newHour >= 6 && (cat.game_hour || 0) < 6) {
    morningBonus = 0;
  }

  await run('UPDATE cats SET game_minutes = ?, game_day = ?, game_hour = ?, last_game_tick = ?, morning_bonus_claimed = ?, last_ubi_game_day = ? WHERE id = ?',
    newMinutes, newDay, newHour, now, morningBonus, lastUbiDay, cat.id);
  return { ...cat, game_minutes: newMinutes, game_day: newDay, game_hour: newHour, last_game_tick: now, morning_bonus_claimed: morningBonus, last_ubi_game_day: lastUbiDay };
}

async function calculateCatStats(cat) {
  const now = getNow();
  const gameMinutes = cat.game_minutes || 0;

  // Game-time-based decay: hunger drops ~10 per game hour, happiness ~5 per game hour
  const gameHoursSinceFed = gameMinutes / 60; // total game hours since start
  // But we track last_fed in real time, so use that for fed calculation
  const realHoursSinceFed = (now - cat.last_fed) / 3600;
  const realHoursSincePetted = (now - cat.last_petted) / 3600;
  const realHoursSincePlayed = (now - cat.last_played) / 3600;

  let hunger = cat.hunger - (realHoursSinceFed * 8);
  let happiness = cat.happiness - (realHoursSinceFed * 2);

  // Hunger affects happiness
  if (hunger < 20) happiness -= 10;
  else if (hunger < 50) happiness -= 3;

  // Social needs affect happiness
  if (realHoursSincePetted > 4) happiness -= 3;
  if (realHoursSincePlayed > 6) happiness -= 3;

  // Messes affect happiness
  const row = await get('SELECT COUNT(*) as c FROM messes WHERE user_id = ?', cat.user_id);
  const messCount = row?.c || 0;
  if (messCount > 0) happiness -= messCount * 3;

  // Cap values
  hunger = Math.max(0, Math.min(100, hunger));
  happiness = Math.max(0, Math.min(100, happiness));

  // Growth stage based on game days
  const gameDays = cat.game_day || 1;
  let stage = 'newborn';
  if (gameDays > 3) stage = 'kitten';
  if (gameDays > 7) stage = 'teen';
  if (gameDays > 14) stage = 'adult';
  if (gameDays > 40) stage = 'elder';

  return { hunger, happiness, growth_stage: stage, age: gameDays - 1, game_day: gameDays, game_hour: cat.game_hour || 6, mess_count: messCount };
}

function getWellCaredBonus(happiness) {
  return happiness >= 70 ? 0.20 : 0;
}

// ===== ACCOUNT RESET (delete and re-register) =====
app.post('/api/auth/account-reset', async (req, res) => {
  const { email } = req.body;
  const user = await get('SELECT * FROM users WHERE email = ?', email);
  if (!user) return res.json({ message: 'If account exists, it has been reset' });

  await run('DELETE FROM cats WHERE user_id = ?', user.id);
  await run('DELETE FROM inventory WHERE user_id = ?', user.id);
  await run('DELETE FROM furniture WHERE user_id = ?', user.id);
  await run('DELETE FROM messes WHERE user_id = ?', user.id);
  await run('DELETE FROM ubi_claims WHERE user_id = ?', user.id);
  await run('DELETE FROM users WHERE id = ?', user.id);

  res.json({ message: 'Account reset. You can now register again with the same email.' });
});
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Email required, password min 6 chars' });
  }
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await run('INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id', email, hash);
    const userId = result.rows[0].id;
    for (const item of STARTER_FURNITURE) {
      const pos = STARTER_FURNITURE_POS[item] || {x: 0, y: 0};
      await run('INSERT INTO furniture (user_id, item_type, x, y) VALUES (?, ?, ?, ?)', userId, item, pos.x, pos.y);
    }
    await run('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, ?)', userId, 'dry_food', 3);
    const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId });
  } catch (e) {
    res.status(400).json({ error: 'Email already registered' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await get('SELECT * FROM users WHERE email = ?', email);
  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ userId: user.id, email }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, userId: user.id });
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await get('SELECT * FROM users WHERE email = ?', email);
  if (!user) return res.json({ message: 'If email exists, reset sent' });

  const token = uuidv4();
  const expires = getNow() + 3600;
  await run('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?', token, expires, user.id);

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
  const user = await get('SELECT * FROM users WHERE reset_token = ?', token);
  if (!user || user.reset_expires < getNow()) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  const hash = await bcrypt.hash(password, 10);
  await run('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = 0 WHERE id = ?', hash, user.id);
  res.json({ message: 'Password updated' });
});

// ===== CAT ROUTES =====
app.get('/api/cat', authMiddleware, async (req, res) => {
  let cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.json({ cat: null });

  // Update game time
  cat = await updateGameTime(cat);

  // Mess generation: only 10-15 min after being fed
  const now = getNow();
  const minsSinceFed = (now - cat.last_fed) / 60;
  const minsSinceLastMess = (now - (cat.last_mess_time || 0)) / 60;
  const row = await get('SELECT COUNT(*) as c FROM messes WHERE user_id = ?', req.user.userId);
  const messCount = row?.c || 0;

  // Only create mess if 10-15 mins after feeding, and at least 5 mins since last mess
  if (messCount < 5 && minsSinceFed >= 10 && minsSinceFed <= 15 && minsSinceLastMess >= 5) {
    if (Math.random() < 0.3) {
      const type = Math.random() < 0.7 ? 'piss' : 'poop';
      // 75% chance in sandbox area, 25% random
      let mx, my;
      if (Math.random() < 0.75) {
        // Sandbox area
        mx = 650 + Math.random() * 80;
        my = 60 + Math.random() * 60;
      } else {
        mx = 80 + Math.random() * 640;
        my = 120 + Math.random() * 320;
      }
      await run('INSERT INTO messes (user_id, type, x, y) VALUES (?, ?, ?, ?)',
        req.user.userId, type, mx, my);
      await run('UPDATE cats SET last_mess_time = ? WHERE id = ?', now, cat.id);
    }
  }

  const stats = await calculateCatStats(cat);
  res.json({ cat: { ...cat, ...stats } });
});

app.post('/api/cat', authMiddleware, async (req, res) => {
  const { name, type, fur_color, eye_color } = req.body;
  const existing = await get('SELECT id FROM cats WHERE user_id = ?', req.user.userId);
  if (existing) return res.status(400).json({ error: 'You already have a cat' });

  const now = getNow();
  const result = await run(
    'INSERT INTO cats (user_id, name, type, fur_color, eye_color, last_fed, last_petted, last_played, last_ubi_claim, last_game_tick, game_minutes, game_day, last_ubi_game_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    req.user.userId, name, type, fur_color, eye_color, now, now, now, now, now, 0, 1, 0
  );

  const cat = await get('SELECT * FROM cats WHERE id = ?', result.rows[0].id);
  res.json({ cat: { ...cat, ...(await calculateCatStats(cat)) } });
});

app.post('/api/cat/feed', authMiddleware, async (req, res) => {
  const { foodType } = req.body;
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Cat is at catdergarten' });

  const foods = {
    dry: { hunger: 15, happiness: 2, cost: 5 },
    wet: { hunger: 30, happiness: 5, cost: 12 },
    wagyu: { hunger: 60, happiness: 25, cost: 50 },
    roadkill: { hunger: 10, happiness: -5, cost: 0 },
    zucchini: { hunger: 20, happiness: 5, cost: 8 },
    tuna: { hunger: 35, happiness: 10, cost: 18 },
    salmon: { hunger: 35, happiness: 12, cost: 22 },
    chicken: { hunger: 40, happiness: 8, cost: 15 },
    shrimp: { hunger: 25, happiness: 15, cost: 20 },
    catnip_treat: { hunger: 5, happiness: 35, cost: 25 },
    sushi: { hunger: 30, happiness: 20, cost: 35 }
  };
  const food = foods[foodType];
  if (!food) return res.status(400).json({ error: 'Unknown food' });

  const inv = await get('SELECT * FROM inventory WHERE user_id = ? AND item_type = ?', req.user.userId, foodType + '_food');
  if (!inv || inv.quantity < 1) {
    return res.status(400).json({ error: `No ${foodType} food in inventory. Visit the shop!` });
  }

  await run('UPDATE inventory SET quantity = quantity - 1 WHERE user_id = ? AND item_type = ?', req.user.userId, foodType + '_food');

  const newHunger = Math.min(100, cat.hunger + food.hunger);
  const newHappiness = Math.min(100, Math.max(0, cat.happiness + food.happiness));
  await run('UPDATE cats SET hunger = ?, happiness = ?, last_fed = ? WHERE id = ?', newHunger, newHappiness, getNow(), cat.id);

  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, message: `Fed ${foodType}! Meow!` });
});

app.post('/api/cat/pet', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const newHappiness = Math.min(100, cat.happiness + 8);
  await run('UPDATE cats SET happiness = ?, last_petted = ? WHERE id = ?', newHappiness, getNow(), cat.id);

  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, message: 'You petted the cat. Meow!' });
});

app.post('/api/cat/play', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Cat is at catdergarten' });

  const newHappiness = Math.min(100, cat.happiness + 12);
  const newHunger = Math.max(0, cat.hunger - 5);
  await run('UPDATE cats SET happiness = ?, hunger = ?, last_played = ? WHERE id = ?', newHappiness, newHunger, getNow(), cat.id);

  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, message: 'You played with the cat! Meow!' });
});

app.post('/api/cat/talk', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const newHappiness = Math.min(100, cat.happiness + 2);
  await run('UPDATE cats SET happiness = ? WHERE id = ?', newHappiness, cat.id);

  const meows = ['Meow!', 'Mrrrow?', 'Purr...', 'Meow meow!', 'Mew!'];
  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, message: meows[Math.floor(Math.random() * meows.length)] });
});

app.post('/api/cat/clean', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const messes = await all('SELECT * FROM messes WHERE user_id = ?', req.user.userId);
  if (messes.length === 0) return res.status(400).json({ error: 'Nothing to clean!' });

  const earnings = messes.length * 1;
  await run('DELETE FROM messes WHERE user_id = ?', req.user.userId);
  await run('UPDATE cats SET total_earnings = total_earnings + ? WHERE id = ?', earnings, cat.id);

  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, earnings, message: `Cleaned up ${messes.length} messes! +$${earnings}` });
});

app.post('/api/cat/reset', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (cat) {
    await run('DELETE FROM cats WHERE user_id = ?', req.user.userId);
    await run('DELETE FROM inventory WHERE user_id = ?', req.user.userId);
    await run('DELETE FROM furniture WHERE user_id = ?', req.user.userId);
    await run('DELETE FROM messes WHERE user_id = ?', req.user.userId);
    await run('DELETE FROM ubi_claims WHERE user_id = ?', req.user.userId);
  }
  // Re-seed starter furniture and items
  const existingFurnRow = await get('SELECT COUNT(*) as c FROM furniture WHERE user_id = ?', req.user.userId);
  if (existingFurnRow.c === 0) {
    for (const item of STARTER_FURNITURE) {
      const pos = STARTER_FURNITURE_POS[item] || {x: 0, y: 0};
      await run('INSERT INTO furniture (user_id, item_type, x, y) VALUES (?, ?, ?, ?)', req.user.userId, item, pos.x, pos.y);
    }
    await run('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, ?)', req.user.userId, 'dry_food', 3);
  }
  res.json({ message: 'Game reset. Adopt a new cat!' });
});

// ===== MESSES =====
app.get('/api/messes', authMiddleware, async (req, res) => {
  const messes = await all('SELECT * FROM messes WHERE user_id = ?', req.user.userId);
  res.json({ messes });
});

app.post('/api/cat/mess', authMiddleware, async (req, res) => {
  const { type, x, y } = req.body;
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const row = await get('SELECT COUNT(*) as c FROM messes WHERE user_id = ?', req.user.userId);
  const messCount = row?.c || 0;
  if (messCount >= 5) return res.status(400).json({ error: 'Too messy!' });

  await run('INSERT INTO messes (user_id, type, x, y) VALUES (?, ?, ?, ?)',
    req.user.userId, type || 'piss', x || 400, y || 300);
  res.json({ message: 'Mess created' });
});

// ===== CATDERGARTEN =====
app.post('/api/catdergarten/send', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });
  if (cat.is_in_catdergarten) return res.status(400).json({ error: 'Already there' });

  await run('UPDATE cats SET is_in_catdergarten = 1, catdergarten_arrived = ? WHERE id = ?', getNow(), cat.id);
  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, message: 'Cat went to catdergarten!' });
});

app.post('/api/catdergarten/return', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat || !cat.is_in_catdergarten) return res.status(400).json({ error: 'Not at catdergarten' });

  const now = getNow();
  const hours = Math.max(0, (now - cat.catdergarten_arrived) / 3600);
  const stats = await calculateCatStats(cat);
  const bonus = getWellCaredBonus(stats.happiness);
  const earnings = Math.floor(hours * 2 * (1 + bonus) * 10) / 10;

  await run('UPDATE cats SET is_in_catdergarten = 0, catdergarten_arrived = 0, total_earnings = total_earnings + ? WHERE id = ?', earnings, cat.id);

  const updated = await get('SELECT * FROM cats WHERE id = ?', cat.id);
  res.json({ cat: { ...updated, ...(await calculateCatStats(updated)) }, earnings, message: `Cat returned! Earned $${earnings.toFixed(1)}` });
});


// ===== FURNITURE POSITION =====
app.post('/api/furniture/move', authMiddleware, async (req, res) => {
  const { furnitureId, x, y } = req.body;
  if (!furnitureId || x == null || y == null) {
    return res.status(400).json({ error: 'furnitureId, x, y required' });
  }
  const furn = await get('SELECT * FROM furniture WHERE id = ? AND user_id = ?', furnitureId, req.user.userId);
  if (!furn) return res.status(404).json({ error: 'Furniture not found' });
  await run('UPDATE furniture SET x = ?, y = ? WHERE id = ?', x, y, furnitureId);
  res.json({ message: 'Moved', x, y });
});
// ===== SHOP & INVENTORY =====
app.get('/api/inventory', authMiddleware, async (req, res) => {
  // Auto-migrate: add missing starter furniture for existing users
  const existingTypes = (await all('SELECT item_type FROM furniture WHERE user_id = ? AND room_type = ?', req.user.userId, 'home')).map(r => r.item_type);
  for (const item of STARTER_FURNITURE) {
    if (!existingTypes.includes(item)) {
      const pos = STARTER_FURNITURE_POS[item] || {x: 0, y: 0};
      await run('INSERT INTO furniture (user_id, item_type, x, y, room_type) VALUES (?, ?, ?, ?, ?)', req.user.userId, item, pos.x, pos.y, 'home');
    }
  }
  const items = await all('SELECT * FROM inventory WHERE user_id = ?', req.user.userId);
  const furn = await all('SELECT * FROM furniture WHERE user_id = ? AND room_type = ?', req.user.userId, 'home');
  const cat = await get('SELECT total_earnings FROM cats WHERE user_id = ?', req.user.userId);
  res.json({ items, furniture: furn, money: cat?.total_earnings || 0 });
});

const SHOP_ITEMS = {
  dry_food: { name: 'Dry Cat Food', cost: 5, type: 'food' },
  wet_food: { name: 'Wet Cat Food', cost: 12, type: 'food' },
  wagyu_food: { name: 'A5 Wagyu', cost: 50, type: 'food' },
  roadkill_food: { name: 'Roadkill', cost: 0, type: 'food' },
  zucchini_food: { name: 'Zucchini', cost: 8, type: 'food' },
  tuna_food: { name: 'Fresh Tuna', cost: 18, type: 'food' },
  salmon_food: { name: 'Wild Salmon', cost: 22, type: 'food' },
  chicken_food: { name: 'Chicken Drumstick', cost: 15, type: 'food' },
  shrimp_food: { name: 'Jumbo Shrimp', cost: 20, type: 'food' },
  catnip_treat_food: { name: 'Catnip Treat', cost: 25, type: 'food' },
  sushi_food: { name: 'Cat Sushi', cost: 35, type: 'food' },
  cat_tree: { name: 'Cat Tree', cost: 80, type: 'furniture' },
  lounger: { name: 'Cat Lounger', cost: 45, type: 'furniture' },
  toy_mouse: { name: 'Toy Mouse', cost: 15, type: 'furniture' },
  scratch_post: { name: 'Scratching Post', cost: 30, type: 'furniture' },
  tv: { name: 'Flatscreen TV', cost: 120, type: 'furniture' },
  tv_stand: { name: 'TV Stand', cost: 60, type: 'furniture' },
  microwave: { name: 'Microwave', cost: 40, type: 'furniture' },
  sink: { name: 'Kitchen Sink', cost: 55, type: 'furniture' },
  table: { name: 'Dining Table', cost: 70, type: 'furniture' },
  chair1: { name: 'Dining Chair', cost: 35, type: 'furniture' },
  chair2: { name: 'Dining Chair', cost: 35, type: 'furniture' }
};

app.post('/api/shop/buy', authMiddleware, async (req, res) => {
  const { itemId } = req.body;
  const item = SHOP_ITEMS[itemId];
  if (!item) return res.status(400).json({ error: 'Unknown item' });

  const cat = await get('SELECT total_earnings FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat || cat.total_earnings < item.cost) return res.status(400).json({ error: 'Not enough money' });

  await run('UPDATE cats SET total_earnings = total_earnings - ? WHERE user_id = ?', item.cost, req.user.userId);

  if (item.type === 'food') {
    await run('INSERT INTO inventory (user_id, item_type, quantity) VALUES (?, ?, 1) ON CONFLICT(user_id, item_type) DO UPDATE SET quantity = inventory.quantity + 1', req.user.userId, itemId);
  } else {
    await run('INSERT INTO furniture (user_id, item_type, room_type) VALUES (?, ?, ?)', req.user.userId, itemId, 'home');
  }

  res.json({ message: `Bought ${item.name}!`, money: cat.total_earnings - item.cost });
});

// ===== UBI / CATSTREAM (per game day) =====
app.get('/api/ubi/claim', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const updatedCat = await updateGameTime(cat);
  const currentGameDay = updatedCat.game_day || 1;
  const lastClaimDay = updatedCat.last_ubi_game_day || 0;

  if (currentGameDay <= lastClaimDay) {
    return res.status(400).json({ error: 'Already claimed this game day' });
  }

  const stats = await calculateCatStats(updatedCat);
  const bonus = getWellCaredBonus(stats.happiness);
  const baseAmount = 20;
  const totalAmount = Math.floor(baseAmount * (1 + bonus) * 100) / 100;

  await run('UPDATE cats SET total_earnings = total_earnings + ?, last_ubi_game_day = ? WHERE id = ?',
    totalAmount, currentGameDay, updatedCat.id);

  const refreshed = await get('SELECT * FROM cats WHERE id = ?', updatedCat.id);
  res.json({ amount: totalAmount, bonus: bonus * 100, cat: { ...refreshed, ...(await calculateCatStats(refreshed)) } });
});

app.get('/api/ubi/status', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.json({ claimedToday: false, amount: null });

  const updatedCat = await updateGameTime(cat);
  const currentGameDay = updatedCat.game_day || 1;
  const lastClaimDay = updatedCat.last_ubi_game_day || 0;
  const gameHour = updatedCat.game_hour || 6;

  res.json({ claimedToday: currentGameDay <= lastClaimDay, amount: null, gameDay: currentGameDay, gameHour, morningBonus: updatedCat.morning_bonus_claimed || 0 });
});

// Morning bonus at 6am
app.get('/api/morning-bonus', authMiddleware, async (req, res) => {
  const cat = await get('SELECT * FROM cats WHERE user_id = ?', req.user.userId);
  if (!cat) return res.status(404).json({ error: 'No cat' });

  const updatedCat = await updateGameTime(cat);
  const gameHour = updatedCat.game_hour || 6;
  const morningBonus = updatedCat.morning_bonus_claimed || 0;

  if (gameHour < 6 || gameHour > 8) {
    return res.status(400).json({ error: 'Morning bonus only available between 6am and 8am!' });
  }
  if (morningBonus) {
    return res.status(400).json({ error: 'Already claimed morning bonus today!' });
  }

  const bonusAmount = 50;
  await run('UPDATE cats SET total_earnings = total_earnings + ?, morning_bonus_claimed = 1 WHERE id = ?', bonusAmount, updatedCat.id);
  const refreshed = await get('SELECT * FROM cats WHERE id = ?', updatedCat.id);
  res.json({ amount: bonusAmount, cat: { ...refreshed, ...(await calculateCatStats(refreshed)) } });
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
