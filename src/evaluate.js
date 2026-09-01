// ============================================================================
//  Engine MakrukThai  -  evaluate.js
//  ฟังก์ชันประเมินตำแหน่ง (static evaluation)  -  มุมมองฝ่ายขาวเป็นบวก
//
//  องค์ประกอบ:
//    - กำลังหมาก (material)
//    - piece-square tables (แยก middlegame / endgame ที่ตัวขุนและเบี้ย)
//    - การเคลื่อนที่ (mobility)
//    - โครงเบี้ย: เบี้ยซ้อน / เบี้ยโดด / เบี้ยผ่าน (สำคัญมากเพราะเลื่อนขั้นที่ rank 6)
//    - เรือคุมแถวเปิด / เรือแถว 6-7
//    - ความปลอดภัยของขุน (โล่ + ตัวจู่โจมรอบขุน)
//    - คู่โคน
//    - ปรับลดคะแนนเมื่อกำลังไม่พอรุกจน
// ============================================================================
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, KING,
  mk, pcType, pcColor, fileOf, rankOf, flipSq,
  PIECE_VALUE, PHASE_W, PHASE_MAX, TEMPO,
} from './constants.js';
import {
  KNIGHT_MOVES, KING_MOVES, MET_MOVES, KHON_MOVES, ROOK_RAYS,
  squareAttackedBy,
} from './tables.js';

// ---- piece-square tables (มุมมองขาว, index 0..63, rank0 = แถวหลังขาว) --------
function buildPst() {
  const mg = [null, [], [], [], [], [], []];
  const eg = [null, [], [], [], [], [], []];
  const centerDist = (sq) => Math.abs(3.5 - fileOf(sq)) + Math.abs(3.5 - rankOf(sq));

  for (let s = 0; s < 64; s++) {
    const f = fileOf(s), r = rankOf(s), cd = centerDist(s);

    // เบี้ย: หนุนให้ดันขึ้น + คุมกลาง (เบี้ยจะไม่อยู่ rank 5+ เพราะเลื่อนขั้นแล้ว)
    const pawnAdv = [0, 0, 6, 16, 34, 0, 0, 0][r];
    const pawnFile = [-4, -2, 3, 6, 6, 3, -2, -4][f];
    mg[PAWN][s] = pawnAdv + pawnFile;
    eg[PAWN][s] = Math.round(pawnAdv * 1.3) + (pawnFile >> 1);

    // ม้า: กลางกระดานดี ริมขอบแย่
    const kn = Math.round(18 - 6 * cd);
    mg[KNIGHT][s] = kn;
    eg[KNIGHT][s] = kn;

    // โคน: กลาง + ดันขึ้นเล็กน้อย
    const kh = Math.round(10 - 4 * cd) + [0, 0, 2, 4, 4, 2, 0, 0][r];
    mg[KHON][s] = kh;
    eg[KHON][s] = Math.round(8 - 3 * cd);

    // เม็ด: อ่อนมาก ให้ค่าน้อย
    const me = Math.round(4 - 1.6 * cd);
    mg[MET][s] = me;
    eg[MET][s] = me;

    // เรือ: PST เล็กน้อย + โบนัสแถว 6/7
    let ro = [0, 2, 3, 4, 4, 3, 2, 0][f];
    if (r === 6) ro += 14; else if (r === 5) ro += 6;
    mg[ROOK][s] = ro;
    eg[ROOK][s] = [0, 1, 2, 2, 2, 2, 1, 0][f];

    // ขุน: กลางเกม -> อยู่แนวหลัง / ท้ายเกม -> เข้ากลาง
    mg[KING][s] = [6, -6, -20, -32, -40, -44, -46, -48][r] + [4, 6, 2, -2, -2, 2, 6, 4][f];
    eg[KING][s] = Math.round(24 - 6 * cd);
  }
  return { mg, eg };
}
const { mg: PST_MG, eg: PST_EG } = buildPst();

const PASSED_BONUS = [0, 4, 12, 24, 44, 72, 0, 0]; // ตาม "จำนวน rank ที่ดันมาแล้ว"

const MOB_WEIGHT = { [KNIGHT]: 4, [KHON]: 4, [MET]: 3, [ROOK]: 3 };
const MOB_BASE   = { [KNIGHT]: 4, [KHON]: 4, [MET]: 2, [ROOK]: 6 };

/**
 * ประเมินตำแหน่ง -> centipawn (บวก = ขาวได้เปรียบ)
 * @param {import('./board.js').Board} b
 */
export function evaluate(b) {
  const bd = b.board;
  let mg = 0, eg = 0, phase = 0, misc = 0;

  const cnt = new Int8Array(16);
  const pawnFiles = [new Int8Array(8), new Int8Array(8)];

  for (let s = 0; s < 64; s++) {
    const p = bd[s];
    if (p === EMPTY) continue;
    cnt[p]++;
    const col = pcColor(p), ty = pcType(p);
    const rel = col === WHITE ? s : flipSq(s);
    const sgn = col === WHITE ? 1 : -1;
    const v = PIECE_VALUE[ty];
    mg += sgn * (v + PST_MG[ty][rel]);
    eg += sgn * (v + PST_EG[ty][rel]);
    phase += PHASE_W[ty];
    if (ty === PAWN) pawnFiles[col][fileOf(s)]++;
  }

  // ---- คู่โคน -------------------------------------------------------------
  if (cnt[mk(WHITE, KHON)] >= 2) misc += 14;
  if (cnt[mk(BLACK, KHON)] >= 2) misc -= 14;

  // ---- โครงเบี้ยตามแถวตั้ง: ซ้อน / โดด ---------------------------------
  for (let f = 0; f < 8; f++) {
    const wp = pawnFiles[WHITE][f], bp = pawnFiles[BLACK][f];
    if (wp > 1) misc -= 10 * (wp - 1);
    if (bp > 1) misc += 10 * (bp - 1);
    const wIso = wp > 0 && (f === 0 || pawnFiles[WHITE][f - 1] === 0) && (f === 7 || pawnFiles[WHITE][f + 1] === 0);
    const bIso = bp > 0 && (f === 0 || pawnFiles[BLACK][f - 1] === 0) && (f === 7 || pawnFiles[BLACK][f + 1] === 0);
    if (wIso) misc -= 8;
    if (bIso) misc += 8;
  }

  // ---- เบี้ยผ่าน + เรือคุมแถว ----------------------------------------
  for (let s = 0; s < 64; s++) {
    const p = bd[s];
    if (p === EMPTY) continue;
    const col = pcColor(p), ty = pcType(p);
    const sgn = col === WHITE ? 1 : -1;

    if (ty === PAWN) {
      const f = fileOf(s), r = rankOf(s), dir = col === WHITE ? 1 : -1;
      const oppPawn = mk(col ^ 1, PAWN);
      let passed = true;
      for (let df = -1; df <= 1 && passed; df++) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        for (let rr = r + dir; rr >= 0 && rr < 8; rr += dir) {
          if (bd[rr * 8 + nf] === oppPawn) { passed = false; break; }
        }
      }
      if (passed) {
        const adv = col === WHITE ? r : 7 - r;
        misc += sgn * (PASSED_BONUS[adv] || 0);
      }
    } else if (ty === ROOK) {
      const f = fileOf(s);
      const own = pawnFiles[col][f], opp = pawnFiles[col ^ 1][f];
      if (own === 0 && opp === 0) misc += sgn * 16;
      else if (own === 0) misc += sgn * 8;
      const rr = col === WHITE ? rankOf(s) : 7 - rankOf(s);
      if (rr === 5 || rr === 6) misc += sgn * 12;
    }
  }

  // ---- mobility + king safety --------------------------------------
  misc += mobilityAndKing(b, bd);

  // ---- ผสม mg/eg ตาม phase ---------------------------------------------
  if (phase > PHASE_MAX) phase = PHASE_MAX;
  let score = ((mg + misc) * phase + (eg + misc) * (PHASE_MAX - phase)) / PHASE_MAX;

  score = scaleForMaterial(score, cnt);
  score += b.turn === WHITE ? TEMPO : -TEMPO;
  return Math.round(score);
}

function mobilityAndKing(b, bd) {
  let s = 0;

  for (let sq = 0; sq < 64; sq++) {
    const p = bd[sq];
    if (p === EMPTY) continue;
    const col = pcColor(p), ty = pcType(p);
    const sgn = col === WHITE ? 1 : -1;
    let mob = 0;

    if (ty === KNIGHT) {
      const T = KNIGHT_MOVES[sq];
      for (let i = 0; i < T.length; i++) { const q = bd[T[i]]; if (q === EMPTY || pcColor(q) !== col) mob++; }
      s += sgn * MOB_WEIGHT[KNIGHT] * (mob - MOB_BASE[KNIGHT]);
    } else if (ty === KHON) {
      const T = KHON_MOVES[col][sq];
      for (let i = 0; i < T.length; i++) { const q = bd[T[i]]; if (q === EMPTY || pcColor(q) !== col) mob++; }
      s += sgn * MOB_WEIGHT[KHON] * (mob - MOB_BASE[KHON]);
    } else if (ty === MET) {
      const T = MET_MOVES[sq];
      for (let i = 0; i < T.length; i++) { const q = bd[T[i]]; if (q === EMPTY || pcColor(q) !== col) mob++; }
      s += sgn * MOB_WEIGHT[MET] * (mob - MOB_BASE[MET]);
    } else if (ty === ROOK) {
      const rays = ROOK_RAYS[sq];
      for (let d = 0; d < 4; d++) {
        const ray = rays[d];
        for (let i = 0; i < ray.length; i++) {
          const q = bd[ray[i]];
          if (q === EMPTY) { mob++; continue; }
          if (pcColor(q) !== col) mob++;
          break;
        }
      }
      s += sgn * MOB_WEIGHT[ROOK] * (mob - MOB_BASE[ROOK]);
    }
  }

  // ความปลอดภัยของขุนทั้งสองฝ่าย
  for (const col of [WHITE, BLACK]) {
    const ksq = b.kingSq[col];
    if (ksq < 0) continue;
    const sgn = col === WHITE ? 1 : -1;
    const opp = col ^ 1;
    const dir = col === WHITE ? 8 : -8;
    const f = fileOf(ksq);
    let safety = 0;

    // โล่ด้านหน้าขุน 3 ช่อง
    for (let df = -1; df <= 1; df++) {
      const nf = f + df;
      if (nf < 0 || nf > 7) continue;
      const t = ksq + dir + df;
      if (t < 0 || t > 63) { safety -= 5; continue; }
      const q = bd[t];
      if (q !== EMPTY && pcColor(q) === col &&
          (pcType(q) === PAWN || pcType(q) === KHON || pcType(q) === MET)) safety += 8;
      else safety -= 6;
    }

    // เรือคู่แข่งจ่อแถวเดียวกับขุน และไม่มีเบี้ยเราขวาง
    let ownPawnOnFile = false, enemyRookOnFile = false;
    for (let r = 0; r < 8; r++) {
      const q = bd[r * 8 + f];
      if (q === EMPTY) continue;
      if (q === mk(col, PAWN)) ownPawnOnFile = true;
      if (q === mk(opp, ROOK)) enemyRookOnFile = true;
    }
    if (enemyRookOnFile && !ownPawnOnFile) safety -= 18;

    // จำนวนช่องรอบขุนที่ถูกจู่โจม
    let atk = 0;
    const around = KING_MOVES[ksq];
    for (let i = 0; i < around.length; i++) {
      if (squareAttackedBy(bd, around[i], opp)) atk++;
    }
    safety -= atk * atk * 2;

    s += sgn * safety;
  }

  return s;
}

function scaleForMaterial(score, cnt) {
  const wMinor = cnt[mk(WHITE, KNIGHT)] + cnt[mk(WHITE, KHON)] + cnt[mk(WHITE, MET)];
  const bMinor = cnt[mk(BLACK, KNIGHT)] + cnt[mk(BLACK, KHON)] + cnt[mk(BLACK, MET)];
  const wR = cnt[mk(WHITE, ROOK)], bR = cnt[mk(BLACK, ROOK)];
  const wP = cnt[mk(WHITE, PAWN)], bP = cnt[mk(BLACK, PAWN)];

  // ฝ่ายที่ "นำ" แต่กำลังไม่พอบังคับรุกจน -> ลดคะแนนให้ใกล้เสมอ
  if (score > 0 && wP === 0 && wR === 0 && wMinor <= 1) return score * 0.25;
  if (score < 0 && bP === 0 && bR === 0 && bMinor <= 1) return score * 0.25;
  return score;
}

/**
 * true ถ้ากำลังทั้งกระดานไม่พอบังคับรุกจนได้ (ถือเป็นเสมอ)
 *   - ไม่มีเบี้ยและไม่มีเรือทั้งกระดาน และ
 *   - ทั้งสองฝ่ายมีกำลัง "อ่อน" = ตัวเดิน (ม้า+โคน+เม็ด) รวม <= 1
 *     หรือมีแค่ม้า 2 ตัว (บังคับรุกจนไม่ได้)
 */
export function insufficientMaterial(b) {
  const cnt = b.pieceCounts();
  if (cnt[mk(WHITE, PAWN)] + cnt[mk(BLACK, PAWN)] +
      cnt[mk(WHITE, ROOK)] + cnt[mk(BLACK, ROOK)] > 0) return false;

  const weak = (n, s, m) => (n + s + m) <= 1 || (n === 2 && s === 0 && m === 0);
  const wWeak = weak(cnt[mk(WHITE, KNIGHT)], cnt[mk(WHITE, KHON)], cnt[mk(WHITE, MET)]);
  const bWeak = weak(cnt[mk(BLACK, KNIGHT)], cnt[mk(BLACK, KHON)], cnt[mk(BLACK, MET)]);
  return wWeak && bWeak;
}
