const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const roomManager = require('./server/room_manager');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readLeaderboardData() {
  try {
    if (fs.existsSync(LEADERBOARD_FILE)) {
      const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf-8');
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.snipers)) return data;
    }
  } catch (e) {
    console.error('Error reading leaderboard file:', e.message);
  }
  return { snipers: [], pilots: [] };
}

function saveLeaderboardData(data) {
  try {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving leaderboard file:', e.message);
  }
}

// In-memory active session tokens mapped to user data
const SESSIONS = new Map(); // token -> { userId, expiresAt }

function readUsersData() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error('Error reading users file:', e.message);
  }
  return [];
}

function saveUsersData(list) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving users file:', e.message);
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    createdAt: u.createdAt,
    stats: u.stats || {
      matchesPlayed: 0,
      matchesWon: 0,
      bestProximityMm: null,
      elo: 1200,
      pucksFired: 0
    }
  };
}

function getUserByToken(token) {
  if (!token) return null;
  const sess = SESSIONS.get(token);
  if (!sess) return null;
  if (Date.now() > sess.expiresAt) {
    SESSIONS.delete(token);
    return null;
  }
  const users = readUsersData();
  return users.find(u => u.id === sess.userId) || null;
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

function readFeedbackData() {
  try {
    if (fs.existsSync(FEEDBACK_FILE)) {
      const raw = fs.readFileSync(FEEDBACK_FILE, 'utf-8');
      const list = JSON.parse(raw);
      if (Array.isArray(list)) return list;
    }
  } catch (e) {
    console.error('Error reading feedback file:', e.message);
  }
  return [];
}

function saveFeedbackData(list) {
  try {
    fs.writeFileSync(FEEDBACK_FILE, JSON.stringify(list, null, 2), 'utf-8');
  } catch (e) {
    console.error('Error saving feedback file:', e.message);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderFeedbackDashboardHtml(feedbackList) {
  const total = feedbackList.length;
  const avg = total > 0 ? (feedbackList.reduce((acc, f) => acc + (f.rating || 5), 0) / total).toFixed(1) : "N/A";
  const mobileCount = feedbackList.filter(f => f.device && f.device.toLowerCase().includes('mobile')).length;
  const desktopCount = total - mobileCount;

  const rows = feedbackList.slice().reverse().map(f => {
    const stars = '★'.repeat(Math.max(1, Math.min(5, f.rating || 5))) + '☆'.repeat(5 - Math.max(1, Math.min(5, f.rating || 5)));
    const tagsHtml = (f.tags || []).map(t => `<span class="tag-pill">${escapeHtml(t)}</span>`).join(' ');
    const dateStr = f.timestamp ? new Date(f.timestamp).toLocaleString() : 'Just now';
    return `
      <div class="feedback-card">
        <div class="card-header">
          <div class="player-info">
            <span class="player-name">${escapeHtml(f.playerName || 'Anonymous')}</span>
            <span class="device-badge">${escapeHtml(f.device || 'Unknown')}</span>
          </div>
          <div class="rating-info">
            <span class="stars">${stars}</span>
            <span class="date">${dateStr}</span>
          </div>
        </div>
        ${tagsHtml ? `<div class="card-tags">${tagsHtml}</div>` : ''}
        ${f.comments ? `<div class="card-comments">${escapeHtml(f.comments)}</div>` : '<div class="card-comments no-comment">No written comment</div>'}
      </div>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Core Striker - Playtest Feedback Hub</title>
  <style>
    :root {
      --bg: #07090e;
      --card-bg: rgba(22, 27, 34, 0.85);
      --border: rgba(255, 255, 255, 0.12);
      --gold: #ffb703;
      --cobalt: #00d2ff;
      --crimson: #ff0055;
      --emerald: #06d6a0;
      --text: #f0f6fc;
      --text-dim: #8b949e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      padding: 2rem 1rem;
      min-height: 100vh;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2rem;
      border-bottom: 1px solid var(--border);
      padding-bottom: 1rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    h1 {
      font-size: 1.6rem;
      letter-spacing: 0.05em;
      color: #fff;
    }
    .stats-bar {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }
    .stat-val {
      font-size: 1.8rem;
      font-weight: 800;
      color: var(--gold);
    }
    .stat-lbl {
      font-size: 0.75rem;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-top: 0.2rem;
    }
    .feedback-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .feedback-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.2rem;
      backdrop-filter: blur(8px);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .player-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .player-name {
      font-weight: 700;
      font-size: 1.05rem;
      color: #fff;
    }
    .device-badge {
      font-size: 0.7rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.2rem 0.5rem;
      color: var(--cobalt);
    }
    .stars {
      color: var(--gold);
      font-size: 1.1rem;
      letter-spacing: 0.1em;
    }
    .date {
      font-size: 0.72rem;
      color: var(--text-dim);
      margin-left: 0.5rem;
    }
    .card-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 0.6rem;
    }
    .tag-pill {
      font-size: 0.7rem;
      background: rgba(0, 210, 255, 0.1);
      border: 1px solid rgba(0, 210, 255, 0.3);
      color: var(--cobalt);
      padding: 0.2rem 0.5rem;
      border-radius: 12px;
    }
    .card-comments {
      font-size: 0.95rem;
      line-height: 1.5;
      color: #e6edf3;
      white-space: pre-wrap;
    }
    .no-comment {
      color: var(--text-dim);
      font-style: italic;
      font-size: 0.85rem;
    }
    .btn-action {
      background: var(--cobalt);
      color: #060709;
      font-weight: 700;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      text-decoration: none;
      font-size: 0.82rem;
    }
    .btn-action:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>🎯 Playtest Feedback Hub</h1>
        <p style="color:var(--text-dim); font-size:0.85rem; margin-top:0.2rem;">Live player reviews & suggestions from playtesters</p>
      </div>
      <div style="display:flex; gap:0.5rem;">
        <a href="/" class="btn-action" style="background:rgba(255,255,255,0.1); color:#fff; border:1px solid var(--border);">◀ Back to Game</a>
        <button onclick="location.reload()" class="btn-action">🔄 Refresh</button>
      </div>
    </header>

    <div class="stats-bar">
      <div class="stat-card">
        <div class="stat-val">${total}</div>
        <div class="stat-lbl">Total Reviews</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:var(--gold);">${avg} / 5</div>
        <div class="stat-lbl">Avg Star Rating</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:var(--cobalt);">${mobileCount}</div>
        <div class="stat-lbl">Mobile Players</div>
      </div>
      <div class="stat-card">
        <div class="stat-val" style="color:var(--emerald);">${desktopCount}</div>
        <div class="stat-lbl">Desktop Players</div>
      </div>
    </div>

    <div class="feedback-list">
      ${total === 0 ? '<div style="text-align:center; padding:3rem; color:var(--text-dim);">No feedback submitted yet. Send your invite link to friends!</div>' : rows}
    </div>
  </div>
</body>
</html>`;
}

const server = http.createServer((req, res) => {
  // Global CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  let reqUrl = req.url.split('?')[0]; // Strip query params

  // 0. Render & Cloud Health Check: GET /healthz or GET /api/health
  if (req.method === 'GET' && (reqUrl === '/healthz' || reqUrl === '/api/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'core-striker-server',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString()
    }));
    return;
  }

  // --- AUTHENTICATION API ROUTES ---
  // A. Register: POST /api/auth/register
  if (req.method === 'POST' && reqUrl === '/api/auth/register') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const rawUser = (data.username || '').trim();
        const rawPass = String(data.password || '');

        if (!rawUser || rawUser.length < 3 || rawUser.length > 16) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Call-sign must be 3-16 characters' }));
          return;
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(rawUser)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Call-sign can only contain letters, numbers, spaces, and dashes' }));
          return;
        }
        if (!rawPass || rawPass.length < 4) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Security key must be at least 4 characters' }));
          return;
        }

        const users = readUsersData();
        const existing = users.find(u => u.username.toLowerCase() === rawUser.toLowerCase());
        if (existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Pilot call-sign already registered' }));
          return;
        }

        const salt = crypto.randomBytes(16).toString('hex');
        const passwordHash = hashPassword(rawPass, salt);
        const newUser = {
          id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          username: rawUser,
          salt,
          passwordHash,
          createdAt: new Date().toISOString(),
          stats: {
            matchesPlayed: 0,
            matchesWon: 0,
            bestProximityMm: null,
            elo: 1200,
            pucksFired: 0
          }
        };

        users.push(newUser);
        saveUsersData(users);

        const token = generateToken();
        SESSIONS.set(token, { userId: newUser.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });

        console.log(`[AUTH] Registered new pilot: ${newUser.username} (${newUser.id})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Account registered!', token, user: sanitizeUser(newUser) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed request body' }));
      }
    });
    return;
  }

  // B. Login: POST /api/auth/login
  if (req.method === 'POST' && reqUrl === '/api/auth/login') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10000) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const rawUser = (data.username || '').trim();
        const rawPass = String(data.password || '');

        if (!rawUser || !rawPass) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Username and password required' }));
          return;
        }

        const users = readUsersData();
        const user = users.find(u => u.username.toLowerCase() === rawUser.toLowerCase());
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Call-sign not found' }));
          return;
        }

        const checkHash = hashPassword(rawPass, user.salt);
        if (checkHash !== user.passwordHash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Incorrect security key' }));
          return;
        }

        const token = generateToken();
        SESSIONS.set(token, { userId: user.id, expiresAt: Date.now() + 30 * 24 * 3600 * 1000 });

        console.log(`[AUTH] Pilot logged in: ${user.username} (${user.id})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Sign-in successful!', token, user: sanitizeUser(user) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed request body' }));
      }
    });
    return;
  }

  // C. Profile / Session Check: GET /api/auth/me
  if (req.method === 'GET' && reqUrl === '/api/auth/me') {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      const parsedUrl = new URL(req.url, 'http://localhost');
      token = parsedUrl.searchParams.get('token');
    }

    const user = getUserByToken(token);
    if (!user) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Unauthorized or session expired' }));
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, user: sanitizeUser(user) }));
    return;
  }

  // D. Logout: POST /api/auth/logout
  if (req.method === 'POST' && reqUrl === '/api/auth/logout') {
    let token = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.substring(7).trim();
    }
    if (token) SESSIONS.delete(token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'Logged out' }));
    return;
  }

  // --- LEADERBOARD API ROUTES ---
  // A. Get Global Leaderboard: GET /api/leaderboard
  if (req.method === 'GET' && reqUrl === '/api/leaderboard') {
    const lbData = readLeaderboardData();
    const users = readUsersData();

    // Map all registered pilots with their competitive records
    const pilots = users.map(u => {
      const s = u.stats || {};
      const matches = s.matchesPlayed || 0;
      const wins = s.matchesWon || 0;
      const winRate = matches > 0 ? Math.round((wins / matches) * 100) : 0;
      return {
        id: u.id,
        username: u.username,
        elo: s.elo || 1200,
        matches,
        wins,
        winRate,
        bestProximityMm: s.bestProximityMm != null ? s.bestProximityMm : null
      };
    }).sort((a, b) => (b.elo - a.elo) || (b.wins - a.wins));

    // Sort snipers by closest proximity (lowest mm to pin)
    const snipers = (lbData.snipers || []).slice().sort((a, b) => a.proximityMm - b.proximityMm).slice(0, 30);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      snipers,
      pilots: pilots.slice(0, 30),
      totalRegistered: users.length
    }));
    return;
  }

  // B. Record Match Results & High Scores: POST /api/leaderboard/record
  if (req.method === 'POST' && reqUrl === '/api/leaderboard/record') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 20000) req.destroy();
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const token = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '') || data.token;
        const rawUser = (data.username || '').trim() || 'GUEST';
        const proximityMm = typeof data.proximityMm === 'number' && !isNaN(data.proximityMm) && data.proximityMm >= 0 ? Number(data.proximityMm.toFixed(3)) : null;
        const isMatchWin = !!data.isMatchWin;
        const mode = String(data.mode || '2v2');

        const users = readUsersData();
        let user = getUserByToken(token);
        if (!user && rawUser !== 'GUEST') {
          user = users.find(u => u.username.toLowerCase() === rawUser.toLowerCase());
        }

        let updatedStats = null;
        if (user) {
          if (!user.stats) user.stats = { matchesPlayed: 0, matchesWon: 0, bestProximityMm: null, elo: 1200, pucksFired: 0 };
          user.stats.matchesPlayed = (user.stats.matchesPlayed || 0) + 1;
          if (isMatchWin) {
            user.stats.matchesWon = (user.stats.matchesWon || 0) + 1;
            user.stats.elo = (user.stats.elo || 1200) + 25;
          } else {
            user.stats.elo = Math.max(800, (user.stats.elo || 1200) - 15);
          }
          if (proximityMm != null) {
            if (user.stats.bestProximityMm == null || proximityMm < user.stats.bestProximityMm) {
              user.stats.bestProximityMm = proximityMm;
            }
          }
          if (typeof data.pucksFired === 'number') {
            user.stats.pucksFired = (user.stats.pucksFired || 0) + data.pucksFired;
          }
          saveUsersData(users);
          updatedStats = user.stats;
        }

        // Record to global snipers Hall of Fame if valid proximity shot
        const lbData = readLeaderboardData();
        if (proximityMm != null && proximityMm < 150) { // Within 150mm of pin
          const pilotHandle = user ? user.username : rawUser;
          // Check if this player already has a score in snipers
          const existingIdx = lbData.snipers.findIndex(s => s.username.toLowerCase() === pilotHandle.toLowerCase());
          if (existingIdx !== -1) {
            if (proximityMm < lbData.snipers[existingIdx].proximityMm) {
              lbData.snipers[existingIdx].proximityMm = proximityMm;
              lbData.snipers[existingIdx].date = new Date().toISOString();
              lbData.snipers[existingIdx].mode = mode;
            }
          } else {
            lbData.snipers.push({
              id: `snp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              username: pilotHandle,
              proximityMm,
              date: new Date().toISOString(),
              mode
            });
          }
          lbData.snipers.sort((a, b) => a.proximityMm - b.proximityMm);
          lbData.snipers = lbData.snipers.slice(0, 50);
          saveLeaderboardData(lbData);
        }

        console.log(`[LEADERBOARD] Recorded match result for ${user ? user.username : rawUser}: ${proximityMm != null ? proximityMm + ' mm' : 'no shot'} (Win: ${isMatchWin})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          message: 'Match result recorded!',
          updatedStats
        }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Malformed request payload' }));
      }
    });
    return;
  }

  // 1. Playtest Feedback API: POST /api/feedback
  if (req.method === 'POST' && reqUrl === '/api/feedback') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 50000) req.destroy(); // Max 50KB payload
    });
    req.on('end', () => {
      try {
        const data = JSON.parse(body || '{}');
        const feedbackList = readFeedbackData();
        const entry = {
          id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          timestamp: new Date().toISOString(),
          playerName: (data.playerName || 'Anonymous').trim().substring(0, 30),
          rating: Math.max(1, Math.min(5, Number(data.rating) || 5)),
          device: (data.device || 'Unknown').substring(0, 30),
          tags: Array.isArray(data.tags) ? data.tags.slice(0, 8).map(t => String(t).trim().substring(0, 30)) : [],
          comments: (data.comments || '').trim().substring(0, 1000),
          ip: req.socket.remoteAddress || ''
        };
        feedbackList.push(entry);
        saveFeedbackData(feedbackList);

        console.log(`[FEEDBACK] Received review from ${entry.playerName}: ${entry.rating}★ (${entry.device})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Feedback saved successfully!', id: entry.id }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 2. Playtest Feedback API: GET /api/feedback
  if (req.method === 'GET' && reqUrl === '/api/feedback') {
    const list = readFeedbackData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: list.length, items: list }));
    return;
  }

  // 3. Playtest Feedback Hub Dashboard: GET /feedback
  if (req.method === 'GET' && (reqUrl === '/feedback' || reqUrl === '/admin/feedback')) {
    const list = readFeedbackData();
    const html = renderFeedbackDashboardHtml(list);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // 4. Static File Serving with Directory Traversal Protection
  if (reqUrl.includes('..') || reqUrl.includes('\0')) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const cleanUrl = reqUrl.split('?')[0];
  const safeReqPath = path.normalize(cleanUrl === '/' ? '/index.html' : cleanUrl);
  const filePath = path.join(__dirname, safeReqPath);
  const resolved = path.resolve(filePath);
  const baseName = path.basename(filePath);

  // Ensure file is within root and does not access sensitive backend or dot files
  if (!resolved.startsWith(path.resolve(__dirname)) || baseName.startsWith('.') || baseName === 'package.json' || baseName === 'server.js') {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'text/plain';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

// Attach WebSocket Server to the same HTTP server port with frame size cap
const wss = new WebSocketServer({ server, maxPayload: 65536 });

wss.on('connection', (ws) => {
  let currentRoom = null;
  let currentPlayer = null;
  ws.isAlive = true;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);

      switch (msg.type) {
        case 'JOIN_ROOM': {
          if (currentRoom) {
            currentRoom.removePlayer(ws);
            roomManager.cleanupEmptyRooms();
            currentRoom = null;
            currentPlayer = null;
          }

          const roomCode = (msg.roomCode || 'STRIKE-PUBLIC').toUpperCase().trim();
          currentRoom = roomManager.getOrCreateRoom(roomCode, msg.config || {});
          
          const rawName = (msg.playerName || '').trim();
          const cleanName = rawName ? rawName.substring(0, 24) : null;

          currentPlayer = currentRoom.addPlayer(ws, {
            name: cleanName,
            isHost: msg.isHost
          });
          break;
        }

        case 'START_MATCH':
        case 'RESTART_MATCH': {
          if (currentRoom) {
            currentRoom.startRound(currentPlayer);
          }
          break;
        }

        case 'AIM_TELEMETRY': {
          if (currentRoom && currentPlayer) {
            const hasBotTarget = (msg.botPlayerId !== null && msg.botPlayerId !== undefined) || (msg.botSlotIndex !== null && msg.botSlotIndex !== undefined);
            if (hasBotTarget && !currentPlayer.isHost) break; // Reject non-host bot telemetry spoofing
            currentRoom.broadcast({
              type: 'AIM_UPDATE',
              playerId: hasBotTarget ? msg.botPlayerId : currentPlayer.id,
              slotIndex: hasBotTarget ? msg.botSlotIndex : currentPlayer.slotIndex,
              angle: msg.angle,
              impulsePct: msg.impulsePct,
              isAiming: msg.isAiming !== false
            }, ws);
          }
          break;
        }

        case 'AIM_END': {
          if (currentRoom && currentPlayer) {
            const hasBotTarget = (msg.botPlayerId !== null && msg.botPlayerId !== undefined) || (msg.botSlotIndex !== null && msg.botSlotIndex !== undefined);
            if (hasBotTarget && !currentPlayer.isHost) break;
            currentRoom.broadcast({
              type: 'AIM_END',
              playerId: hasBotTarget ? msg.botPlayerId : currentPlayer.id,
              slotIndex: hasBotTarget ? msg.botSlotIndex : currentPlayer.slotIndex
            }, ws);
          }
          break;
        }

        case 'FIRE_SHOT': {
          if (currentRoom && currentPlayer) {
            let shooter = currentPlayer;
            const hasBotTarget = (msg.botPlayerId !== undefined || msg.botSlotIndex !== undefined);
            if (hasBotTarget) {
              if (!currentPlayer.isHost) break; // Reject non-host bot shot injection
              shooter = currentRoom.getOrCreateBotPlayer(msg);
            }
            currentRoom.fireShot(shooter, msg);
          }
          break;
        }

        case 'UPDATE_ROOM_CONFIG': {
          if (currentRoom && currentPlayer && currentPlayer.isHost) {
            currentRoom.updateConfig(msg.config || {});
          }
          break;
        }

        case 'SET_PLAYER_TEAM': {
          if (currentRoom && currentPlayer) {
            const target = (msg.targetId !== undefined && msg.targetId !== null) ? msg.targetId : msg.slotIndex;
            currentRoom.setPlayerTeam(currentPlayer, target, msg.team);
          }
          break;
        }

        case 'BALANCE_TEAMS': {
          if (currentRoom && currentPlayer) {
            currentRoom.balanceTeams(currentPlayer);
          }
          break;
        }

        case 'COMMIT_BARRAGE_SHOT': {
          if (currentRoom && currentPlayer) {
            currentRoom.commitBarrageShot(currentPlayer, msg);
          }
          break;
        }

        case 'TRIGGER_BARRAGE_SIM': {
          if (currentRoom) {
            currentRoom.triggerBarrageSimulation();
          }
          break;
        }

        case 'HOST_PHYSICS_DELTA': {
          if (currentRoom && currentPlayer && currentPlayer.isHost) {
            currentRoom.handleHostPhysicsDelta(msg, ws);
          }
          break;
        }

        case 'HOST_PUCK_SETTLED': {
          if (currentRoom && currentPlayer && currentPlayer.isHost) {
            currentRoom.handleHostPuckSettled(msg, ws);
          }
          break;
        }

        case 'HOST_EVENT': {
          if (currentRoom && currentPlayer && currentPlayer.isHost) {
            currentRoom.handleHostEvent(msg, ws);
          }
          break;
        }

        case 'PING': {
          ws.isAlive = true;
          ws.send(JSON.stringify({ type: 'PONG', t: msg.t }));
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e.message);
    }
  });

  ws.on('close', () => {
    if (currentRoom) {
      currentRoom.removePlayer(ws);
      roomManager.cleanupEmptyRooms();
    }
  });

  ws.on('error', (err) => {
    console.error('WebSocket connection error:', err.message);
  });
});

// Periodic heartbeat keep-alive to terminate dead/zombie sockets
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, '0.0.0.0', 2048, () => {
  console.log(`====================================================`);
  console.log(`   CORE STRIKER AUTHORITATIVE MULTIPLAYER SERVER   `);
  console.log(`   HTTP: http://localhost:${PORT}`);
  console.log(`   WebSockets: ws://localhost:${PORT}`);
  console.log(`   Feedback Hub: http://localhost:${PORT}/feedback`);
  console.log(`   24H Colosseum: GLOBAL-24H-COLOSSEUM (Ready)`);
  console.log(`   24H Barrage:   GLOBAL-24H-BARRAGE (Ready)`);
  console.log(`====================================================`);
});
