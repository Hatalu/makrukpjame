// ============================================================================
//  Engine MakrukThai  -  tools/import-pgn.mjs
//  ดูดไฟล์ .pgn (เช่น เกมที่ GodratSF+ เล่นไว้) มาทำเป็น "ตำราเปิดหมาก" JSON
//
//  วิธีใช้:
//    node "tools/import-pgn.mjs" <โฟลเดอร์หรือไฟล์ .pgn> [--out book.json] [--maxply 24] [--minfreq 1]
//
//  ตัวอย่าง (จากโฟลเดอร์ของผู้ใช้):
//    node "tools/import-pgn.mjs" "../หมากรุกไทย" --out data/book.godratsf.json --maxply 20
//
//  ผลลัพธ์เป็น JSON: { "<zobristKeyLo>:<keyHi>": [ { "uci": "...", "weight": n }, ... ] }
//  โหลดเข้าเอนจิ้นด้วย:  new MakrukEngine({ book: JSON.parse(fs.readFileSync(...)) })
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Board } from '../src/board.js';
import { OpeningBook } from '../src/book.js';
import { sanToMove, moveToUci } from '../src/notation.js';
import { START_FEN } from '../src/constants.js';

// ---- อ่าน args ---------------------------------------------------------
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('ใช้:  node "tools/import-pgn.mjs" <path .pgn หรือโฟลเดอร์> [--out file.json] [--maxply N] [--minfreq N]');
  process.exit(1);
}
const input = args[0];
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : def;
};
const outPath = opt('out', 'data/book.imported.json');
const maxPly = parseInt(opt('maxply', '24'), 10);
const minFreq = parseInt(opt('minfreq', '1'), 10);

// ---- รวบรวมไฟล์ .pgn -------------------------------------------------
function collectPgn(path) {
  const st = statSync(path);
  if (st.isFile()) return extname(path).toLowerCase() === '.pgn' ? [path] : [];
  const out = [];
  for (const name of readdirSync(path)) {
    try { out.push(...collectPgn(join(path, name))); } catch { /* ignore */ }
  }
  return out;
}
const files = collectPgn(input);
console.log(`พบไฟล์ .pgn : ${files.length} ไฟล์`);

// ---- แยกเกม + ดึง movetext -----------------------------------------
function splitGames(text) {
  // แต่ละเกมเริ่มด้วยบล็อก tag [ ... ] ต่อด้วย movetext
  const games = [];
  const re = /(\[[\s\S]*?\])\s*\n\s*\n([\s\S]*?)(?=\n\[Event |\s*$)/g;
  let m;
  while ((m = re.exec(text))) games.push({ tags: m[1], moves: m[2] });
  if (games.length === 0 && text.trim()) games.push({ tags: '', moves: text });
  return games;
}

function tokenizeMoves(movetext) {
  return movetext
    .replace(/\{[^}]*\}/g, ' ')       // คอมเมนต์
    .replace(/;[^\n]*/g, ' ')          // คอมเมนต์บรรทัด
    .replace(/\([^()]*\)/g, ' ')       // variation ชั้นเดียว
    .replace(/\$\d+/g, ' ')            // NAG
    .replace(/\d+\.(\.\.)?/g, ' ')     // เลขตา
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ---- สร้าง book ---------------------------------------------------
const book = new OpeningBook();
let games = 0, ok = 0, plies = 0, skipped = 0;

for (const file of files) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { continue; }
  for (const g of splitGames(text)) {
    // เฉพาะ variant makruk (ถ้ามีระบุ)
    if (/\[Variant\s+"([^"]+)"\]/i.test(g.tags)) {
      const v = g.tags.match(/\[Variant\s+"([^"]+)"\]/i)[1].toLowerCase();
      if (v && !v.includes('makruk')) { skipped++; continue; }
    }
    games++;
    const b = new Board(START_FEN);
    const toks = tokenizeMoves(g.moves);
    let applied = 0;
    for (const tok of toks) {
      if (applied >= maxPly) break;
      const mv = sanToMove(b, tok);
      if (!mv) break; // เจอ token ที่แปลงไม่ได้ -> หยุดเกมนี้
      book.addEntry(b, moveToUci(mv), 1);
      b.makeMove(mv);
      applied++;
      plies++;
    }
    if (applied > 0) ok++;
  }
}

// ---- ตัดหมากที่พบน้อยกว่า minFreq -------------------------------
let positions = 0, moves = 0;
const json = {};
for (const [key, arr] of book.map) {
  const kept = arr.filter((e) => e.weight >= minFreq);
  if (kept.length === 0) continue;
  json[key] = kept.sort((a, c) => c.weight - a.weight);
  positions++;
  moves += kept.length;
}

writeFileSync(outPath, JSON.stringify(json));
console.log(`เกมที่อ่าน  : ${games}  (ข้าม non-makruk ${skipped})`);
console.log(`เกมที่ใช้ได้ : ${ok}   รวม ${plies} ply`);
console.log(`ตำแหน่งใน book : ${positions}   หมากเดินรวม : ${moves}`);
console.log(`เขียนไฟล์: ${outPath}`);
