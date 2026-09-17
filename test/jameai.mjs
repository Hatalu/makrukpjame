// ============================================================================
//  test/jameai.mjs — ตรวจบุคลิก JameAI
//    [1] property: ตาที่เลือกต้องไม่เคย "เสียเปรียบ" เกิน margin เทียบตาดีสุด
//    [2] เจอทางแหกที่คุ้ม -> ต้องกล้าเล่น
//    [3] เจอทางแหกที่ไม่คุ้ม -> ต้องไม่เล่น
//    [4] เกลียดเสมอ: contempt ต้องดันให้หนีเสมอ
//    [5] แข่งกันเอง JameAI vs เอนจิ้นปกติ (ความลึกเท่ากัน) — วัดว่าไม่อ่อนลง
//  รัน:  node test/jameai.mjs  [--games N] [--depth D]
// ============================================================================
import { MakrukEngine } from '../src/engine.js';
import { JameAI, riskScore, JAME_DEFAULTS } from '../src/jameai.js';
import { legalMoves } from '../src/movegen.js';
import { moveToUci } from '../src/notation.js';
import { START_FEN } from '../src/constants.js';

const args = process.argv.slice(2);
const argv = (k, d) => { const i = args.indexOf(k); return i >= 0 ? +args[i + 1] : d; };
const GAMES = argv('--games', 30);
const DEPTH = argv('--depth', 5);

let pass = 0, fail = 0;
const ok = (c, name, extra = '') => {
  if (c) { pass++; console.log('  ok   ' + name + (extra ? ' -> ' + extra : '')); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' -> ' + extra : '')); }
};
const head = (s) => console.log('\n' + s);

// ---------------------------------------------------------------- utilities
/** คะแนนของตา m (มุมมองฝ่ายที่เดิน) จากการค้นหาแบบเป็นกลาง */
function scoreOf(eng, m, depth) {
  eng.board.makeMove(m);
  const saved = eng.searcher.contempt;
  eng.searcher.contempt = 0;
  const r = eng.searcher.think(eng.board, { depth });
  eng.searcher.contempt = saved;
  eng.board.undoMove(m);
  return -r.score;
}

/** เดินสุ่มจากตำแหน่งเริ่มเกม n ตา เพื่อให้ได้ตำแหน่งกลางเกมหลากหลาย */
function randomPosition(plies, seed) {
  const eng = new MakrukEngine();
  let s = seed >>> 0 || 1;
  const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  for (let i = 0; i < plies; i++) {
    const lm = legalMoves(eng.board);
    if (!lm.length || eng.isGameOver().over) break;
    eng.board.makeMove(lm[Math.floor(rnd() * lm.length)]);
  }
  return eng.board.fen();
}

// ------------------------------------------- [1] property: ไม่เดินตาที่แย่กว่า
head('[1] property — ตาที่ JameAI เลือกต้องไม่แย่กว่าตาดีสุดเกิน margin');
{
  const D = 4;
  let worst = 0, checked = 0, sacs = 0;
  for (let i = 0; i < 24; i++) {
    const fen = randomPosition(8 + (i % 14), 0xC0FFEE + i * 7919);
    const eng = new MakrukEngine();
    eng.setFen(fen);
    if (eng.isGameOver().over) continue;

    const jame = new JameAI(eng);
    const r = jame.pickMove({ depth: D });
    if (!r.move) continue;

    // ตาดีสุดแบบเป็นกลาง (contempt = 0) ที่ความลึกเดียวกัน
    const plain = new MakrukEngine();
    plain.setFen(fen);
    plain.searcher.contempt = 0;
    const pb = plain.searcher.think(plain.board, { depth: D });

    const sJame = scoreOf(eng, r.move, D - 1);
    const sBest = scoreOf(plain, pb.move, D - 1);
    const drop = sBest - sJame;
    if (drop > worst) worst = drop;
    checked++;
    if (r.jame && r.jame.mode === 'sacrifice') sacs++;
  }
  // margin (35) + ความคลาดเคลื่อนจากการค้นหาคนละราก เผื่อไว้ที่ 120cp
  ok(checked >= 15, 'ตรวจได้หลายตำแหน่ง', checked + ' ตำแหน่ง');
  ok(worst <= 120, 'ตาที่เลือกไม่เคยแย่กว่าตาดีสุดอย่างมีนัย', 'แย่สุด ' + worst + 'cp');
  console.log('       (เลือกทางแหก ' + sacs + '/' + checked + ' ตำแหน่ง)');
}

// ------------------------------------------------ [2] กล้าแหกเมื่อคุ้มจริง
head('[2] รู้จักการเสียสละ + กล้าเล่นเมื่อคำนวณแล้วดีกว่า');
{
  // 2a) การทิ้งเรือให้ขุนกินฟรี ต้องถูกให้คะแนนว่า "แหก" (risk สูง)
  //     ดำ: ขุน b8, เม็ด c7   ขาว: เรือ a1, ขุน h1   -> a1a8+ ขุนกินได้ = ทิ้งเรือ
  const eng = new MakrukEngine();
  eng.setFen('1k6/2m5/8/8/8/8/8/R6K w - - 0 1');
  const sac = legalMoves(eng.board).find((m) => moveToUci(m) === 'a1a8');
  const rs = sac ? riskScore(eng.board, sac) : { risk: 0, detail: {} };
  ok(rs.risk >= JAME_DEFAULTS.minRisk, 'ให้คะแนนความแหกกับการทิ้งเรือ', 'risk=' + Math.round(rs.risk) + ' sacrificed=' + Math.round(rs.detail.sacrifice || 0));
  // 2b) ...แต่ทิ้งฟรีแบบนี้ไม่คุ้ม -> ต้องไม่เล่น
  const j = new JameAI(eng);
  const r = j.pickMove({ depth: 5 });
  ok(r.bestMove !== 'a1a8', 'ไม่ทิ้งเรือฟรี', 'เลือก ' + r.bestMove + ' ' + JSON.stringify(r.jame));

  // 2c) ตรรกะการเลือกบนผล MultiPV (แบบที่ Fairy-Stockfish ส่งมา) — deterministic
  //     ตำแหน่ง: ขาวมีตาเงียบ a1f1 และตาทิ้งเรือ a1a8 (ขุนกินได้)
  const e3 = new MakrukEngine(); e3.setFen('1k6/2m5/8/8/8/8/8/R6K w - - 0 1');
  const j3 = new JameAI(e3);
  // ลึก 16: ทิ้งเรือแย่กว่าตาดีสุด 20cp (ในกรอบ margin 30) -> ต้องกล้าเล่น
  const deepOk = j3.pickFromLines([{ uci: 'a1f1', score: 40, depth: 16 }, { uci: 'a1a8', score: 20, depth: 16 }]);
  ok(deepOk && deepOk.uci === 'a1a8' && deepOk.jame.mode === 'sacrifice',
     'ลึก 16: ทิ้งเรือที่แย่กว่าแค่ 20cp -> กล้าเล่น', JSON.stringify(deepOk && deepOk.jame));
  // ลึก 16: ทิ้งเรือแย่กว่า 80cp (เกิน margin) -> ไม่เล่น
  const deepNo = j3.pickFromLines([{ uci: 'a1f1', score: 40, depth: 16 }, { uci: 'a1a8', score: -40, depth: 16 }]);
  ok(deepNo && deepNo.uci === 'a1f1', 'ลึก 16: ทิ้งเรือที่เสียเปรียบ 80cp -> ไม่เล่น', deepNo && deepNo.uci);
  // ลึก 16 แต่กำลังชนะ (+400): ห้ามเสียแต้มเลย -> ไม่เล่นทางแหกที่แย่กว่า 10cp
  const winNo = j3.pickFromLines([{ uci: 'a1f1', score: 400, depth: 16 }, { uci: 'a1a8', score: 390, depth: 16 }]);
  ok(winNo && winNo.uci === 'a1f1', 'กำลังชนะ: ไม่โชว์ลีลา เก็บเกมให้จบ', winNo && winNo.uci);
  // ลึก 4 (ตื้น): ตาแหกเท่ากันเป๊ะก็ยังไม่เล่น (ต้องดีกว่าชัด)
  const shallowNo = j3.pickFromLines([{ uci: 'a1f1', score: 40, depth: 4 }, { uci: 'a1a8', score: 40, depth: 4 }]);
  ok(shallowNo && shallowNo.uci === 'a1f1', 'ตื้น: คะแนนเท่ากันยังไม่ยอมทิ้งหมาก', shallowNo && shallowNo.uci);
  // ตื้นแต่ทิ้งแล้วดีกว่าชัด (+60) -> เล่น
  const shallowYes = j3.pickFromLines([{ uci: 'a1f1', score: 40, depth: 4 }, { uci: 'a1a8', score: 100, depth: 4 }]);
  ok(shallowYes && shallowYes.uci === 'a1a8', 'ตื้นแต่คำนวณแล้วดีกว่าชัด -> เล่น', shallowYes && shallowYes.uci);
}

// ------------------------------------------------ [3] ไม่แหกเมื่อคำนวณแล้วแย่
head('[3] เจอการเสียสละที่ไม่คุ้ม -> ต้องไม่เล่น');
{
  // ขาวได้เปรียบเรือ ไม่มีเหตุผลต้องทิ้งอะไร; ตาทิ้งเรือให้เบี้ยกินคือขาดทุนล้วน
  //  ดำ: ขุน e8, เบี้ย d6  ขาว: ขุน e1, เรือ c5, เม็ด e2
  const fen = '4k3/8/3p4/2R5/8/8/4M3/4K3 w - - 0 1';
  const eng = new MakrukEngine();
  eng.setFen(fen);
  const jame = new JameAI(eng);
  const r = jame.pickMove({ depth: 6 });

  // เรือต้องไม่ไปยืนให้เบี้ย d6 กินฟรี (c5c6 / c5d5 คือทิ้งเรือ)
  const dumb = ['c5c6', 'c5d5'];
  ok(!dumb.includes(r.bestMove), 'ไม่ทิ้งเรือให้เบี้ยกินฟรี', 'เลือก ' + r.bestMove);
  ok(r.jame.mode !== 'sacrifice' || r.jame.score >= JAME_DEFAULTS.minEdge,
     'ถ้าเลือกทางแหก ต้องผ่านเงื่อนไขได้เปรียบ', JSON.stringify(r.jame));
}

// ------------------------------------------------------ [4] เกลียดเสมอจริง
head('[4] contempt — ต้องหลีกเลี่ยงเส้นทางที่จบด้วยเสมอ');
{
  const eng = new MakrukEngine();
  eng.setFen(START_FEN);

  // ตรวจเชิงกลไก: contempt > 0 ทำให้คะแนนเสมอติดลบสำหรับฝ่ายเรา
  const s = eng.searcher;
  s.board = eng.board; s.rootTurn = eng.board.turn;
  s.contempt = 50;
  const drawUs = s._drawScore();                     // ตาเรา
  const one = legalMoves(eng.board)[0];
  eng.board.makeMove(one);
  const drawThem = s._drawScore();                   // ตาเขา
  eng.board.undoMove(one);
  ok(drawUs === -50, 'เสมอ = -contempt เมื่อถึงตาเรา', 'ได้ ' + drawUs);
  ok(drawThem === 50, 'เสมอ = +contempt เมื่อถึงตาเขา (negamax)', 'ได้ ' + drawThem);
  s.contempt = 0;
}

// ------------------------------- [5] แข่งกันเอง: JameAI vs เอนจิ้นปกติ
head('[5] แข่ง ' + GAMES + ' เกม (ความลึก ' + DEPTH + ') — JameAI vs เอนจิ้นปกติ');
{
  const res = playMatch(GAMES, DEPTH);
  const { w, l, d, jameDraws, plainDraws, sacMoves, totalMoves } = res;
  const score = w + d / 2;
  const pct = (100 * score / (w + l + d)).toFixed(1);
  console.log(`       JameAI ชนะ ${w} · แพ้ ${l} · เสมอ ${d}   (${pct}%)`);
  console.log(`       เดินทางแหก ${sacMoves}/${totalMoves} ตา (${(100 * sacMoves / Math.max(1, totalMoves)).toFixed(1)}%)`);
  ok(w + l + d === GAMES, 'เล่นครบทุกเกม', `${w + l + d}/${GAMES}`);
  // เกณฑ์: ต้องไม่อ่อนลงอย่างชัดเจน (แพ้ขาดถือว่าไม่ผ่าน)
  ok(score >= (w + l + d) * 0.40, 'ไม่อ่อนกว่าเอนจิ้นปกติอย่างมีนัย', pct + '%');
  console.log('       (ที่ความลึก ' + DEPTH + ' JameAI จะแหกเฉพาะเมื่อพิสูจน์ได้ว่าดีกว่าชัด — ตื้นมากอาจเป็น 0 ตา ซึ่งถูกต้อง)');
}

function playMatch(games, depth) {
  let w = 0, l = 0, d = 0, sacMoves = 0, totalMoves = 0;
  for (let g = 0; g < games; g++) {
    const jameIsWhite = (g % 2 === 0);
    const openFen = randomPosition(4 + (g % 5), 0xBEEF + g * 104729);
    const eng = new MakrukEngine();
    eng.setFen(openFen);
    const jame = new JameAI(eng);

    const plain = new MakrukEngine();
    plain.searcher.contempt = 0;

    let over = eng.isGameOver();
    let plies = 0;
    while (!over.over && plies < 160) {
      const whiteToMove = eng.board.turn === 0;
      const useJame = (whiteToMove === jameIsWhite);
      let mv;
      if (useJame) {
        const r = jame.pickMove({ depth });
        mv = r.move;
        totalMoves++;
        if (r.jame && (r.jame.mode === 'sacrifice' || r.jame.mode === 'antidraw')) sacMoves++;
      } else {
        plain.setFen(eng.board.fen());
        const r = plain.searcher.think(plain.board, { depth });
        mv = r.move && legalMoves(eng.board).find((x) => moveToUci(x) === moveToUci(r.move));
      }
      if (!mv) break;
      eng.board.makeMove(mv);
      plies++;
      over = eng.isGameOver();
    }
    if (!over.over) { d++; continue; }
    if (over.result === '1/2-1/2') d++;
    else {
      const whiteWon = over.result === '1-0';
      if (whiteWon === jameIsWhite) w++; else l++;
    }
    process.stdout.write('       เกม ' + (g + 1) + '/' + games + '\r');
  }
  process.stdout.write('                                   \r');
  return { w, l, d, sacMoves, totalMoves };
}

console.log(`\n=== ผล: ${pass} ผ่าน / ${fail} ล้มเหลว ===`);
process.exit(fail ? 1 : 0);
