// ============================================================================
//  Engine MakrukThai  -  test/rules.mjs
//  ตรวจกติกาเฉพาะของหมากรุกไทย + การค้นหา + การนับ
//  รัน:  node "test/rules.mjs"
// ============================================================================
import { Board } from '../src/board.js';
import { legalMoves } from '../src/movegen.js';
import { moveToUci, moveToSan, uciToMove } from '../src/notation.js';
import { MakrukEngine } from '../src/engine.js';
import { describeCounting, countingResult } from '../src/counting.js';
import { evaluate, insufficientMaterial } from '../src/evaluate.js';
import { MATE_IN_MAX } from '../src/constants.js';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name} ${extra}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const uset = (b) => new Set(legalMoves(b).map(moveToUci));

// ---- 1) โคน: เฉียง 4 + ตรงหน้า 1 (5 ช่องจากกลางกระดานโล่ง) --------------
console.log('\n[1] การเดินของโคน (Khon / silver)');
{
  const b = new Board('4k3/8/8/8/3S4/8/8/4K3 w - - 0 1'); // โคนขาว d4
  const s = uset(b);
  const want = ['d4c5', 'd4e5', 'd4c3', 'd4e3', 'd4d5']; // 4 เฉียง + ตรงหน้า(เหนือ)
  ok('โคนขาว d4 เดินได้ 5 ช่องตามกติกา',
    want.every((m) => s.has(m)) && !s.has('d4d3') && !s.has('d4d4'),
    `-> ${[...s].filter((m) => m.startsWith('d4')).sort().join(',')}`);
}
{
  const b = new Board('4k3/8/8/3s4/8/8/8/4K3 b - - 0 1'); // โคนดำ d5
  const s = uset(b);
  ok('โคนดำ d5 เดินตรงหน้า = ใต้ (d5d4)', s.has('d5d4') && !s.has('d5d6'),
    `-> ${[...s].filter((m) => m.startsWith('d5')).sort().join(',')}`);
}

// ---- 2) เม็ด: เฉียง 1 ช่องเท่านั้น ------------------------------------
console.log('\n[2] การเดินของเม็ด (Met / ferz)');
{
  const b = new Board('4k3/8/8/8/3M4/8/8/4K3 w - - 0 1');
  const s = [...uset(b)].filter((m) => m.startsWith('d4')).sort();
  ok('เม็ด d4 เดินได้ 4 เฉียงเท่านั้น',
    JSON.stringify(s) === JSON.stringify(['d4c3', 'd4c5', 'd4e3', 'd4e5']), `-> ${s.join(',')}`);
}

// ---- 3) เบี้ย: เดินตรง 1 (ห้าม 2), เลื่อนขั้นเป็นเม็ดที่ rank 6 --------
console.log('\n[3] การเดินและเลื่อนขั้นของเบี้ย (Bia)');
{
  const b = new Board('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1'); // เบี้ยขาว e2
  const s = uset(b);
  ok('เบี้ย e2 เดินได้แค่ 1 ช่อง (e2e3) ห้าม e2e4', s.has('e2e3') && !s.has('e2e4'));
}
{
  const b = new Board('4k3/8/8/4P3/8/8/8/4K3 w - - 0 1'); // เบี้ยขาว e5 -> e6 เลื่อนขั้น
  const mv = uciToMove(b, 'e5e6');
  ok('เบี้ยถึง rank 6 เลื่อนขั้นเป็นเม็ด (มี promotion flag)', !!mv && mv.promotion !== 0);
  ok('SAN ของการเลื่อนขั้นคือ e6=M', mv && moveToSan(b, mv) === 'e6=M', `-> ${mv && moveToSan(b, mv)}`);
  b.makeMove(mv);
  ok('หลังเลื่อนขั้น มีเม็ดขาวบน e6', b.fen().startsWith('4k3/8/4M3'), `-> ${b.fen()}`);
}
{
  const b = new Board('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
  ok('ไม่มีการรุกรับ (castling) ในหมากรุกไทย',
    ![...uset(b)].some((m) => m === 'e1g1' || m === 'e1c1'));
}

// ---- 4) อับ (stalemate) = เสมอ ------------------------------------
console.log('\n[4] อับ (stalemate) = เสมอ');
{
  // ขุนดำ a8, ขุนขาว c7, เม็ดขาว b6 -> ดำไม่มีทางเดินแต่ไม่ถูกรุก
  const b = new Board('k7/2K5/1M6/8/8/8/8/8 b - - 0 1');
  const eng = new MakrukEngine();
  eng.setFen(b.fen());
  const v = eng.isGameOver();
  ok('ตรวจพบอับ -> เสมอ', v.over && v.reason === 'stalemate', `-> ${JSON.stringify(v)}`);
}

// ---- 5) รุกจน (checkmate) ------------------------------------------
console.log('\n[5] รุกจน (checkmate)');
{
  // ขุนดำ a8 ถูกเรือ h8 รุกจน โดยขุนขาว b6 คุมช่องหนี a7/b7
  const b = new Board('k6R/8/1K6/8/8/8/8/8 b - - 0 1');
  const eng = new MakrukEngine();
  eng.setFen(b.fen());
  const v = eng.isGameOver();
  ok('ตรวจพบรุกจน -> ฝ่ายขาวชนะ', v.over && v.reason === 'checkmate' && v.winner === 'white',
    `-> ${JSON.stringify(v)}`);
}

// ---- 6) เอนจิ้นหาทางรุกจน 1 ตา ----------------------------------
console.log('\n[6] เอนจิ้นหา mate-in-1');
{
  const eng = new MakrukEngine();
  eng.setFen('6k1/R7/6K1/8/8/8/8/8 w - - 0 1'); // Ra7-a8#
  const r = eng.think({ depth: 4, movetime: 2000 });
  ok('พบหมากรุกจน Ra8#', r.bestMove === 'a7a8' && r.score >= MATE_IN_MAX,
    `-> ${r.bestMove} score=${r.score}`);
}

// ---- 7) เอนจิ้นเล่นเปิดเกมได้จริง ไม่แพ้กติกา -----------------------
console.log('\n[7] เอนจิ้นเดินเกมสั้น ๆ ได้โดยไม่ผิดกติกา');
{
  const eng = new MakrukEngine({ skill: 20 });
  let moves = 0;
  for (let i = 0; i < 40; i++) {
    const v = eng.isGameOver();
    if (v.over) break;
    const g = eng.go({ movetime: 60 });
    if (!g) break;
    moves++;
  }
  ok('เดินได้อย่างน้อย 20 ตาโดยไม่ throw', moves >= 20, `-> เดินไป ${moves} ตา, FEN=${eng.fen()}`);
}

// ---- 8) กฎการนับ: เรือ 1 ตัว ปะทะขุนเปล่า -> เป้า 16 -----------------
console.log('\n[8] กฎการนับศักดิ์หมาก (เรือ 1 ตัว -> 16)');
{
  const b = new Board('7k/8/8/8/8/8/8/R3K3 w - - 0 1');
  ok('เริ่มนับศักดิ์หมากทันที', b.counting.active === 'piece', `-> ${JSON.stringify(b.counting)}`);
  ok('เป้าการนับ = 16', b.counting.limit === 16, `-> limit=${b.counting.limit}`);
  const start = b.counting.count;
  // เดินเรือไปมาให้ครบเป้า
  const shuffle = ['a1a2', 'h8g8', 'a2a1', 'g8h8'];
  let drew = false;
  for (let i = 0; i < 40 && !drew; i++) {
    const u = shuffle[i % 4];
    const mv = uciToMove(b, u);
    if (!mv) { ok('shuffle move valid', false, `-> ${u} @ ${b.fen()}`); break; }
    b.makeMove(mv);
    if (countingResult(b) === 'draw') drew = true;
  }
  ok('พอถึงเป้า -> เสมอด้วยการนับ', drew, `-> count=${b.counting.count}/${b.counting.limit}`);
}

// ---- 9) กำลังไม่พอรุกจน -> เสมอ --------------------------------
console.log('\n[9] insufficient material');
{
  ok('ขุน+ม้า ปะทะ ขุน = เสมอ', insufficientMaterial(new Board('4k3/8/8/8/8/8/8/3NK3 w - - 0 1')));
  ok('ขุน+เรือ ปะทะ ขุน = ไม่เสมอ', !insufficientMaterial(new Board('4k3/8/8/8/8/8/8/3RK3 w - - 0 1')));
  ok('ขุน+โคน+โคน ปะทะ ขุน = ไม่เสมอ (รุกจนได้)',
    !insufficientMaterial(new Board('4k3/8/8/8/8/8/8/2SSK3 w - - 0 1')));
}

// ---- 10) เม็ดแข็งกว่าโคน? โคนแข็งกว่าเม็ด (ค่าเริ่มต้น) --------------
console.log('\n[10] ทิศทางค่าประเมิน');
{
  const withRook = evaluate(new Board('4k3/8/8/8/8/8/8/R3K3 w - - 0 1'));
  const withKhon = evaluate(new Board('4k3/8/8/8/8/8/8/3SK3 w - - 0 1'));
  ok('ขาวมีเรือ -> คะแนนบวกมาก', withRook > 300, `-> ${withRook}`);
  ok('เรือ > โคน ในการประเมิน', withRook > withKhon, `-> rook=${withRook} khon=${withKhon}`);
}

console.log(`\n=== ผล: ${pass} ผ่าน / ${fail} ล้มเหลว ===`);
process.exit(fail ? 1 : 0);
