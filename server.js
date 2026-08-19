'use strict';
const express  = require('express');
const { Pool } = require('pg');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');

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
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    const name = path.basename(filePath);
    // The service worker and the shell must never be served stale, or
    // installed devices keep running an old build.
    if (name === 'sw.js' || name === 'index.html' || name === 'manifest.json') {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (filePath.includes(`${path.sep}icons${path.sep}`)) {
      // A day, not a week: icons rarely change, but when they do a week is
      // a long time to have half the phones showing the old tile.
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  },
}));

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
];

const DEFAULT_USERS = [
  { id: 'u1', username: 'admin',        password: 'admin123', role: 'admin',       name: 'Admin'  },
  { id: 'u2', username: 'reception1',   password: 'pass123',  role: 'reception',   name: 'Sarah'  },
  { id: 'u3', username: 'reception2',   password: 'pass123',  role: 'reception',   name: 'Mark'   },
  { id: 'u4', username: 'hk1',          password: 'pass123',  role: 'housekeeper', name: 'Maria'  },
  { id: 'u5', username: 'hk2',          password: 'pass123',  role: 'housekeeper', name: 'Anna'   },
  { id: 'u6', username: 'hk3',          password: 'pass123',  role: 'housekeeper', name: 'Sofia'  },
  { id: 'u7', username: 'maintenance',  password: 'pass123',  role: 'maintenance', name: 'John'   },
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
    `);

        // Restore default users cleanly — delete any conflicting rows first to fix DB inconsistencies
    for (const u of DEFAULT_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      // Remove any rows with this id OR this username (clears PK/unique conflicts)
      await client.query('DELETE FROM users WHERE id=$1 OR username=$2', [u.id, u.username]);
      await client.query(
        'INSERT INTO users (id,username,password,name,role) VALUES ($1,$2,$3,$4,$5)',
        [u.id, u.username, hash, u.name, u.role]
      );
    }
    console.log('✅ Default users restored');

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
    }

    console.log('🏨 Database ready');
  } finally {
    client.release();
  }
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
  // Photos: only show today's uploads in room/area views — older ones stay in history
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const todayEnd   = new Date(); todayEnd.setHours(23,59,59,999);
  const [roomsRes, areasRes, photosRes, issuesRes] = await Promise.all([
    pool.query('SELECT * FROM rooms ORDER BY id'),
    pool.query('SELECT * FROM areas ORDER BY id'),
    pool.query('SELECT * FROM photos WHERE uploaded_at >= $1 AND uploaded_at <= $2 ORDER BY uploaded_at', [todayStart.getTime(), todayEnd.getTime()]),
    pool.query('SELECT * FROM issues ORDER BY reported_at'),
  ]);

  const rooms = roomsRes.rows.map(r => ({
    id:            r.id,
    status:        r.status,
    assignedTo:    parseAssignedTo(r.assigned_to),
    cleaningStart: r.cleaning_start ? Number(r.cleaning_start) : null,
    cleaningEnd:   r.cleaning_end   ? Number(r.cleaning_end)   : null,
    notes:         r.notes || '',
    minibarPhotos: photosRes.rows.filter(p => p.item_type === 'room' && p.item_id === String(r.id)).map(mapPhoto),
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
    photos:        photosRes.rows.filter(p => p.item_type === 'area' && p.item_id === a.id).map(mapPhoto),
    maintenanceIssues: issuesRes.rows.filter(i => i.item_type === 'area' && i.item_id === a.id).map(mapIssue),
  }));

  return { rooms, areas };
}

// ── ROUTES ──────────────────────────────────────────────

// TEMP: one-time password reset — remove after login confirmed
app.get('/api/fix-login', async (req, res) => {
  try {
    const results = [];
    for (const u of DEFAULT_USERS) {
      const hash = await bcrypt.hash(u.password, 10);
      const upd = await pool.query('UPDATE users SET password=$1 WHERE username=$2', [hash, u.username]);
      if (upd.rowCount === 0) {
        await pool.query(
          'INSERT INTO users (id,username,password,name,role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (username) DO UPDATE SET password=EXCLUDED.password',
          [u.id, u.username, hash, u.name, u.role]
        );
        results.push({ username: u.username, action: 'inserted' });
      } else {
        results.push({ username: u.username, action: 'updated' });
      }
    }
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


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

// Full state (rooms + areas + public user list)
app.get('/api/state', auth, async (req, res) => {
  try {
    const { rooms, areas } = await getFullState();
    const usersRes = await pool.query(
      'SELECT id, name, role, username FROM users ORDER BY role, name'
    );
    res.json({ rooms, areas, users: usersRes.rows });
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
      const cur = await pool.query('SELECT cleaning_start, assigned_to FROM rooms WHERE id=$1', [id]);
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
        'INSERT INTO cleaning_logs (id,item_type,item_id,item_name,cleaned_by,started_at,ended_at,duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [uid(), 'room', String(id), `Room ${id}`, who, start, cleaningEnd, start ? cleaningEnd - start : null]
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
      const cur = await pool.query('SELECT cleaning_start, assigned_to, name FROM areas WHERE id=$1', [id]);
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
        'INSERT INTO cleaning_logs (id,item_type,item_id,item_name,cleaned_by,started_at,ended_at,duration_ms) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [uid(), 'area', id, areaName, who, start, cleaningEnd, start ? cleaningEnd - start : null]
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

// ── CATCH-ALL → serve frontend ──────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── ERROR HANDLER ───────────────────────────────────────
app.use((err, req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Manual day-reset endpoint (admin only)
// Photos are NEVER deleted — they stay in history filtered by date.
// Only room/area status, notes and timers are cleared.
app.post('/api/admin/reset-day', auth, requireRole('admin'), async (req, res) => {
  try {
    await pool.query(`UPDATE rooms SET status='dirty', notes='', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL`);
    await pool.query(`UPDATE areas SET status='dirty', notes='', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL`);
    console.log('🌅 Manual day reset triggered by', req.user.username);
    res.json({ ok: true, message: 'Day reset complete' });
  } catch(e) {
    console.error('Reset error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── DAILY RESET ─────────────────────────────────────────
// Runs at 02:00 server time every day.
// Clears notes, photos, open maintenance issues and resets all rooms/areas to dirty.
// History remains intact (photos/issues are stored by date and visible in History tab).
function scheduleDailyReset() {
  function msUntil2AM() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }
  setTimeout(async function run() {
    try {
      await pool.query(`UPDATE rooms SET status='dirty', notes='', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL`);
      await pool.query(`UPDATE areas SET status='dirty', notes='', assigned_to=NULL, cleaning_start=NULL, cleaning_end=NULL`);
      // Photos never deleted — remain in history filtered by upload date
      // Open issues stay open until manually resolved by staff
      console.log('🌅 Daily reset complete — rooms cleared for new day');
    } catch(e) {
      console.error('Daily reset error:', e.message);
    }
    setTimeout(run, 24 * 60 * 60 * 1000); // repeat every 24h
  }, msUntil2AM());
  console.log(`⏰ Daily reset scheduled`);
}

// ── START ───────────────────────────────────────────────
initDB()
  .then(() => {
    scheduleDailyReset();
    app.listen(PORT, () => {
      console.log(`🏨 Hotel Housekeeping running → http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  });
