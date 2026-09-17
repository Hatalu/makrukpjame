// ============================================================================
//  tools/tune-jame.mjs — "เทรน" JameAI ด้วยการแข่งอัตโนมัติ (gauntlet)
//  ทุก config เจอคู่ต่อสู้เดียวกัน (เอนจิ้นปกติที่ตื้นกว่า) จากชุด opening เดียวกัน
//  แล้วเทียบแต้ม — วิธีเดียวกับที่ทีมเอนจิ้นใช้จูนพารามิเตอร์ (ไม่ใช่ self-play ที่ Makruk เสมอเกือบหมด)
//
//  รัน:  node tools/tune-jame.mjs [--depth 5] [--oppd 2] [--openings 8] [--out data/jame-tune.json]
//        node tools/tune-jame.mjs --grid margin=20,30,45 riskWeight=0.04,0.08
// ============================================================================
import { writeFileSync } from 'node:fs';
import { MakrukEngine } from '../src/engine.js';
import { JameAI, JAME_DEFAULTS } from '../src/jameai.js';
import { legalMoves } from '../src/movegen.js';
import { moveToUci } from '../src/notation.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DEPTH = +opt('--depth', 5), OPPD = +opt('--oppd', 2), OPEN = +opt('--openings', 8), CAP = +opt('--cap', 320);
const OUT = opt('--out', 'data/jame-tune.json');

// ---- grid ของพารามิเตอร์ที่จะลอง ----
let grid = { margin: [20, 30, 45], riskWeight: [0.04, 0.08], convertAt: [150, 250] };
const gi = args.indexOf('--grid');
if (gi >= 0) {
  grid = {};
  for (let i = gi + 1; i < args.length && !args[i].startsWith('--'); i++) {
    const [k, v] = args[i].split('='); grid[k] = v.split(',').map(Number);
  }
}
function combos(g) {
  const keys = Object.keys(g); const out = [];
  (function rec(i, cur) {
    if (i === keys.length) { out.push({ ...cur }); return; }
    for (const v of g[keys[i]]) { cur[keys[i]] = v; rec(i + 1, cur); }
  })(0, {});
  return out;
}

function randomPosition(p, seed) {
  const e = new MakrukEngine(); let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < p; i++) {
    const lm = legalMoves(e.board); if (!lm.length || e.isGameOver().over) break;
    e.board.makeMove(lm[Math.floor(rnd() * lm.length)]);
  }
  return e.board.fen();
}
function playGame(pf, of, fen, white) {
  const g = new MakrukEngine(); g.setFen(fen);
  let over = g.isGameOver(), plies = 0;
  while (!over.over && plies < CAP) {
    const mine = (g.board.turn === 0) === white;
    const uci = mine ? pf(g.board.fen()) : of(g.board.fen());
    const mv = uci && legalMoves(g.board).find((x) => moveToUci(x) === uci); if (!mv) break;
    g.board.makeMove(mv); plies++; over = g.isGameOver();
  }
  if (!over.over) return 0.5;
  if (over.result === '1/2-1/2') return 0.5;
  return ((over.result === '1-0') === white) ? 1 : 0;
}
function makeOpp() {
  const e = new MakrukEngine(); e.searcher.contempt = 0;
  return (f) => { e.setFen(f); const r = e.searcher.think(e.board, { depth: OPPD }); return r.move ? moveToUci(r.move) : null; };
}
function makeJame(params) {
  const e = new MakrukEngine(); e.searcher.contempt = 0;
  const j = params ? new JameAI(e, params) : null;
  return (f) => {
    e.setFen(f);
    if (j) { const r = j.pickMove({ depth: DEPTH }); return r.move ? moveToUci(r.move) : null; }
    const r = e.searcher.think(e.board, { depth: DEPTH }); return r.move ? moveToUci(r.move) : null;
  };
}

const opens = []; for (let i = 0; i < OPEN; i++) opens.push(randomPosition(4 + (i % 5), 0xA11CE + i * 104729));
const N = opens.length * 2;
const results = [];
function evalConfig(name, params) {
  const pf = makeJame(params), of = makeOpp();
  let pts = 0, w = 0, d = 0, l = 0, n = 0;
  for (const fen of opens) for (const white of [true, false]) {
    const r = playGame(pf, of, fen, white); pts += r; n++;
    if (r === 1) w++; else if (r === 0) l++; else d++;
    process.stdout.write(`   ${name}: ${n}/${N}\r`);
  }
  process.stdout.write('                                        \r');
  const pct = 100 * pts / n;
  console.log(`${name.padEnd(34)} ชนะ ${String(w).padStart(2)} เสมอ ${String(d).padStart(2)} แพ้ ${String(l).padStart(2)}  ${pct.toFixed(1)}%`);
  results.push({ name, params, w, d, l, pct: +pct.toFixed(1) });
  return pct;
}

console.log(`gauntlet: ลึก ${DEPTH} vs คู่ต่อสู้ลึก ${OPPD} · ${N} เกม/config · ${combos(grid).length} configs\n`);
const base = evalConfig('เอนจิ้นปกติ (baseline)', null);
const cands = combos(grid);
for (const c of cands) {
  const name = 'JameAI ' + Object.entries(c).map(([k, v]) => k + '=' + v).join(' ');
  evalConfig(name, c);
}
const best = results.slice(1).sort((a, b) => b.pct - a.pct)[0];
console.log(`\nดีสุด: ${best.name}  (${best.pct}% vs baseline ${base.toFixed(1)}%)`);
writeFileSync(OUT, JSON.stringify({ depth: DEPTH, oppd: OPPD, games: N, baseline: base, results, best, defaults: JAME_DEFAULTS, at: new Date().toISOString() }, null, 1));
console.log('บันทึก ->', OUT);
