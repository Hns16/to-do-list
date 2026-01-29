const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const PORT = 3000;

// 初始化数据文件
if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ todos: [], xp: 0, level: 1 }));
}

const server = http.createServer((req, res) => {
    // CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    // GET /api/data - 读取数据
    if (req.method === 'GET' && req.url === '/api/data') {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(data);
        return;
    }

    // POST /api/data - 保存数据
    if (req.method === 'POST' && req.url === '/api/data') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                JSON.parse(body); // 验证 JSON
                fs.writeFileSync(DATA_FILE, body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"success":true}');
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end('{"error":"Invalid JSON"}');
            }
        });
        return;
    }

    // 静态文件服务
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, filePath);
    
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
        } else {
            res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

server.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
