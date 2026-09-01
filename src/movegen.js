// ============================================================================
//  Engine MakrukThai  -  movegen.js
//  การสร้างหมากเดิน (pseudo-legal + legal) ตามกติกาหมากรุกไทย
//
//  กติกาสำคัญ:
//    เบี้ย  - เดินตรง 1 (ห้ามเดินทีแรก 2), กินเฉียงหน้า, ไม่มี en-passant
//    เบี้ย  - เลื่อนขั้นเป็น "เม็ด" เท่านั้น เมื่อถึง rank ที่ 6 นับจากฝั่งตัวเอง
//    เม็ด  - เฉียง 1 ช่อง
//    โคน  - เฉียง 4 ทิศ + ตรงหน้า 1 ช่อง
//    ม้า  - แบบหมากรุกสากล (กระโดดได้)
//    เรือ  - แนวตรงระยะไกล
//    ขุน  - รอบตัว 1 ช่อง, ไม่มีการ castling
// ============================================================================
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, KING,
  mk, pcType, pcColor, rankOf, PROMO_RANK,
} from './constants.js';
import {
  KNIGHT_MOVES, KING_MOVES, MET_MOVES, KHON_MOVES,
  PAWN_PUSH, PAWN_CAPS, ROOK_RAYS, squareAttackedBy,
} from './tables.js';

function mvObj(from, to, piece, captured, promotion) {
  return { from, to, piece, captured, promotion, score: 0 };
}

function genStep(bd, from, us, targets, out, capturesOnly) {
  const pc = bd[from];
  for (let i = 0; i < targets.length; i++) {
    const to = targets[i];
    const q = bd[to];
    if (q === EMPTY) {
      if (!capturesOnly) out.push(mvObj(from, to, pc, EMPTY, 0));
    } else if (pcColor(q) !== us) {
      out.push(mvObj(from, to, pc, q, 0));
    }
  }
}

function genSlider(bd, from, us, rays, out, capturesOnly) {
  const pc = bd[from];
  for (let d = 0; d < 4; d++) {
    const ray = rays[d];
    for (let i = 0; i < ray.length; i++) {
      const to = ray[i];
      const q = bd[to];
      if (q === EMPTY) {
        if (!capturesOnly) out.push(mvObj(from, to, pc, EMPTY, 0));
        continue;
      }
      if (pcColor(q) !== us) out.push(mvObj(from, to, pc, q, 0));
      break;
    }
  }
}

function genPawn(bd, from, us, out, capturesOnly) {
  const pc = bd[from];
  const promoRank = PROMO_RANK[us];

  const push = PAWN_PUSH[us][from];
  if (push >= 0 && bd[push] === EMPTY) {
    const isPromo = rankOf(push) === promoRank;
    if (!capturesOnly || isPromo) {
      out.push(mvObj(from, push, pc, EMPTY, isPromo ? MET : 0));
    }
  }

  const caps = PAWN_CAPS[us][from];
  for (let i = 0; i < caps.length; i++) {
    const to = caps[i];
    const q = bd[to];
    if (q !== EMPTY && pcColor(q) !== us) {
      const isPromo = rankOf(to) === promoRank;
      out.push(mvObj(from, to, pc, q, isPromo ? MET : 0));
    }
  }
}

/**
 * สร้างหมากเดินแบบ pseudo-legal (ยังไม่กรองการเปิดหน้าขุน)
 * @param {import('./board.js').Board} b
 * @param {Array} out  อาร์เรย์ปลายทาง (จะถูก push เข้าไป)
 * @param {boolean} [capturesOnly=false]  เอาเฉพาะกินตัว + เลื่อนขั้น (สำหรับ quiescence)
 */
export function generateMoves(b, out, capturesOnly = false) {
  const bd = b.board;
  const us = b.turn;
  for (let from = 0; from < 64; from++) {
    const pc = bd[from];
    if (pc === EMPTY || pcColor(pc) !== us) continue;
    switch (pcType(pc)) {
      case PAWN:   genPawn(bd, from, us, out, capturesOnly); break;
      case KNIGHT: genStep(bd, from, us, KNIGHT_MOVES[from], out, capturesOnly); break;
      case KING:   genStep(bd, from, us, KING_MOVES[from], out, capturesOnly); break;
      case MET:    genStep(bd, from, us, MET_MOVES[from], out, capturesOnly); break;
      case KHON:   genStep(bd, from, us, KHON_MOVES[us][from], out, capturesOnly); break;
      case ROOK:   genSlider(bd, from, us, ROOK_RAYS[from], out, capturesOnly); break;
    }
  }
  return out;
}

/** true ถ้าเดิน m แล้วขุนฝ่ายตัวเองไม่ถูกรุก (ต้อง make/undo) */
export function moveIsLegal(b, m) {
  const us = b.turn;
  b.makeMove(m);
  const ok = !squareAttackedBy(b.board, b.kingSq[us], us ^ 1);
  b.undoMove(m);
  return ok;
}

/** รายการหมากเดินที่ถูกกติกาจริง */
export function legalMoves(b) {
  const pseudo = [];
  generateMoves(b, pseudo);
  const us = b.turn;
  const res = [];
  for (let i = 0; i < pseudo.length; i++) {
    const m = pseudo[i];
    b.makeMove(m);
    if (!squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) res.push(m);
    b.undoMove(m);
  }
  return res;
}

/** true ถ้าเดิน m แล้วเป็นการรุกขุนฝ่ายตรงข้าม */
export function moveGivesCheck(b, m) {
  b.makeMove(m);
  const chk = squareAttackedBy(b.board, b.kingSq[b.turn], b.turn ^ 1);
  b.undoMove(m);
  return chk;
}

/** perft - นับจำนวนใบไม้ (ใช้ตรวจความถูกต้องของ movegen) */
export function perft(b, depth) {
  if (depth === 0) return 1;
  const moves = [];
  generateMoves(b, moves);
  const us = b.turn;
  let nodes = 0;
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    b.makeMove(m);
    if (!squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) {
      nodes += depth === 1 ? 1 : perft(b, depth - 1);
    }
    b.undoMove(m);
  }
  return nodes;
}

/** perft แยกตามหมากเดินตาแรก (ใช้ debug) */
export function perftDivide(b, depth) {
  const moves = [];
  generateMoves(b, moves);
  const us = b.turn;
  const rows = [];
  let total = 0;
  for (const m of moves) {
    b.makeMove(m);
    if (!squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) {
      const n = depth <= 1 ? 1 : perft(b, depth - 1);
      total += n;
      rows.push([m, n]);
    }
    b.undoMove(m);
  }
  return { rows, total };
}
