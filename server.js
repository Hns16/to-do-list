const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const BACKUP_DIR = path.join(__dirname, 'backups');
const PORT = 3000;
const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 120;
const DAILY_BACKUP_KEEP_DAYS = 7;

const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon'
};

const rateLimitStore = new Map();

function ensureDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        const initial = JSON.stringify({ todos: [], xp: 0, level: 1 });
        fs.writeFileSync(DATA_FILE, initial);
    }
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }
}

function setCommonHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
}

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function getClientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.length > 0) {
        return xff.split(',')[0].trim();
    }
    return req.socket.remoteAddress || 'unknown';
}

function isRateLimited(req) {
    const now = Date.now();
    const ip = getClientIp(req);
    const existing = rateLimitStore.get(ip);
    if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitStore.set(ip, { windowStart: now, count: 1 });
        return false;
    }
    existing.count += 1;
    return existing.count > RATE_LIMIT_MAX_REQUESTS;
}

function cleanupRateLimiter() {
    const now = Date.now();
    for (const [ip, info] of rateLimitStore.entries()) {
        if (now - info.windowStart > RATE_LIMIT_WINDOW_MS * 3) {
            rateLimitStore.delete(ip);
        }
    }
}

function toInt(value, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.floor(num));
}

function normalizeTodo(todo) {
    if (!todo || typeof todo !== 'object') return null;
    const text = String(todo.text || '').trim().slice(0, 120);
    if (!text) return null;
    const type = todo.type === 'longterm' ? 'longterm' : 'daily';
    const id = Number.isFinite(Number(todo.id)) ? Number(todo.id) : Date.now();
    const dueDate = typeof todo.dueDate === 'string' ? todo.dueDate.slice(0, 10) : '';
    const completedDate = typeof todo.completedDate === 'string' ? todo.completedDate.slice(0, 10) : null;
    const completed = Boolean(todo.completed);
    const xpReward = type === 'longterm' ? 50 : 20;
    return { id, text, completed, type, dueDate, completedDate, xpReward };
}

function normalizePayload(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const todosInput = Array.isArray(input.todos) ? input.todos : [];
    const todos = todosInput.slice(0, 1000).map(normalizeTodo).filter(Boolean);
    return {
        todos,
        xp: toInt(input.xp, 0),
        level: Math.max(1, toInt(input.level, 1))
    };
}

function writeDataAtomic(dataString) {
    const tempPath = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempPath, dataString);
    fs.renameSync(tempPath, DATA_FILE);
}

function dailyBackupName(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `data-${y}${m}${d}.json`;
}

function rotateDailyBackups() {
    const files = fs
        .readdirSync(BACKUP_DIR)
        .filter(name => /^data-\d{8}\.json$/.test(name))
        .sort();
    const overflow = files.length - DAILY_BACKUP_KEEP_DAYS;
    if (overflow <= 0) return;
    for (let i = 0; i < overflow; i += 1) {
        fs.rmSync(path.join(BACKUP_DIR, files[i]), { force: true });
    }
}

function createDailyBackup() {
    ensureDataFile();
    const target = path.join(BACKUP_DIR, dailyBackupName());
    if (!fs.existsSync(target)) {
        fs.copyFileSync(DATA_FILE, target);
    }
    rotateDailyBackups();
}

function getDataSummary() {
    try {
        const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        return {
            todos: Array.isArray(data.todos) ? data.todos.length : 0,
            xp: toInt(data.xp, 0),
            level: Math.max(1, toInt(data.level, 1))
        };
    } catch (err) {
        return { todos: 0, xp: 0, level: 1 };
    }
}

function getBackupStats() {
    try {
        const files = fs
            .readdirSync(BACKUP_DIR)
            .filter(name => /^data-\d{8}(\.\d{6}\.manual)?\.json$/.test(name))
            .map(name => {
                const fullPath = path.join(BACKUP_DIR, name);
                const mtimeMs = fs.statSync(fullPath).mtimeMs;
                return { name, mtimeMs };
            })
            .sort((a, b) => a.mtimeMs - b.mtimeMs);
        return {
            count: files.length,
            latest: files.length ? files[files.length - 1].name : null
        };
    } catch (err) {
        return { count: 0, latest: null };
    }
}

function handleHealth(req, res) {
    const summary = getDataSummary();
    const backups = getBackupStats();
    const payload = {
        status: 'ok',
        now: new Date().toISOString(),
        service: 'www.2dolist.top',
        data_file: path.basename(DATA_FILE),
        backup_count: backups.count,
        backup_latest: backups.latest,
        todos: summary.todos,
        xp: summary.xp,
        level: summary.level
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    if (req.method === 'HEAD') {
        res.end();
        return;
    }
    res.end(JSON.stringify(payload));
}

function scheduleDailyBackup() {
    createDailyBackup();
    setInterval(createDailyBackup, 6 * 60 * 60 * 1000);
}

function handleApiDataGet(req, res) {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(data);
    } catch (err) {
        sendJson(res, 500, { error: 'Read failed' });
    }
}

function handleApiDataPost(req, res) {
    let body = '';
    let bodySize = 0;

    req.on('data', chunk => {
        bodySize += chunk.length;
        if (bodySize > MAX_BODY_BYTES) {
            sendJson(res, 413, { error: 'Payload too large' });
            req.destroy();
            return;
        }
        body += chunk;
    });

    req.on('end', () => {
        try {
            const parsed = JSON.parse(body || '{}');
            const normalized = normalizePayload(parsed);
            writeDataAtomic(JSON.stringify(normalized));
            createDailyBackup();
            sendJson(res, 200, { success: true });
        } catch (err) {
            sendJson(res, 400, { error: 'Invalid JSON' });
        }
    });

    req.on('error', () => {
        sendJson(res, 400, { error: 'Invalid request body' });
    });
}

function serveStatic(req, res) {
    const safePath = (() => {
        const rawPath = req.url === '/' ? '/index.html' : req.url;
        const cleanPath = rawPath.split('?')[0].split('#')[0];
        const normalized = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, '');
        return path.join(__dirname, normalized);
    })();

    if (!safePath.startsWith(__dirname)) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
    }

    const ext = path.extname(safePath);
    fs.readFile(safePath, (err, content) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain; charset=utf-8' });
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        res.end(content);
    });
}

ensureDataFile();
scheduleDailyBackup();
setInterval(cleanupRateLimiter, RATE_LIMIT_WINDOW_MS);

const server = http.createServer((req, res) => {
    setCommonHeaders(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (isRateLimited(req)) {
        sendJson(res, 429, { error: 'Too many requests' });
        return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/health') {
        handleHealth(req, res);
        return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/api/data') {
        handleApiDataGet(req, res);
        return;
    }

    if (req.method === 'POST' && req.url === '/api/data') {
        handleApiDataPost(req, res);
        return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
        serveStatic(req, res);
        return;
    }

    sendJson(res, 404, { error: 'Not Found' });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
