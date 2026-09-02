// ============================================================================
//  Engine MakrukThai  -  tools/build-standalone.mjs
//  รวมโค้ดเอนจิ้นทั้งหมดเป็น "บันเดิลเดียว" แล้วฝังลงไฟล์ HTML หน้าเดียว (web/index.html)
//  ที่เปิดใช้ได้ทันทีโดยไม่ต้องมีเว็บเซิร์ฟเวอร์ (ใช้ Blob Worker)
//
//  รัน:  node tools/build-standalone.mjs
// ============================================================================
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ลำดับตาม dependency
const ORDER = [
  'src/constants.js',
  'src/zobrist.js',
  'src/tables.js',
  'src/counting.js',
  'src/board.js',
  'src/movegen.js',
  'src/notation.js',
  'src/evaluate.js',
  'src/search.js',
  'src/book.js',
  'src/engine.js',
];

function strip(src) {
  return src
    // import ... ; (รวมหลายบรรทัด — [^;] จับ newline ได้)
    .replace(/^\s*import\b[^;]*;\s*$/gm, '')
    // export { ... } [from '...'] ;
    .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*['"][^'"]*['"])?\s*;\s*$/gm, '')
    // export * from '...';
    .replace(/^\s*export\s+\*\s+from\s+['"][^'"]*['"]\s*;\s*$/gm, '')
    // export function / class / const / let / var  ->  ตัดคำว่า export
    .replace(/^(\s*)export\s+(function|class|const|let|var|async)\b/gm, '$1$2');
}

let bundle = '/* ==== Engine MakrukThai — bundled ==== */\n';
for (const f of ORDER) {
  bundle += `\n/* ---- ${f} ---- */\n` + strip(readFileSync(join(ROOT, f), 'utf8')) + '\n';
}

// glue สำหรับรันใน Worker (โปรโตคอลเดียวกับ worker/engine.worker.js)
const WORKER_GLUE = `
/* ==== worker glue ==== */
const engine = new MakrukEngine({ hash: 64 });
let busy = false;
function postState() {
  self.postMessage({ type:'state', fen:engine.fen(), turn:engine.turnName(), ply:engine.ply(),
    inCheck:engine.inCheck(), counting:engine.countingStatus(), gameOver:engine.isGameOver() });
}
function safeSan(m){ try { return m ? moveToSan(engine.board, m) : null; } catch { return null; } }
function pvSan(pv){
  if (!Array.isArray(pv) || !pv.length) return [];
  const b = engine.board, done = [], out = [];
  try {
    for (const u of pv) {
      const mv = uciToMove(b, u);
      if (!mv) break;
      out.push(moveToSan(b, mv));
      b.makeMove(mv); done.push(mv);
    }
  } catch (e) {}
  for (let i = done.length - 1; i >= 0; i--) b.undoMove(done[i]);
  return out;
}
self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    switch (msg.type) {
      case 'newgame': engine.newGame(); postState(); break;
      case 'position':
        engine.setFen(msg.fen || START_FEN);
        if (Array.isArray(msg.moves)) for (const mv of msg.moves) engine.move(mv);
        postState(); break;
      case 'domove': {
        try { const r = engine.move(msg.uci); self.postMessage({ type:'moved', uci:r.uci, san:r.san }); }
        catch (e) { self.postMessage({ type:'error', message:'illegal move: ' + msg.uci }); }
        postState(); break;
      }
      case 'undo': { const n = Math.max(1, msg.count|0 || 1); for (let i=0;i<n;i++) engine.undo(); postState(); break; }
      case 'setoption': engine.setOption(msg.name, msg.value); break;
      case 'loadbook': engine.loadBook(msg.book || {}); break;
      case 'legal': self.postMessage({ type:'legal', moves:engine.legalMoves(), movesSan:engine.legalMovesSan() }); break;
      case 'eval': self.postMessage({ type:'eval', cp:engine.evaluate() }); break;
      case 'perft': {
        const t0 = (typeof performance!=='undefined'?performance.now():Date.now());
        const n = engine.perft(msg.depth|0);
        self.postMessage({ type:'perft', depth:msg.depth|0, nodes:n,
          ms: Math.round((typeof performance!=='undefined'?performance.now():Date.now()) - t0) });
        break;
      }
      case 'stop': break;
      case 'go': {
        if (busy) { self.postMessage({ type:'error', message:'engine busy' }); break; }
        busy = true;
        const serial = msg.serial || 0;
        const limits = { movetime: msg.movetime, depth: msg.depth, nodes: msg.nodes, useBook: msg.useBook };
        setTimeout(() => {
          let result = null;
          try { result = engine.think(limits, (info)=> self.postMessage({ type:'info', serial, ...info, pvSan: pvSan(info.pv) })); }
          catch (e) { self.postMessage({ type:'error', message:String(e && e.message || e) }); }
          busy = false;
          if (result && result.bestMove)
            self.postMessage({ type:'bestmove', serial, move:result.bestMove, san:safeSan(result.move),
              book:!!result.book, score:result.score, depth:result.depth, nodes:result.nodes, nps:result.nps,
              pv:result.pv, pvSan:pvSan(result.pv) });
          else self.postMessage({ type:'bestmove', serial, move:null });
        }, 0);
        break;
      }
      default: self.postMessage({ type:'error', message:'unknown message: ' + msg.type });
    }
  } catch (e) { busy = false; self.postMessage({ type:'error', message:String(e && e.message || e) }); }
};
self.postMessage({ type:'ready' });
`;

const engineWorkerSource = bundle + WORKER_GLUE;

// optional book
let bookJson = '{}';
try { bookJson = readFileSync(join(ROOT, 'data/book.godratsf.json'), 'utf8'); } catch {}

// รูปตัวหมากจากโฟลเดอร์ design/ -> ฝังเป็น data URI  (key = สี+ชนิด: wK,wM,wR,wN,wS,wP,bK,...)
const PIECE_FILES = {
  wK: 'ขุนขาว.png',  bK: 'ขุนดำ.png',
  wM: 'เม็ดขาว.png', bM: 'เม็ดดำ.png',
  wR: 'เรือขาว.png', bR: 'เรือดำ.png',
  wN: 'ม้าขาว.png',  bN: 'ม้าดำ.png',
  wS: 'โคนขาว.png',  bS: 'โคนดำ.png',
  wP: 'เบี้ยคว่ำขาว.png', bP: 'เบี้ยคว่ำดำ.png',
};
const pieceImg = {};
for (const [k, f] of Object.entries(PIECE_FILES)) {
  try {
    pieceImg[k] = 'data:image/png;base64,' + readFileSync(join(ROOT, 'design', f)).toString('base64');
  } catch (e) {
    console.warn(`  ! หา design/${f} ไม่เจอ — จะ fallback เป็นตัวอักษร`);
  }
}
const pieceImgJson = JSON.stringify(pieceImg);

const template = readFileSync(join(ROOT, 'tools/standalone.template.html'), 'utf8');
const html = template
  .replace('/*__ENGINE_WORKER_SOURCE__*/', () => JSON.stringify(engineWorkerSource))
  .replace('/*__BOOK_JSON__*/', () => bookJson)
  .replace('/*__PIECE_IMAGES__*/', () => pieceImgJson);

mkdirSync(join(ROOT, 'web'), { recursive: true });
writeFileSync(join(ROOT, 'web/index.html'), html);
console.log(`web/index.html   (${(html.length / 1024).toFixed(0)} KB, engine bundle ${(engineWorkerSource.length / 1024).toFixed(0)} KB)`);

// coi-serviceworker + Fairy-Stockfish : สำหรับสมอง "เต็มพลัง" บนโฮสต์สแตติก
const coiSrc = join(ROOT, 'vendor/coi-serviceworker.min.js');
if (existsSync(coiSrc)) {
  copyFileSync(coiSrc, join(ROOT, 'web/coi-serviceworker.min.js'));
  console.log('web/coi-serviceworker.min.js');
} else {
  console.warn('  ! ไม่พบ vendor/coi-serviceworker.min.js');
}
// _headers : ให้ Netlify / Cloudflare Pages เปิด cross-origin isolation เอง (ไม่ต้องพึ่ง SW)
writeFileSync(join(ROOT, 'web/_headers'),
  '/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: credentialless\n');
writeFileSync(join(ROOT, 'web/.nojekyll'), '');   // กัน GitHub Pages ประมวลผลแบบ Jekyll
console.log('web/_headers + web/.nojekyll');

const fairyDir = join(ROOT, 'vendor/fairy');
if (existsSync(fairyDir)) {
  mkdirSync(join(ROOT, 'web/fairy'), { recursive: true });
  for (const f of ['stockfish.js', 'stockfish.wasm', 'stockfish.worker.js', 'AUTHORS', 'Copying.txt']) {
    const s = join(fairyDir, f);
    if (existsSync(s)) copyFileSync(s, join(ROOT, 'web/fairy', f));
  }
  // NNUE net (~48 MB): คัดลอกจาก vendor ถ้ามี; ถ้าไม่มีแต่ web/ มีอยู่แล้วก็ปล่อยไว้
  const netVendor = join(fairyDir, 'makruk.nnue');
  const netWeb = join(ROOT, 'web/fairy/makruk.nnue');
  if (existsSync(netVendor)) copyFileSync(netVendor, netWeb);
  if (!existsSync(netWeb)) {
    console.warn('  ! ไม่มี makruk.nnue — Fairy-Stockfish จะใช้ classical eval (อ่อนกว่า NNUE มาก)');
    console.warn('    ดาวน์โหลด: curl -L -o vendor/fairy/makruk.nnue \\');
    console.warn('      https://github.com/gbtami/Fairy-Stockfish-NNUE-Catalogue/releases/download/networks/makruk-a8c621e24a8c.nnue');
  }
  console.log('web/fairy/  (Fairy-Stockfish WASM — สมองเต็มพลัง)');
} else {
  console.warn('  ! ไม่พบ vendor/fairy/ — ปุ่ม Fairy-Stockfish จะโหลดไม่ได้ (ดู README วิธีเพิ่ม)');
}

// artifact.html : เอาโครง <!DOCTYPE>/<html>/<head>/<body> ออก (Claude Artifact ครอบให้เอง)
const artifact = html
  .replace(/^<!DOCTYPE html>\s*<html[^>]*>\s*<head>\s*/i, '')
  .replace(/\s*<\/head>\s*<body>\s*/i, '\n')
  .replace(/\s*<\/body>\s*<\/html>\s*$/i, '\n');
writeFileSync(join(ROOT, 'web/artifact.html'), artifact);
console.log(`web/artifact.html (${(artifact.length / 1024).toFixed(0)} KB)  — สำหรับ publish เป็น Claude Artifact`);
