// ============================================================================
//  Engine MakrukThai  -  counting.js
//  กฎการนับ (เสมอ) ของหมากรุกไทย  -  ฉบับประยุกต์ใช้กับเอนจิ้น
//
//    * นับกระดาน (Board's honour) : เริ่มเมื่อ "ไม่มีเบี้ยเหลือบนกระดาน"
//         เป้าหมาย 64  ถ้าไม่รุกจนก่อนถึง -> เสมอ
//    * นับศักดิ์หมาก (Pieces' honour) : เริ่มเมื่อฝ่ายหนึ่งเหลือแต่ขุน
//         เป้าหมายขึ้นกับกำลังที่ฝ่ายรุกเหลือ:
//            เรือ 2      -> 8
//            เรือ 1      -> 16
//            โคน 2      -> 22
//            ม้า 2       -> 32
//            โคน 1      -> 44
//            ม้า 1       -> 64
//            อื่น ๆ      -> 64
//
//  ค่านับเริ่มจาก "จำนวนหมากทั้งหมดบนกระดาน" แล้วบวกทีละ 1 ทุกครึ่งตา
//  การกินตัว หรือการเดินเบี้ย จะรีเซ็ตการนับ
//  (ใกล้เคียงพฤติกรรม Makruk-Stockfish ที่ GodratSF+ ใช้ - "64 move rule")
// ============================================================================
import { EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, mk, pcColor, pcType, WHITE, BLACK } from './constants.js';

export function newCounting() {
  return { active: 'none', count: 0, limit: 0, side: -1 };
}
export function cloneCounting(c) {
  return { active: c.active, count: c.count, limit: c.limit, side: c.side };
}

/** นับหมากแยกชนิดของฝ่าย `color` (ใช้เฉพาะตอนเปลี่ยนเข้าโหมดนับศักดิ์หมาก) */
function tallyColor(bd, color) {
  const t = new Int8Array(7);
  for (let s = 0; s < 64; s++) {
    const p = bd[s];
    if (p !== EMPTY && pcColor(p) === color) t[pcType(p)]++;
  }
  return t;
}

function pieceLimit(atk) {
  if (atk[ROOK] >= 2) return 8;
  if (atk[ROOK] === 1) return 16;
  if (atk[KHON] >= 2) return 22;
  if (atk[KNIGHT] >= 2) return 32;
  if (atk[KHON] >= 1) return 44;
  if (atk[KNIGHT] >= 1) return 64;
  return 64;
}

/**
 * อัปเดตสถานะการนับหลังเดินหมาก (เรียกจาก Board.makeMove / setFen)
 * @param {import('./board.js').Board} b
 * @param {number} movedType  ชนิดหมากที่เพิ่งเดิน (0 = ไม่ทราบ / setFen)
 * @param {number} capturedCode
 * @param {boolean} firstEval  true เมื่อเรียกจาก setFen
 */
export function updateCounting(b, movedType, capturedCode, firstEval) {
  const c = b.counting;

  // กินตัว หรือ เดินเบี้ย -> รีเซ็ต
  if (!firstEval && (capturedCode !== EMPTY || movedType === PAWN)) {
    c.active = 'none'; c.count = 0; c.limit = 0; c.side = -1;
  }

  // ใช้ตัวนับ incremental จาก Board (เร็ว ไม่ต้องสแกน 64 ช่อง)
  const total = b.npieces;
  const pawns = b.npawns;
  const bareW = b.nNonKing[WHITE] === 0;
  const bareB = b.nNonKing[BLACK] === 0;
  const bothBare = bareW && bareB;

  if (c.active === 'none') {
    if (!bothBare && (bareW || bareB)) {
      const atk = bareW ? BLACK : WHITE;
      c.active = 'piece';
      c.side = bareW ? WHITE : BLACK;
      c.limit = pieceLimit(tallyColor(b.board, atk));
      c.count = total;
    } else if (pawns === 0 && !bothBare) {
      c.active = 'board';
      c.side = -1;
      c.limit = 64;
      c.count = total;
    }
  } else if (!firstEval) {
    c.count++;
    // นับกระดานอยู่ แล้วกลายเป็นเหลือขุนเปล่า -> เปลี่ยนไปนับศักดิ์หมาก
    if (c.active === 'board' && !bothBare && (bareW || bareB)) {
      const atk = bareW ? BLACK : WHITE;
      c.active = 'piece';
      c.side = bareW ? WHITE : BLACK;
      c.limit = pieceLimit(tallyColor(b.board, atk));
      c.count = total;
    }
  }
}

/** คืน 'draw' ถ้าถึงเป้าการนับแล้ว มิฉะนั้นคืน null */
export function countingResult(b) {
  const c = b.counting;
  if (c.active !== 'none' && c.count > c.limit) return 'draw';
  return null;
}

/** ข้อความอธิบายสถานะการนับ (ใช้แสดงผลใน UI) */
export function describeCounting(b) {
  const c = b.counting;
  if (c.active === 'none') return { active: false, text: 'ยังไม่เริ่มนับ' };
  const kind = c.active === 'board' ? 'นับกระดาน' : 'นับศักดิ์หมาก';
  return {
    active: true,
    kind: c.active,
    count: c.count,
    limit: c.limit,
    text: `${kind} ${c.count}/${c.limit}`,
  };
}
