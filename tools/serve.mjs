// ============================================================================
//  Engine MakrukThai  -  tools/serve.mjs
//  เว็บเซิร์ฟเวอร์สแตติกจิ๋ว ๆ สำหรับเปิด examples/play.html (ES module + Worker)
//  รัน:  node "tools/serve.mjs" [port]     ค่าเริ่มต้นพอร์ต 4180
// ============================================================================
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = normalize(join(fileURLToPath(import.meta.url), '..', '..'));
const PORT = parseInt(process.argv[2] || '4180', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/examples/play.html';
    const full = normalize(join(ROOT, path));
    if (!full.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(full);
    res.writeHead(200, {
      'Content-Type': MIME[extname(full)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      // เปิด cross-origin isolation เพื่อทดสอบ Fairy-Stockfish WASM (SharedArrayBuffer)
      // ใช้ credentialless เพื่อให้ Google Fonts / jsDelivr โหลดได้โดยไม่ต้องมี CORP
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => {
  console.log(`Engine MakrukThai demo:  http://localhost:${PORT}/examples/play.html`);
});
