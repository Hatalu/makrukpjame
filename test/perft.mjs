// ============================================================================
//  Engine MakrukThai  -  test/perft.mjs
//  ทดสอบความถูกต้องของ move generation + make/undo + zobrist
//  รัน:  node "test/perft.mjs"
//
//  ค่าอ้างอิงด้านล่างถูกยืนยันด้วย generator อิสระคนละชุด (คนละ board representation)
//  ตรงกันทุกค่า จึงใช้เป็น ground truth ได้
// ============================================================================
import { Board } from '../src/board.js';
import { legalMoves, perft } from '../src/movegen.js';
import { START_FEN } from '../src/constants.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

const CASES = [
  {
    fen: START_FEN,
    name: 'ตำแหน่งเริ่มเกม',
    expect: [23, 529, 12012, 273026, 6223994],
  },
  {
    fen: 'r3k2r/2ms1s2/ppn1ppnp/2ppP1p1/3P1P2/PPPSMNPP/5S2/RN1K3R w - - 0 1',
    name: 'ม้าขวาทิ่มสูง (กลางเกม)',
    expect: [33, 1255, 40336, 1464122],
  },
  {
    fen: 'r6r/2snn1k1/pppmsppp/3pp3/4PP1P/PPPPMNP1/2SNS3/R2K1R2 w - - 0 1',
    name: 'ม้าขวากล้ามปูเจอม้าเทียมคู่กลาง',
    expect: [29, 1109, 32708, 1150800],
  },
  {
    fen: '2N5/1kMK4/p7/n2Ss3/4p2P/2r5/8/R7 w - - 0 1',
    name: 'หมากกล 1-1',
    expect: [29, 591, 15550, 314054],
  },
];

console.log('\n[1] perft (เทียบค่าอ้างอิง)');
for (const c of CASES) {
  console.log(`\n  ${c.name}`);
  const b = new Board(c.fen);
  const before = b.fen();
  for (let d = 1; d <= c.expect.length; d++) {
    const maxAssert = 4;
    const t0 = performance.now();
    const n = perft(b, d);
    const ms = performance.now() - t0;
    if (d <= maxAssert || d === c.expect.length) {
      ok(`perft(${d}) = ${c.expect[d - 1]}`, n === c.expect[d - 1],
        `-> ${n}  (${ms.toFixed(0)} ms, ${ms > 0 ? Math.round(n / (ms / 1000)).toLocaleString() : '-'} nps)`);
    }
  }
  ok('กระดานคงสภาพหลัง perft', b.fen() === before, `-> ${b.fen()}`);
}

console.log('\n[2] make/undo consistency (สุ่มเดิน ~4000 ตา, เทียบ zobrist กับ recompute)');
{
  const b = new Board(START_FEN);
  let seed = 987654321;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let bad = 0;
  const stack = [];
  for (let i = 0; i < 4000; i++) {
    const moves = legalMoves(b);
    if (moves.length === 0 || b.halfmove >= 120) {
      const back = 1 + (rnd() * 6 | 0);
      for (let k = 0; k < back && stack.length; k++) b.undoMove(stack.pop());
      continue;
    }
    const m = moves[(rnd() * moves.length) | 0];
    const beforeFen = b.fen(), beforeLo = b.keyLo, beforeHi = b.keyHi;
    b.makeMove(m);
    const chk = new Board(b.fen());
    if ((chk.keyLo | 0) !== (b.keyLo | 0) || (chk.keyHi | 0) !== (b.keyHi | 0)) bad++;
    b.undoMove(m);
    if (b.fen() !== beforeFen || b.keyLo !== beforeLo || b.keyHi !== beforeHi) bad++;
    b.makeMove(m);
    stack.push(m);
  }
  ok('ไม่มี mismatch ของ zobrist / FEN', bad === 0, `-> bad=${bad}`);
}

console.log(`\n=== ผล: ${pass} ผ่าน / ${fail} ล้มเหลว ===`);
process.exit(fail ? 1 : 0);
