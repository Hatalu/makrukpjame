// ============================================================================
//  Engine MakrukThai  -  notation.js
//  แปลงหมากเดิน <-> ข้อความ  (long algebraic / UCI-like และ SAN)
//
//    long algebraic : "e3e4", "d4e5", โปรโมท "e5f6=M" หรือ "e5f6m"
//    SAN            : "Nf3", "Sxe5", "e4", "exd6=M", เติม "+"/"#"
//    ตัวอักษรหมาก   : N=ม้า  S=โคน  M=เม็ด  R=เรือ  K=ขุน  (เบี้ยไม่มีตัวอักษร)
// ============================================================================
import {
  PAWN, MET, EMPTY, pcType, fileOf, rankOf, squareName, parseSquare,
  TYPE_TO_SAN,
} from './constants.js';
import { legalMoves } from './movegen.js';
import { squareAttackedBy } from './tables.js';

/** move -> "e3e4" (+ "=M" ถ้าเลื่อนขั้น) */
export function moveToUci(m) {
  return squareName(m.from) + squareName(m.to) + (m.promotion ? '=M' : '');
}

/** "e3e4" / "e5f6=M" / "e5f6m"  ->  move object ที่ถูกกติกา (หรือ null) */
export function uciToMove(b, str) {
  if (!str) return null;
  const s = String(str).trim().replace(/[=]/g, '').toLowerCase();
  const from = parseSquare(s.slice(0, 2));
  const to = parseSquare(s.slice(2, 4));
  if (from < 0 || to < 0) return null;
  for (const m of legalMoves(b)) {
    if (m.from === from && m.to === to) return m;
  }
  return null;
}

/** move -> SAN (ต้องอยู่ในตำแหน่ง b ก่อนเดิน) */
export function moveToSan(b, m) {
  const t = pcType(m.piece);
  let san;

  if (t === PAWN) {
    san = m.captured !== EMPTY
      ? 'abcdefgh'[fileOf(m.from)] + 'x' + squareName(m.to)
      : squareName(m.to);
    if (m.promotion) san += '=M';
  } else {
    const L = TYPE_TO_SAN[t];
    // disambiguation
    let sameFile = false, sameRank = false, ambiguous = false;
    for (const o of legalMoves(b)) {
      if (o.to === m.to && o.piece === m.piece && o.from !== m.from) {
        ambiguous = true;
        if (fileOf(o.from) === fileOf(m.from)) sameFile = true;
        if (rankOf(o.from) === rankOf(m.from)) sameRank = true;
      }
    }
    let dis = '';
    if (ambiguous) {
      if (!sameFile) dis = 'abcdefgh'[fileOf(m.from)];
      else if (!sameRank) dis = String(rankOf(m.from) + 1);
      else dis = squareName(m.from);
    }
    san = L + dis + (m.captured !== EMPTY ? 'x' : '') + squareName(m.to);
  }

  // เติม +/#
  b.makeMove(m);
  const opp = b.turn;
  const chk = squareAttackedBy(b.board, b.kingSq[opp], opp ^ 1);
  let mate = false;
  if (chk) {
    const rep = [];
    for (const _ of legalMoves(b)) { rep.push(_); break; }
    mate = rep.length === 0;
  }
  b.undoMove(m);
  if (mate) san += '#';
  else if (chk) san += '+';
  return san;
}

/** SAN -> move object (หา match จาก legal moves; ใช้ตอน import PGN) */
export function sanToMove(b, san) {
  const clean = String(san).trim().replace(/[+#!?]+$/g, '').replace(/\s+/g, '');
  for (const m of legalMoves(b)) {
    const s = moveToSan(b, m).replace(/[+#!?]+$/g, '');
    if (s === clean) return m;
  }
  // เผื่อรูปแบบ long algebraic ปนมา
  return uciToMove(b, clean);
}
