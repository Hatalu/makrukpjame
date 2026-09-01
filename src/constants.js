// ============================================================================
//  Engine MakrukThai  -  constants.js
//  ค่าคงที่พื้นฐานของเอนจิ้นหมากรุกไทย (Thai Chess / Makruk)
//
//  กระดาน 8x8  index 0..63   sq = rank*8 + file
//    file 0..7  = a..h        (แนวตั้ง)
//    rank 0..7  = 1..8        (แนวนอน, rank 0 = แถวหลังฝ่ายขาว)
//    ฝ่ายขาวเดินขึ้น (rank เพิ่ม)   ฝ่ายดำเดินลง (rank ลด)
// ============================================================================

/** @enum {number} */
export const WHITE = 0;
export const BLACK = 1;

// ---- ชนิดหมาก (piece type) 1..6 --------------------------------------------
export const EMPTY  = 0;
export const PAWN   = 1; // เบี้ย   (Bia)
export const KNIGHT = 2; // ม้า     (Ma)
export const KHON   = 3; // โคน     (Khon)  - เดินเฉียง 4 ทิศ + ตรงหน้า 1 (เหมือน "เงิน" โชกิ)
export const MET    = 4; // เม็ด    (Met)   - เดินเฉียง 1 ช่อง (ferz)
export const ROOK   = 5; // เรือ    (Rua)
export const KING   = 6; // ขุน     (Khun)

// รหัสหมากที่เก็บในกระดาน: ขาว = type (1..6), ดำ = type | 8 (9..14), ว่าง = 0
export const mk = (color, type) => (type | (color << 3));
export const pcType  = (p) => (p & 7);
export const pcColor = (p) => (p >> 3);

export const W_PAWN = mk(WHITE, PAWN),   B_PAWN = mk(BLACK, PAWN);
export const W_KNIGHT = mk(WHITE, KNIGHT), B_KNIGHT = mk(BLACK, KNIGHT);
export const W_KHON = mk(WHITE, KHON),   B_KHON = mk(BLACK, KHON);
export const W_MET  = mk(WHITE, MET),    B_MET  = mk(BLACK, MET);
export const W_ROOK = mk(WHITE, ROOK),   B_ROOK = mk(BLACK, ROOK);
export const W_KING = mk(WHITE, KING),   B_KING = mk(BLACK, KING);

// ---- ตัวอักษร FEN ----------------------------------------------------------
//  ใช้ชุดเดียวกับ Fairy-Stockfish / Makruk-Stockfish (ซึ่ง GodratSF+ อ้างอิง)
//    p/n/s/m/r/k = bia / ma / khon(silver) / met / rua / khun
export const TYPE_TO_CHAR = { 1: 'p', 2: 'n', 3: 's', 4: 'm', 5: 'r', 6: 'k' };
export const CHAR_TO_TYPE = { p: PAWN, n: KNIGHT, s: KHON, m: MET, r: ROOK, k: KING };
/** ตัวอักษรที่ใช้ใน SAN (long/short algebraic) */
export const TYPE_TO_SAN = { 2: 'N', 3: 'S', 4: 'M', 5: 'R', 6: 'K' };

// ตำแหน่งเริ่มเกมมาตรฐาน (ขุนขาว d1, เม็ดขาว e1 / ขุนดำ e8, เม็ดดำ d8)
export const START_FEN = 'rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w - - 0 1';

// ---- ค่าหมาก (centipawn) -------------------------------------------------
//  เบี้ย 100 / เม็ด 190 / โคน 255 / ม้า 315 / เรือ 510
export const PIECE_VALUE = [0, 100, 315, 255, 190, 510, 0];

// น้ำหนัก game-phase (ใช้ผสม mg/eg)  เริ่มเกม = 18
export const PHASE_W = [0, 0, 1, 1, 1, 2, 0];
export const PHASE_MAX = 18;

// ---- คะแนนพิเศษ ----------------------------------------------------------
export const MATE   = 30000;
export const MATE_IN_MAX = MATE - 1000; // เกินค่านี้ถือว่าเป็นคะแนนรุกจน
export const INF    = 31000;
export const DRAW_SCORE = 0;
export const MAX_PLY = 128;
export const TEMPO = 8;

// ---- geometry helpers --------------------------------------------------
export const fileOf = (sq) => (sq & 7);
export const rankOf = (sq) => (sq >> 3);
export const square = (f, r) => (r * 8 + f);
/** สะท้อนช่องตามแนวนอน (ใช้แปลงมุมมองขาว<->ดำ) */
export const flipSq = (sq) => (sq ^ 56);

/** ชื่อช่องแบบ algebraic เช่น 12 -> "e2" */
export function squareName(sq) {
  return 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
}
/** "e2" -> 12  (คืน -1 ถ้าผิดรูปแบบ) */
export function parseSquare(str) {
  if (!str || str.length < 2) return -1;
  const f = str.charCodeAt(0) - 97;
  const r = str.charCodeAt(1) - 49;
  if (f < 0 || f > 7 || r < 0 || r > 7) return -1;
  return r * 8 + f;
}

/** แถวที่เบี้ยเลื่อนขั้นเป็นเม็ด (rank index ที่ 6 นับจากฝั่งตัวเอง) */
export const PROMO_RANK = [5, 2]; // [WHITE, BLACK]
