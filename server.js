'use strict';
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const XLSX     = require('xlsx');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'hotel-hk-secret-CHANGE-IN-PRODUCTION';

// ── DATABASE ────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// ── MIDDLEWARE ──────────────────────────────────────────
app.use(express.json({ limit: '50mb' })); // allow large base64 photos
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH MIDDLEWARE ─────────────────────────────────────
function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session — please log in again' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Forbidden' });
    next();
  };
}

// ── SEED DATA ───────────────────────────────────────────
const AREAS_META = [
  { id: 'a1',  name: 'Green Courtyard',     icon: '🌿', linked_room: null },
  { id: 'a2',  name: 'Blue Courtyard',      icon: '💙', linked_room: null },
  { id: 'a3',  name: 'Breakfast Area',      icon: '☕', linked_room: null },
  { id: 'a4',  name: 'Front Terrace',       icon: '🌅', linked_room: null },
  { id: 'a5',  name: 'Room 3 Terrace',      icon: '🪴', linked_room: 3  },
  { id: 'a6',  name: 'Room 4 Terrace',      icon: '🪴', linked_room: 4  },
  { id: 'a7',  name: 'Balcony (Rms 10–11)', icon: '🌬️', linked_room: null },
  { id: 'a8',  name: 'Guest Toilet',        icon: '🚻', linked_room: null },
  { id: 'a9',  name: 'Stock Room 47',       icon: '📦', linked_room: null },
  { id: 'a10', name: 'Housekeeping Room',   icon: '🧺', linked_room: null },
  { id: 'a11', name: 'Windows',             icon: '🪟', linked_room: null },
  { id: 'a12', name: 'Courtyard Stairs',    icon: '🪜', linked_room: null },
  { id: 'a13', name: 'Fountain',            icon: '⛲', linked_room: null },
  { id: 'a14', name: 'Water Plants',        icon: '💧', linked_room: null },
  { id: 'a15', name: 'Water Plants Rm 3&4 Terrace', icon: '🌱', linked_room: null },
  { id: 'a16', name: 'Other',                       icon: '📍', linked_room: null },
];

const DEFAULT_USERS = [
  { id: 'u1', username: 'admin',        password: 'admin123', role: 'admin',       name: 'Admin'  },
  { id: 'u2', username: 'reception1',   password: 'pass123',  role: 'reception',   name: 'Sarah'  },
  { id: 'u3', username: 'reception2',   password: 'pass123',  role: 'reception',   name: 'Mark'   },
  { id: 'u4', username: 'hk1',          password: 'pass123',  role: 'housekeeper', name: 'Maria'  },
  { id: 'u5', username: 'hk2',          password: 'pass123',  role: 'housekeeper', name: 'Anna'   },
  { id: 'u6', username: 'hk3',          password: 'pass123',  role: 'housekeeper', name: 'Sofia'  },
  { id: 'u7', username: 'maintenance',  password: 'pass123',  role: 'maintenance', name: 'John'   },
  { id: 'u8', username: 'moses',        password: 'pass123',  role: 'housekeeper', name: 'Moses'  },
];

// ── DATABASE INIT ───────────────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        username    TEXT UNIQUE NOT NULL,
        password    TEXT NOT NULL,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id             INTEGER PRIMARY KEY,
        status         TEXT NOT NULL DEFAULT 'dirty',
        assigned_to    TEXT,
        cleaning_start BIGINT,
        cleaning_end   BIGINT,
        notes          TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS areas (
        id             TEXT PRIMARY KEY,
        name           TEXT NOT NULL,
        icon           TEXT DEFAULT '🏞',
        linked_room    INTEGER,
        status         TEXT NOT NULL DEFAULT 'dirty',
        assigned_to    TEXT,
        cleaning_start BIGINT,
        cleaning_end   BIGINT,
        notes          TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS photos (
        id          TEXT PRIMARY KEY,
        item_type   TEXT NOT NULL,
        item_id     TEXT NOT NULL,
        data        TEXT NOT NULL,
        uploaded_by TEXT,
        uploaded_at BIGINT,
        caption     TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS issues (
        id           TEXT PRIMARY KEY,
        item_type    TEXT NOT NULL,
        item_id      TEXT NOT NULL,
        description  TEXT NOT NULL,
        reported_by  TEXT,
        reported_at  BIGINT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'open',
        resolved_at  BIGINT,
        resolve_note TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS cleaning_logs (
        id          TEXT PRIMARY KEY,
        item_type   TEXT NOT NULL,
        item_id     TEXT NOT NULL,
        item_name   TEXT NOT NULL,
        cleaned_by  TEXT,
        started_at  BIGINT,
        ended_at    BIGINT NOT NULL,
        duration_ms BIGINT
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS supplies (
        id           TEXT PRIMARY KEY,
        description  TEXT NOT NULL,
        requested_by TEXT,
        requested_at BIGINT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'needed'
      );

      CREATE TABLE IF NOT EXISTS stocktakes (
        id           TEXT PRIMARY KEY,
        type         TEXT NOT NULL,
        date         TEXT NOT NULL,
        conducted_by TEXT DEFAULT '',
        checked_by   TEXT DEFAULT '',
        created_at   BIGINT NOT NULL,
        completed    INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS stocktake_items (
        id             TEXT PRIMARY KEY,
        stocktake_id   TEXT NOT NULL,
        category       TEXT NOT NULL,
        item_name      TEXT NOT NULL,
        unit           TEXT DEFAULT 'pcs',
        fields         TEXT DEFAULT 'linen',
        opening_stock  TEXT DEFAULT '',
        in_rooms       TEXT DEFAULT '',
        at_laundry     TEXT DEFAULT '',
        in_storeroom   TEXT DEFAULT '',
        damaged        TEXT DEFAULT '',
        closing_stock  TEXT DEFAULT '',
        notes          TEXT DEFAULT ''
      );
    `);

    // Migration: add notes column to cleaning_logs for existing DBs
    await client.query(`ALTER TABLE cleaning_logs ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''`);

    // Seed initial stock-take reference from September 2026 (opening stock for Oct 2026)
    const seedCheck = await client.query(`SELECT id FROM stocktakes WHERE id='sept2026-seed'`);
    if (!seedCheck.rows.length) {
      await client.query(
        `INSERT INTO stocktakes (id,type,date,conducted_by,checked_by,created_at,completed)
         VALUES ('sept2026-seed','monthly','2026-09-30','Marthe','',${Date.now()},1)`
      );
      const seedItems = [
        ['Guest Amenities','Shower Gel','pcs','amenity','1','','','','','1'],
        ['Guest Amenities','Conditioner / Shampoo','pcs','amenity','2','','','','','2'],
        ['Guest Amenities','Handwash','pcs','amenity','5','','','','','5'],
        ['Guest Amenities','Lotion','pcs','amenity','10','','','','','10'],
        ['Linen – Towels','Bath Towel','pcs','linen','47','26','18','','3','47'],
        ['Linen – Towels','Hand Towel','pcs','linen','42','26','15','','1','42'],
        ['Linen – Towels','Bath Mat','pcs','linen','21','13','7','','1','21'],
        ['Linen – Duvet Inners','Super King Duvet Inner','pcs','linen','3','2','','1','','3'],
        ['Linen – Duvet Inners','King Duvet Inner','pcs','linen','10','3','','2','','5'],
        ['Linen – Duvet Inners','Queen Duvet Inner','pcs','linen','3','8','','1','','9'],
        ['Linen – Duvet Inners','Double Duvet Inner','pcs','linen','1','0','','1','','1'],
        ['Linen – Duvet Inners','Single Duvet Inner','pcs','linen','8','','','','',''],
        ['Linen – Duvet Covers','Super King Duvet Cover','pcs','linen','3','2','1','','1','4'],
        ['Linen – Duvet Covers','King Duvet Cover','pcs','linen','15','7','6','','2','15'],
        ['Linen – Duvet Covers','Queen Duvet Cover','pcs','linen','14','4','2','','6','12'],
        ['Linen – Duvet Covers','Single Duvet Cover','pcs','linen','8','0','8','','','8'],
        ['Linen – Fitted Sheets','Super King Fitted Sheet','pcs','linen','4','2','1','','1','4'],
        ['Linen – Fitted Sheets','King Fitted Sheet','pcs','linen','2','1','1','','','2'],
        ['Linen – Fitted Sheets','Queen Fitted Sheet','pcs','linen','15','8','7','','','15'],
        ['Linen – Fitted Sheets','Double Fitted Sheet','pcs','linen','2','2','0','','','2'],
        ['Linen – Fitted Sheets','Single Fitted Sheet','pcs','linen','1','0','0','1','','1'],
        ['Linen – Mattress Protectors','Super King Mattress Protector','pcs','linen','4','2','','2','',''],
        ['Linen – Mattress Protectors','Queen Mattress Protector','pcs','linen','11','8','','3','','11'],
        ['Linen – Mattress Protectors','Double Mattress Protector','pcs','linen','3','2','','1','','3'],
        ['Linen – Pillows & Cases','Continental Pillow Case','pcs','linen','33','24','5','','4','33'],
        ['Linen – Pillows & Cases','Standard Pillow Case','pcs','linen','48','28','12','','7','47'],
        ['Linen – Pillows & Cases','Continental Pillow Protector','pcs','linen','0','0','','','','0'],
        ['Linen – Pillows & Cases','Standard Pillow Protector','pcs','linen','30','28','','2','','30'],
        ['Linen – Pillows & Cases','Standard Pillow','pcs','linen','','28','','','',''],
        ['Linen – Pillows & Cases','Continental Pillow','pcs','linen','','24','','','',''],
        ['Pool & Other Linen','Pool Towels','pcs','linen','10','','6','11','17',''],
        ['Pool & Other Linen','Maroon Fleece','pcs','linen','3','','','3','','3'],
        ['Pool & Other Linen','New Small Fleeces','pcs','linen','8','','','7','','8'],
        ['Pool & Other Linen','Laundry Bags','pcs','linen','9','','','9','',''],
        ['Stationery','White Bin Bags','pcs','store','','','','0','',''],
        ['Stationery','White Bin Liners','pcs','store','','','','0','',''],
        ['Stationery','White Note Books','pcs','store','','','','','',''],
        ['Stationery','Pencils','pcs','store','','','','2','',''],
        ['Stationery','Toilet Roll Stickers','pcs','store','','','','1197','',''],
        ['Stationery','Welcome Cards','pcs','store','','','','180','',''],
        ['Other','Umbrellas','pcs','store','','','','9','',''],
        ['Chemicals','Chop Chop','btl','store','','','','3','',''],
        ['Chemicals','Steri','btl','store','','','','4.5','',''],
        ['Chemicals','Window Clean','btl','store','','','','6','',''],
        ['Chemicals','Ordorex','btl','store','','','','4','',''],
        ['Equipment','Iron','pcs','store','','','','2','',''],
        ['Equipment','Ironing Board','pcs','store','','','','2','',''],
        ['Coffee & Tea Station','Coffee Machines','pcs','store','','','','5','',''],
        ['Coffee & Tea Station','Cups','pcs','store','','','','187','',''],
        ['Coffee & Tea Station','Lids','pcs','store','','','','231','',''],
        ['Coffee & Tea Station','Stirrers','kg','store','','','','0.625','',''],
        ['Coffee & Tea Station','Sugar Sachets','kg','store','','','','3.45','',''],
        ['Coffee & Tea Station','Sweetener Sachets','kg','store','','','','1.095','',''],
        ['Coffee & Tea Station','Milk Pods','pcs','store','','','','85','',''],
        ['Coffee & Tea Station','Coffee – Decaf','pcs','store','','','','92','',''],
        ['Coffee & Tea Station','Coffee – House Brand','pcs','store','','','','23','',''],
        ['Coffee & Tea Station','Cleaning Pods','pcs','store','','','','27','',''],
        ['Coffee & Tea Station','Display Boxes','pcs','store','','','','5','',''],
        ['Coffee & Tea Station','Earl Grey','pcs','store','','','','14','',''],
        ['Coffee & Tea Station','English Breakfast Tea','pcs','store','','','','21','',''],
        ['Coffee & Tea Station','Chamomile','pcs','store','','','','','',''],
      ];
      for (const [cat,name,unit,fields,opening,rooms,laundry,storeroom,damaged,closing] of seedItems) {
        await client.query(
          `INSERT INTO stocktake_items (id,stocktake_id,category,item_name,unit,fields,opening_stock,in_rooms,at_laundry,in_storeroom,damaged,closing_stock)
           VALUES ($1,'sept2026-seed',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [uid(), cat, name, unit, fields, opening, rooms, laundry, storeroom, damaged, closing]
        );
      }
      console.log('✅ Seeded September 2026 stock-take reference data');
    }

    // Admin (u1): always ensure password is correct so admin can always log in
    // All other default users: only insert if they don't exist — never overwrite staff passwords
    for (const u of DEFAULT_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      if (u.id === 'u1') {
        // Admin: upsert password only (never changes username/name/role)
        await client.query(
          `INSERT INTO users (id,username,password,name,role) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (id) DO UPDATE SET password=EXCLUDED.password`,
          [u.id, u.username, hash, u.name, u.role]
        );
      } else {
        // Staff: only insert if this user ID doesn't exist yet
        const exists = await client.query('SELECT 1 FROM users WHERE id=$1 LIMIT 1', [u.id]);
        if (exists.rows.length === 0) {
          await client.query(
            'INSERT INTO users (id,username,password,name,role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
            [u.id, u.username, hash, u.name, u.role]
          );
        }
      }
    }
    console.log('✅ User accounts checked (admin password ensured; staff accounts untouched)');

    // Seed rooms if empty
    const { rowCount: rc } = await client.query('SELECT 1 FROM rooms LIMIT 1');
    if (rc === 0) {
      for (let i = 1; i <= 13; i++) {
        await client.query('INSERT INTO rooms (id) VALUES ($1) ON CONFLICT DO NOTHING', [i]);
      }
      console.log('✅ Seeded 13 rooms');
    }

    // Seed areas if empty
    const { rowCount: ac } = await client.query('SELECT 1 FROM areas LIMIT 1');
    if (ac === 0) {
      for (const a of AREAS_META) {
        await client.query(
          'INSERT INTO areas (id,name,icon,linked_room) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [a.id, a.name, a.icon, a.linked_room]
        );
      }
      console.log('✅ Seeded common areas');
    } else {
      // Ensure any new areas added to AREAS_META get inserted into existing DBs
      for (const a of AREAS_META) {
        await client.query(
          'INSERT INTO areas (id,name,icon,linked_room) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING',
          [a.id, a.name, a.icon, a.linked_room]
        );
      }
    }

    // Run daily reset if it hasn't run yet today (handles Render spin-down)
    await runDailyResetIfNeeded(client);

    console.log('🏨 Database ready');
  } finally {
    client.release();
  }
}

async function runDailyResetIfNeeded(client) {
  const todayUTC = new Date().toISOString().slice(0, 10); // e.g. "2026-08-20"
  const res = await client.query(`SELECT value FROM settings WHERE key='last_reset_date'`);
  const lastReset = res.rows[0]?.value || '';
  if (lastReset === todayUTC) {
    console.log(`✅ Daily reset already ran today (${todayUTC})`);
    return;
  }
  await client.query(`UPDATE rooms SET status='dirty', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL, notes=''`);
  await client.query(`UPDATE areas SET status='dirty', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL, notes=''`);
  const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
  await client.query(`DELETE FROM photos WHERE item_type IN ('room','area') AND uploaded_at < $1`, [fourteenDaysAgo]);
  await client.query(
    `INSERT INTO settings (key,value) VALUES ('last_reset_date',$1)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [todayUTC]
  );
  console.log(`🔄 Daily reset done for ${todayUTC} — rooms, areas cleared; photos older than 14 days deleted`);
}

// ── HELPERS ─────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// Parse assigned_to — stored as JSON array string, but handle legacy single-ID strings
function parseAssignedTo(val) {
  if (!val) return [];
  try {
    const p = JSON.parse(val);
    return Array.isArray(p) ? p : [p];
  } catch {
    return val ? [val] : [];
  }
}

function mapPhoto(p) {
  return {
    id: p.id, data: p.data,
    uploadedBy: p.uploaded_by,
    timestamp:  p.uploaded_at ? Number(p.uploaded_at) : null,
    caption:    p.caption || '',
  };
}

function mapIssue(i) {
  return {
    id:          i.id,
    description: i.description,
    reportedBy:  i.reported_by,
    reportedAt:  i.reported_at ? Number(i.reported_at) : null,
    status:      i.status,
    resolvedAt:  i.resolved_at ? Number(i.resolved_at) : null,
    resolveNote: i.resolve_note || '',
  };
}

async function getFullState() {
  const [roomsRes, areasRes, issuesRes] = await Promise.all([
    pool.query('SELECT * FROM rooms ORDER BY id'),
    pool.query('SELECT * FROM areas ORDER BY id'),
    pool.query('SELECT * FROM issues ORDER BY reported_at'),
  ]);

  const rooms = roomsRes.rows.map(r => ({
    id:            r.id,
    status:        r.status,
    assignedTo:    parseAssignedTo(r.assigned_to),
    cleaningStart: r.cleaning_start ? Number(r.cleaning_start) : null,
    cleaningEnd:   r.cleaning_end   ? Number(r.cleaning_end)   : null,
    notes:         r.notes || '',
    minibarPhotos: [],  // loaded on demand via /api/photos/:itemType/:itemId
    maintenanceIssues: issuesRes.rows.filter(i => i.item_type === 'room' && i.item_id === String(r.id)).map(mapIssue),
  }));

  const areas = areasRes.rows.map(a => ({
    id:            a.id,
    name:          a.name,
    icon:          a.icon,
    linkedRoom:    a.linked_room || null,
    status:        a.status,
    assignedTo:    parseAssignedTo(a.assigned_to),
    cleaningStart: a.cleaning_start ? Number(a.cleaning_start) : null,
    cleaningEnd:   a.cleaning_end   ? Number(a.cleaning_end)   : null,
    notes:         a.notes || '',
    photos:        [],  // loaded on demand via /api/photos/:itemType/:itemId
    maintenanceIssues: issuesRes.rows.filter(i => i.item_type === 'area' && i.item_id === a.id).map(mapIssue),
  }));

  return { rooms, areas };
}

// Photos on demand — room/area photos reset at 2am daily (same as status/assignments)
app.get('/api/photos/:itemType/:itemId', auth, async (req, res) => {
  try {
    const { itemType, itemId } = req.params;
    const now = new Date();
    const last2am = new Date(now);
    last2am.setUTCHours(2, 0, 0, 0);
    if (last2am > now) last2am.setUTCDate(last2am.getUTCDate() - 1);
    const since2am = last2am.getTime();
    const result = await pool.query(
      'SELECT * FROM photos WHERE item_type=$1 AND item_id=$2 AND uploaded_at >= $3 ORDER BY uploaded_at',
      [itemType, String(itemId), since2am]
    );
    res.json(result.rows.map(mapPhoto));
  } catch (e) {
    console.error('Photos error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── DAILY RESET AT 2 AM UTC ─────────────────────────────
function scheduleDailyReset() {
  const now = new Date();
  const next2am = new Date(now);
  next2am.setUTCHours(2, 0, 0, 0);
  if (next2am <= now) next2am.setUTCDate(next2am.getUTCDate() + 1);
  const msUntil = next2am - now;
  console.log(`⏰ Daily reset scheduled in ${Math.round(msUntil / 60000)} min (at 2 AM UTC)`);
  setTimeout(async () => {
    try {
      const todayUTC = new Date().toISOString().slice(0, 10);
      await pool.query(`UPDATE rooms SET status='dirty', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL, notes=''`);
      await pool.query(`UPDATE areas SET status='dirty', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL, notes=''`);
      const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
      await pool.query(`DELETE FROM photos WHERE item_type IN ('room','area') AND uploaded_at < $1`, [fourteenDaysAgo]);
      await pool.query(
        `INSERT INTO settings (key,value) VALUES ('last_reset_date',$1)
         ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
        [todayUTC]
      );
      console.log('🔄 Daily reset done — rooms, areas cleared; photos older than 14 days deleted');
    } catch (e) {
      console.error('❌ Daily reset error:', e);
    }
    scheduleDailyReset(); // reschedule for next day
  }, msUntil);
}

// ── ROUTES ──────────────────────────────────────────────

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: 'Username and password required' });

    const result = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    const user   = result.rows[0];
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign(
      { id: user.id, role: user.role, name: user.name, username: user.username },
      JWT_SECRET,
      { expiresIn: '12h' }
    );
    res.json({ token, user: { id: user.id, name: user.name, role: user.role, username: user.username } });
  } catch (e) {
    console.error('Login error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Full state (rooms + areas + public user list + other issues)
app.get('/api/state', auth, async (req, res) => {
  try {
    const { rooms, areas } = await getFullState();
    const [usersRes, otherIssuesRes, suppliesRes] = await Promise.all([
      pool.query('SELECT id, name, role, username FROM users ORDER BY role, name'),
      pool.query(
        `SELECT i.*, u.name AS reporter_name FROM issues i
         LEFT JOIN users u ON u.id = i.reported_by
         WHERE i.item_type='other' ORDER BY i.reported_at`
      ),
      pool.query(
        `SELECT s.*, u.name AS requester_name FROM supplies s
         LEFT JOIN users u ON u.id = s.requested_by
         ORDER BY s.requested_at`
      ),
    ]);
    const otherIssues = otherIssuesRes.rows.map(i => ({
      ...mapIssue(i),
      locationName: i.item_id,
    }));
    const supplies = suppliesRes.rows.map(s => ({
      id:          s.id,
      description: s.description,
      requestedBy: s.requester_name || s.requested_by,
      requestedAt: Number(s.requested_at),
      status:      s.status,
    }));
    res.json({ rooms, areas, users: usersRes.rows, otherIssues, supplies });
  } catch (e) {
    console.error('State error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update room
app.patch('/api/rooms/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, assignedTo, notes, cleaningStart, cleaningEnd } = req.body;
    // Fetch current row BEFORE update so we get cleaning_start
    let prevRow = null;
    if (cleaningEnd) {
      const cur = await pool.query('SELECT cleaning_start, assigned_to, notes FROM rooms WHERE id=$1', [id]);
      prevRow = cur.rows[0] || null;
    }
    const parts = [], vals = [];
    let n = 1;
    if (status        !== undefined) { parts.push(`status=$${n++}`);         vals.push(status); }
    if (assignedTo    !== undefined) {
      parts.push(`assigned_to=$${n++}`);
      // Store array as JSON string; null/empty means unassigned
      const arr = Array.isArray(assignedTo) ? assignedTo : (assignedTo ? [assignedTo] : []);
      vals.push(arr.length ? JSON.stringify(arr) : null);
    }
    if (notes         !== undefined) { parts.push(`notes=$${n++}`);          vals.push(notes); }
    if (cleaningStart !== undefined) { parts.push(`cleaning_start=$${n++}`); vals.push(cleaningStart); }
    if (cleaningEnd   !== undefined) { parts.push(`cleaning_end=$${n++}`);   vals.push(cleaningEnd); }
    if (!parts.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id);
    await pool.query(`UPDATE rooms SET ${parts.join(',')} WHERE id=$${n}`, vals);
    // Log completed cleaning session
    if (cleaningEnd) {
      const start = prevRow?.cleaning_start ? Number(prevRow.cleaning_start) : null;
      const who   = req.user.id; // person who triggered the end
      await pool.query(
        'INSERT INTO cleaning_logs (id,item_type,item_id,item_name,cleaned_by,started_at,ended_at,duration_ms,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [uid(), 'room', String(id), `Room ${id}`, who, start, cleaningEnd, start ? cleaningEnd - start : null, prevRow?.notes || '']
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Room update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update area
app.patch('/api/areas/:id', auth, async (req, res) => {
  try {
    const id = req.params.id;
    const { status, assignedTo, notes, cleaningStart, cleaningEnd } = req.body;
    // Fetch current row BEFORE update so we get cleaning_start
    let prevRow = null;
    if (cleaningEnd) {
      const cur = await pool.query('SELECT cleaning_start, assigned_to, name, notes FROM areas WHERE id=$1', [id]);
      prevRow = cur.rows[0] || null;
    }
    const parts = [], vals = [];
    let n = 1;
    if (status        !== undefined) { parts.push(`status=$${n++}`);         vals.push(status); }
    if (assignedTo    !== undefined) {
      parts.push(`assigned_to=$${n++}`);
      const arr = Array.isArray(assignedTo) ? assignedTo : (assignedTo ? [assignedTo] : []);
      vals.push(arr.length ? JSON.stringify(arr) : null);
    }
    if (notes         !== undefined) { parts.push(`notes=$${n++}`);          vals.push(notes); }
    if (cleaningStart !== undefined) { parts.push(`cleaning_start=$${n++}`); vals.push(cleaningStart); }
    if (cleaningEnd   !== undefined) { parts.push(`cleaning_end=$${n++}`);   vals.push(cleaningEnd); }
    if (!parts.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(id);
    await pool.query(`UPDATE areas SET ${parts.join(',')} WHERE id=$${n}`, vals);
    // Log completed cleaning session
    if (cleaningEnd) {
      const start    = prevRow?.cleaning_start ? Number(prevRow.cleaning_start) : null;
      const who      = req.user.id; // person who triggered the end
      const areaName = prevRow?.name || id;
      await pool.query(
        'INSERT INTO cleaning_logs (id,item_type,item_id,item_name,cleaned_by,started_at,ended_at,duration_ms,notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [uid(), 'area', id, areaName, who, start, cleaningEnd, start ? cleaningEnd - start : null, prevRow?.notes || '']
      );
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('Area update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Add photo
app.post('/api/photos', auth, async (req, res) => {
  try {
    const { itemType, itemId, data, caption } = req.body;
    if (!itemType || !itemId || !data)
      return res.status(400).json({ error: 'itemType, itemId, and data required' });
    const id = uid();
    await pool.query(
      'INSERT INTO photos (id,item_type,item_id,data,uploaded_by,uploaded_at,caption) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [id, itemType, String(itemId), data, req.user.id, Date.now(), caption || '']
    );
    res.json({ id });
  } catch (e) {
    console.error('Photo upload error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete photo
app.delete('/api/photos/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM photos WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Add issue
app.post('/api/issues', auth, async (req, res) => {
  try {
    const { itemType, itemId, description } = req.body;
    if (!itemType || !itemId || !description)
      return res.status(400).json({ error: 'itemType, itemId, and description required' });
    const id = uid();
    await pool.query(
      'INSERT INTO issues (id,item_type,item_id,description,reported_by,reported_at) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, itemType, String(itemId), description, req.user.id, Date.now()]
    );
    res.json({ id });
  } catch (e) {
    console.error('Issue error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update issue (status / resolve)
app.patch('/api/issues/:id', auth, async (req, res) => {
  try {
    const { status, resolveNote } = req.body;
    const parts = [], vals = [];
    let n = 1;
    if (status !== undefined) {
      parts.push(`status=$${n++}`); vals.push(status);
      if (status === 'resolved') { parts.push(`resolved_at=$${n++}`); vals.push(Date.now()); }
    }
    if (resolveNote !== undefined) { parts.push(`resolve_note=$${n++}`); vals.push(resolveNote); }
    if (!parts.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await pool.query(`UPDATE issues SET ${parts.join(',')} WHERE id=$${n}`, vals);
    res.json({ ok: true });
  } catch (e) {
    console.error('Issue update error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── USER MANAGEMENT (admin only) ────────────────────────

app.get('/api/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT id,username,name,role FROM users ORDER BY role,name');
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', auth, requireRole('admin'), async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !username || !password || !role)
      return res.status(400).json({ error: 'All fields required' });
    const hash = await bcrypt.hash(password, 10);
    const id   = uid();
    await pool.query(
      'INSERT INTO users (id,username,password,name,role) VALUES ($1,$2,$3,$4,$5)',
      [id, username, hash, name, role]
    );
    res.json({ id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error('Create user error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    const parts = [], vals = [];
    let n = 1;
    if (name)     { parts.push(`name=$${n++}`);     vals.push(name); }
    if (username) { parts.push(`username=$${n++}`); vals.push(username); }
    if (password) { parts.push(`password=$${n++}`); vals.push(await bcrypt.hash(password, 10)); }
    if (role)     { parts.push(`role=$${n++}`);     vals.push(role); }
    if (!parts.length) return res.status(400).json({ error: 'Nothing to update' });
    vals.push(req.params.id);
    await pool.query(`UPDATE users SET ${parts.join(',')} WHERE id=$${n}`, vals);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Username already taken' });
    console.error('Update user error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/users/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query('UPDATE rooms SET assigned_to=NULL WHERE assigned_to=$1', [id]);
    await pool.query('UPDATE areas SET assigned_to=NULL WHERE assigned_to=$1', [id]);
    await pool.query('DELETE FROM users WHERE id=$1', [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── HISTORY ─────────────────────────────────────────────
// GET /api/history?date=YYYY-MM-DD  (defaults to today)
app.get('/api/history', auth, async (req, res) => {
  try {
    // Parse requested date (UTC day boundaries)
    const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00.000Z').getTime();
    const dayEnd   = new Date(dateStr + 'T23:59:59.999Z').getTime();

    // Cleaning logs for the day
    const logsRes = await pool.query(
      'SELECT l.*, u.name AS cleaner_name FROM cleaning_logs l LEFT JOIN users u ON u.id = l.cleaned_by WHERE l.ended_at >= $1 AND l.ended_at <= $2 ORDER BY l.ended_at',
      [dayStart, dayEnd]
    );

    // Photos uploaded that day
    const photosRes = await pool.query(
      'SELECT p.*, u.name AS uploader_name FROM photos p LEFT JOIN users u ON u.id = p.uploaded_by WHERE p.uploaded_at >= $1 AND p.uploaded_at <= $2 ORDER BY p.uploaded_at',
      [dayStart, dayEnd]
    );

    // Maintenance issues resolved that day
    const resolvedIssuesRes = await pool.query(
      `SELECT i.*, u.name AS reporter_name
       FROM issues i
       LEFT JOIN users u ON u.id = i.reported_by
       WHERE i.resolved_at >= $1 AND i.resolved_at <= $2
       ORDER BY i.resolved_at`,
      [dayStart, dayEnd]
    );

    // All open issues (for the full issue history list, not date-filtered)
    const allIssuesRes = await pool.query(
      `SELECT i.*, u.name AS reporter_name
       FROM issues i
       LEFT JOIN users u ON u.id = i.reported_by
       ORDER BY i.reported_at DESC`,
      []
    );

    const logs = logsRes.rows.map(l => ({
      id:          l.id,
      itemType:    l.item_type,
      itemId:      l.item_id,
      itemName:    l.item_name,
      cleanedBy:   l.cleaner_name || l.cleaned_by,
      startedAt:   l.started_at ? Number(l.started_at) : null,
      endedAt:     Number(l.ended_at),
      durationMs:  l.duration_ms ? Number(l.duration_ms) : null,
      notes:       l.notes || '',
    }));

    const photos = photosRes.rows.map(p => ({
      id:         p.id,
      itemType:   p.item_type,
      itemId:     p.item_id,
      data:       p.data,
      caption:    p.caption || '',
      uploadedBy: p.uploader_name || p.uploaded_by,
      uploadedAt: p.uploaded_at ? Number(p.uploaded_at) : null,
    }));

    const resolvedIssues = resolvedIssuesRes.rows.map(i => ({
      id:          i.id,
      itemType:    i.item_type,
      itemId:      i.item_id,
      description: i.description,
      reportedBy:  i.reporter_name || i.reported_by,
      reportedAt:  i.reported_at ? Number(i.reported_at) : null,
      resolvedAt:  i.resolved_at ? Number(i.resolved_at) : null,
      resolveNote: i.resolve_note || '',
      status:      i.status,
    }));

    const allIssues = allIssuesRes.rows.map(i => ({
      id:          i.id,
      itemType:    i.item_type,
      itemId:      i.item_id,
      description: i.description,
      reportedBy:  i.reporter_name || i.reported_by,
      reportedAt:  i.reported_at ? Number(i.reported_at) : null,
      resolvedAt:  i.resolved_at ? Number(i.resolved_at) : null,
      resolveNote: i.resolve_note || '',
      status:      i.status,
    }));

    res.json({ date: dateStr, logs, photos, resolvedIssues, allIssues });
  } catch (e) {
    console.error('History error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// Clear all cleaning logs (admin only)
app.delete('/api/admin/cleaning-logs', auth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query('DELETE FROM cleaning_logs');
    res.json({ ok: true });
  } catch (e) {
    console.error('Clear logs error:', e);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── SUPPLIES ─────────────────────────────────────────────
app.post('/api/supplies', auth, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description) return res.status(400).json({ error: 'Description required' });
    const id = uid();
    await pool.query(
      'INSERT INTO supplies (id,description,requested_by,requested_at) VALUES ($1,$2,$3,$4)',
      [id, description, req.user.id, Date.now()]
    );
    res.json({ id });
  } catch (e) { console.error('Supply error:', e); res.status(500).json({ error: 'Server error' }); }
});

app.patch('/api/supplies/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE supplies SET status=$1 WHERE id=$2', [status, req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.delete('/api/supplies/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM supplies WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ── STOCK TAKES ──────────────────────────────────────────

// All stock-take item definitions (used as template for new takes)
const STOCKTAKE_TEMPLATE = [
  {cat:'Guest Amenities',      name:'Shower Gel',                   unit:'pcs', fields:'amenity'},
  {cat:'Guest Amenities',      name:'Conditioner / Shampoo',        unit:'pcs', fields:'amenity'},
  {cat:'Guest Amenities',      name:'Handwash',                     unit:'pcs', fields:'amenity'},
  {cat:'Guest Amenities',      name:'Lotion',                       unit:'pcs', fields:'amenity'},
  {cat:'Linen – Towels',       name:'Bath Towel',                   unit:'pcs', fields:'linen'},
  {cat:'Linen – Towels',       name:'Hand Towel',                   unit:'pcs', fields:'linen'},
  {cat:'Linen – Towels',       name:'Bath Mat',                     unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Inners', name:'Super King Duvet Inner',       unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Inners', name:'King Duvet Inner',             unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Inners', name:'Queen Duvet Inner',            unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Inners', name:'Double Duvet Inner',           unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Inners', name:'Single Duvet Inner',           unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Covers', name:'Super King Duvet Cover',       unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Covers', name:'King Duvet Cover',             unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Covers', name:'Queen Duvet Cover',            unit:'pcs', fields:'linen'},
  {cat:'Linen – Duvet Covers', name:'Single Duvet Cover',           unit:'pcs', fields:'linen'},
  {cat:'Linen – Fitted Sheets',name:'Super King Fitted Sheet',      unit:'pcs', fields:'linen'},
  {cat:'Linen – Fitted Sheets',name:'King Fitted Sheet',            unit:'pcs', fields:'linen'},
  {cat:'Linen – Fitted Sheets',name:'Queen Fitted Sheet',           unit:'pcs', fields:'linen'},
  {cat:'Linen – Fitted Sheets',name:'Double Fitted Sheet',          unit:'pcs', fields:'linen'},
  {cat:'Linen – Fitted Sheets',name:'Single Fitted Sheet',          unit:'pcs', fields:'linen'},
  {cat:'Linen – Mattress Protectors',name:'Super King Mattress Protector',unit:'pcs',fields:'linen'},
  {cat:'Linen – Mattress Protectors',name:'Queen Mattress Protector',     unit:'pcs',fields:'linen'},
  {cat:'Linen – Mattress Protectors',name:'Double Mattress Protector',    unit:'pcs',fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Continental Pillow Case',    unit:'pcs', fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Standard Pillow Case',       unit:'pcs', fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Continental Pillow Protector',unit:'pcs',fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Standard Pillow Protector',  unit:'pcs', fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Standard Pillow',            unit:'pcs', fields:'linen'},
  {cat:'Linen – Pillows & Cases',name:'Continental Pillow',         unit:'pcs', fields:'linen'},
  {cat:'Pool & Other Linen',   name:'Pool Towels',                  unit:'pcs', fields:'linen'},
  {cat:'Pool & Other Linen',   name:'Maroon Fleece',                unit:'pcs', fields:'linen'},
  {cat:'Pool & Other Linen',   name:'New Small Fleeces',            unit:'pcs', fields:'linen'},
  {cat:'Pool & Other Linen',   name:'Laundry Bags',                 unit:'pcs', fields:'linen'},
  {cat:'Stationery',           name:'White Bin Bags',               unit:'pcs', fields:'store'},
  {cat:'Stationery',           name:'White Bin Liners',             unit:'pcs', fields:'store'},
  {cat:'Stationery',           name:'White Note Books',             unit:'pcs', fields:'store'},
  {cat:'Stationery',           name:'Pencils',                      unit:'pcs', fields:'store'},
  {cat:'Stationery',           name:'Toilet Roll Stickers',         unit:'pcs', fields:'store'},
  {cat:'Stationery',           name:'Welcome Cards',                unit:'pcs', fields:'store'},
  {cat:'Other',                name:'Umbrellas',                    unit:'pcs', fields:'store'},
  {cat:'Chemicals',            name:'Chop Chop',                    unit:'btl', fields:'store'},
  {cat:'Chemicals',            name:'Steri',                        unit:'btl', fields:'store'},
  {cat:'Chemicals',            name:'Window Clean',                 unit:'btl', fields:'store'},
  {cat:'Chemicals',            name:'Ordorex',                      unit:'btl', fields:'store'},
  {cat:'Equipment',            name:'Iron',                         unit:'pcs', fields:'store'},
  {cat:'Equipment',            name:'Ironing Board',                unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Coffee Machines',              unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Cups',                         unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Lids',                         unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Stirrers',                     unit:'kg',  fields:'store'},
  {cat:'Coffee & Tea Station', name:'Sugar Sachets',                unit:'kg',  fields:'store'},
  {cat:'Coffee & Tea Station', name:'Sweetener Sachets',            unit:'kg',  fields:'store'},
  {cat:'Coffee & Tea Station', name:'Milk Pods',                    unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Coffee – Decaf',               unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Coffee – House Brand',         unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Cleaning Pods',                unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Display Boxes',                unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Earl Grey',                    unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'English Breakfast Tea',        unit:'pcs', fields:'store'},
  {cat:'Coffee & Tea Station', name:'Chamomile',                    unit:'pcs', fields:'store'},
];

// List all stock-takes
app.get('/api/stocktakes', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id,type,date,conducted_by,checked_by,created_at,completed FROM stocktakes ORDER BY date DESC, created_at DESC`
    );
    res.json(r.rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Get template (opening stocks pre-filled from last completed stocktake's closing)
app.get('/api/stocktakes/template', auth, async (req, res) => {
  try {
    // Find the most recent completed stocktake
    const lastR = await pool.query(
      `SELECT id FROM stocktakes WHERE completed=1 ORDER BY date DESC, created_at DESC LIMIT 1`
    );
    let closingMap = {};
    if (lastR.rows.length) {
      const lastId = lastR.rows[0].id;
      const itemsR = await pool.query(
        `SELECT item_name, closing_stock FROM stocktake_items WHERE stocktake_id=$1`, [lastId]
      );
      for (const row of itemsR.rows) {
        closingMap[row.item_name] = row.closing_stock || '';
      }
    }
    const items = STOCKTAKE_TEMPLATE.map(t => ({
      ...t,
      opening_stock: closingMap[t.name] || '',
      in_rooms: '', at_laundry: '', in_storeroom: '', damaged: '', closing_stock: '', notes: ''
    }));
    res.json(items);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Get one stock-take with all items
app.get('/api/stocktakes/:id', auth, async (req, res) => {
  try {
    const st = await pool.query(`SELECT * FROM stocktakes WHERE id=$1`, [req.params.id]);
    if (!st.rows.length) return res.status(404).json({ error: 'Not found' });
    const items = await pool.query(
      `SELECT * FROM stocktake_items WHERE stocktake_id=$1 ORDER BY id`, [req.params.id]
    );
    res.json({ ...st.rows[0], items: items.rows });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Create new stock-take with items
app.post('/api/stocktakes', auth, async (req, res) => {
  try {
    const { type, date, conducted_by, checked_by, items } = req.body;
    if (!type || !date) return res.status(400).json({ error: 'type and date required' });
    const id = uid();
    await pool.query(
      `INSERT INTO stocktakes (id,type,date,conducted_by,checked_by,created_at,completed) VALUES ($1,$2,$3,$4,$5,$6,0)`,
      [id, type, date, conducted_by||'', checked_by||'', Date.now()]
    );
    if (items && items.length) {
      for (const it of items) {
        await pool.query(
          `INSERT INTO stocktake_items (id,stocktake_id,category,item_name,unit,fields,opening_stock,in_rooms,at_laundry,in_storeroom,damaged,closing_stock,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [uid(), id, it.cat||it.category, it.name||it.item_name, it.unit||'pcs', it.fields||'linen',
           it.opening_stock||'', it.in_rooms||'', it.at_laundry||'', it.in_storeroom||'',
           it.damaged||'', it.closing_stock||'', it.notes||'']
        );
      }
    }
    res.json({ id });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Update stock-take header + items, optionally mark complete
app.put('/api/stocktakes/:id', auth, async (req, res) => {
  try {
    const { type, date, conducted_by, checked_by, completed, items } = req.body;
    await pool.query(
      `UPDATE stocktakes SET type=COALESCE($1,type), date=COALESCE($2,date), conducted_by=COALESCE($3,conducted_by),
       checked_by=COALESCE($4,checked_by), completed=COALESCE($5,completed) WHERE id=$6`,
      [type, date, conducted_by, checked_by, completed, req.params.id]
    );
    if (items && items.length) {
      await pool.query(`DELETE FROM stocktake_items WHERE stocktake_id=$1`, [req.params.id]);
      for (const it of items) {
        await pool.query(
          `INSERT INTO stocktake_items (id,stocktake_id,category,item_name,unit,fields,opening_stock,in_rooms,at_laundry,in_storeroom,damaged,closing_stock,notes)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [uid(), req.params.id, it.cat||it.category, it.name||it.item_name, it.unit||'pcs', it.fields||'linen',
           it.opening_stock||'', it.in_rooms||'', it.at_laundry||'', it.in_storeroom||'',
           it.damaged||'', it.closing_stock||'', it.notes||'']
        );
      }
    }
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Download stock-take as Excel
app.get('/api/stocktakes/:id/excel', auth, async (req, res) => {
  try {
    const st = await pool.query(`SELECT * FROM stocktakes WHERE id=$1`, [req.params.id]);
    if (!st.rows.length) return res.status(404).json({ error: 'Not found' });
    const h = st.rows[0];
    const items = await pool.query(`SELECT * FROM stocktake_items WHERE stocktake_id=$1 ORDER BY id`, [req.params.id]);

    const wb = XLSX.utils.book_new();
    const typeLabel = h.type === 'monthly' ? 'Monthly' : 'Weekly';

    // ── Sheet 1: Stock Take ──
    const rows = [
      ['The Grey Hotel – Housekeeping Stock Take'],
      [],
      ['Type', typeLabel],
      ['Date', h.date],
      ['Conducted by', h.conducted_by || ''],
      ['Checked by', h.checked_by || ''],
      [],
      ['Category', 'Item', 'Unit', 'Opening Stock', 'In Rooms', 'At Laundry', 'In Storeroom', 'Damaged', 'Closing Stock', 'Variance', 'Notes'],
    ];

    let lastCat = '';
    for (const it of items.rows) {
      if (it.category !== lastCat) {
        rows.push([]); // blank row between categories
        lastCat = it.category;
      }
      const opening = parseFloat(it.opening_stock) || 0;
      const closing = parseFloat(it.closing_stock) || 0;
      const variance = (it.closing_stock !== '' && it.closing_stock !== null) ? closing - opening : '';
      rows.push([
        it.category, it.item_name, it.unit,
        it.opening_stock || '', it.in_rooms || '', it.at_laundry || '',
        it.in_storeroom || '', it.damaged || '', it.closing_stock || '',
        variance, it.notes || ''
      ]);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws['!cols'] = [
      {wch:22},{wch:30},{wch:8},{wch:13},{wch:10},{wch:10},{wch:12},{wch:10},{wch:13},{wch:10},{wch:20}
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Stock Take');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = `StockTake_${typeLabel}_${h.date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buf);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Delete stock-take (admin only)
app.delete('/api/stocktakes/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`DELETE FROM stocktake_items WHERE stocktake_id=$1`, [req.params.id]);
    await pool.query(`DELETE FROM stocktakes WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// Cleanup stock-takes older than 3 months (keep sept2026-seed forever)
async function cleanupOldStocktakes() {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const cutoff = threeMonthsAgo.toISOString().slice(0,10);
    const old = await pool.query(
      `SELECT id FROM stocktakes WHERE date < $1 AND id != 'sept2026-seed'`, [cutoff]
    );
    for (const row of old.rows) {
      await pool.query(`DELETE FROM stocktake_items WHERE stocktake_id=$1`, [row.id]);
      await pool.query(`DELETE FROM stocktakes WHERE id=$1`, [row.id]);
    }
    if (old.rows.length) console.log(`🗑 Deleted ${old.rows.length} stock-take(s) older than 3 months`);
  } catch (e) { console.error('Stock-take cleanup error:', e); }
}

// ── CATCH-ALL → serve frontend ──────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROR HANDLER ───────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START ───────────────────────────────────────────────
initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🏨 Hotel Housekeeping running → http://localhost:${PORT}`);
    });
    scheduleDailyReset();
    cleanupOldStocktakes();
  })
  .catch(err => {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  });
