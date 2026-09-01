// ============================================================================
//  Engine MakrukThai  -  tables.js
//  ตารางการเดิน / การจู่โจม แบบ precompute ต่อช่อง (attack & move tables)
// ============================================================================
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, KING,
  mk, pcType, pcColor, fileOf, rankOf,
} from './constants.js';

const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

// ตารางเป้าหมายการเดินต่อช่อง
export const KNIGHT_MOVES = new Array(64);
export const KING_MOVES   = new Array(64);
export const MET_MOVES    = new Array(64);                 // เฉียง 1 ช่อง (4 ทิศ)
export const KHON_MOVES    = [new Array(64), new Array(64)]; // [color][sq]
export const PAWN_PUSH     = [new Int8Array(64), new Int8Array(64)];
export const PAWN_CAPS     = [new Array(64), new Array(64)];
export const ROOK_RAYS     = new Array(64);                 // [sq] -> [4][squares...]

// ตาราง "โจมตีมาจากช่องไหน" (ใช้ตรวจ isSquareAttacked)
export const PAWN_ATK_FROM = [new Array(64), new Array(64)]; // [byColor][target]
export const KHON_ATK_FROM = [new Array(64), new Array(64)]; // [byColor][target]

const KN   = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KG   = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const DIAG = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

for (let s = 0; s < 64; s++) {
  const f = fileOf(s), r = rankOf(s);
  const add = (arr, nf, nr) => { if (onBoard(nf, nr)) arr.push(nr * 8 + nf); };

  KNIGHT_MOVES[s] = []; for (const [df, dr] of KN) add(KNIGHT_MOVES[s], f + df, r + dr);
  KING_MOVES[s]   = []; for (const [df, dr] of KG) add(KING_MOVES[s], f + df, r + dr);
  MET_MOVES[s]    = []; for (const [df, dr] of DIAG) add(MET_MOVES[s], f + df, r + dr);

  // โคน: เฉียง 4 ทิศ + ตรงหน้า 1 (ขาวไปเหนือ, ดำไปใต้)
  KHON_MOVES[WHITE][s] = []; KHON_MOVES[BLACK][s] = [];
  for (const [df, dr] of DIAG) {
    add(KHON_MOVES[WHITE][s], f + df, r + dr);
    add(KHON_MOVES[BLACK][s], f + df, r + dr);
  }
  add(KHON_MOVES[WHITE][s], f, r + 1);
  add(KHON_MOVES[BLACK][s], f, r - 1);

  // เบี้ย: เดินตรง 1, กินเฉียงหน้า
  PAWN_PUSH[WHITE][s] = onBoard(f, r + 1) ? (r + 1) * 8 + f : -1;
  PAWN_PUSH[BLACK][s] = onBoard(f, r - 1) ? (r - 1) * 8 + f : -1;
  PAWN_CAPS[WHITE][s] = []; PAWN_CAPS[BLACK][s] = [];
  add(PAWN_CAPS[WHITE][s], f - 1, r + 1); add(PAWN_CAPS[WHITE][s], f + 1, r + 1);
  add(PAWN_CAPS[BLACK][s], f - 1, r - 1); add(PAWN_CAPS[BLACK][s], f + 1, r - 1);

  // เรือ: ลำแสง 4 ทิศจนสุดกระดาน
  ROOK_RAYS[s] = [];
  for (const [df, dr] of ORTH) {
    const ray = [];
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) { ray.push(nr * 8 + nf); nf += df; nr += dr; }
    ROOK_RAYS[s].push(ray);
  }

  // เบี้ยฝ่าย by จะจู่โจม s ได้จากช่องเฉียง "ข้างหลัง" ของ s
  PAWN_ATK_FROM[WHITE][s] = []; PAWN_ATK_FROM[BLACK][s] = [];
  add(PAWN_ATK_FROM[WHITE][s], f - 1, r - 1); add(PAWN_ATK_FROM[WHITE][s], f + 1, r - 1);
  add(PAWN_ATK_FROM[BLACK][s], f - 1, r + 1); add(PAWN_ATK_FROM[BLACK][s], f + 1, r + 1);

  // โคนฝ่าย by จู่โจม s ได้จาก: เฉียง 4 ทิศ + ช่อง "ข้างหลังตรง" (ขาว=ใต้, ดำ=เหนือ)
  KHON_ATK_FROM[WHITE][s] = []; KHON_ATK_FROM[BLACK][s] = [];
  for (const [df, dr] of DIAG) {
    add(KHON_ATK_FROM[WHITE][s], f + df, r + dr);
    add(KHON_ATK_FROM[BLACK][s], f + df, r + dr);
  }
  add(KHON_ATK_FROM[WHITE][s], f, r - 1);
  add(KHON_ATK_FROM[BLACK][s], f, r + 1);
}

/**
 * ช่อง sq ถูกโจมตีโดยฝ่าย `by` หรือไม่
 * @param {Int8Array} bd  กระดาน
 * @param {number} sq
 * @param {number} by  WHITE | BLACK
 */
export function squareAttackedBy(bd, sq, by) {
  // เบี้ย
  const pf = PAWN_ATK_FROM[by][sq];
  const pawnCode = mk(by, PAWN);
  for (let i = 0; i < pf.length; i++) if (bd[pf[i]] === pawnCode) return true;
  // ม้า
  const nm = KNIGHT_MOVES[sq], knCode = mk(by, KNIGHT);
  for (let i = 0; i < nm.length; i++) if (bd[nm[i]] === knCode) return true;
  // ขุน
  const km = KING_MOVES[sq], kCode = mk(by, KING);
  for (let i = 0; i < km.length; i++) if (bd[km[i]] === kCode) return true;
  // เม็ด (เฉียง 1)
  const mm = MET_MOVES[sq], mCode = mk(by, MET);
  for (let i = 0; i < mm.length; i++) if (bd[mm[i]] === mCode) return true;
  // โคน
  const sm = KHON_ATK_FROM[by][sq], sCode = mk(by, KHON);
  for (let i = 0; i < sm.length; i++) if (bd[sm[i]] === sCode) return true;
  // เรือ
  const rays = ROOK_RAYS[sq], rCode = mk(by, ROOK);
  for (let d = 0; d < 4; d++) {
    const ray = rays[d];
    for (let i = 0; i < ray.length; i++) {
      const q = bd[ray[i]];
      if (q === EMPTY) continue;
      if (q === rCode) return true;
      break;
    }
  }
  return false;
}
