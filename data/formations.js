// ============================================================================
//  Engine MakrukThai  -  data/formations.js
//  แคตตาล็อก "รูปแบบเปิดหมาก" ที่ GodratSF+ ใช้ (จากไฟล์ รูปแบบเปิดหมาก GodratSF+ 5.txt)
//
//  GodratSF+ แจกเป็นไฟล์ .exe หลายตัว แต่ละตัวถูกล็อกให้เล่นเปิดเกมรูปแบบเดียว
//  ที่นี่เก็บเป็น "ชื่อ + คำอธิบาย + แนวเปิดตัวอย่าง (ถ้าอนุมานได้)"
//  ให้ผู้ใช้เอาไปทำปุ่มเลือกสไตล์การเล่นของบอทในเว็บฝึกซ้อม
//
//  ช่อง `moves` เป็น long-algebraic (uci-like) มุมมองเริ่มจากตำแหน่งเริ่มเกม
//  หลายรายการยังเป็น []  เพราะลำดับหมากจริงอยู่ในไฟล์ .pgn ของผู้ใช้
//  -> ใช้ tools/import-pgn.mjs ดูดจากโฟลเดอร์ .pgn มาเติมเป็น book จริงได้
// ============================================================================

/** @typedef {{code:string, nameTh:string, nameEn:string, note:string, fast?:boolean, side?:'white'|'black', moves:string[]}} Formation */

/** @type {Formation[]} */
export const FORMATIONS = [
  {
    code: 'R',
    nameTh: 'ม้าเทียมโคนขุนพล ม้าขวา',
    nameEn: 'Right-knight / knight-abreast-khon setup',
    note: 'รูปแบบมาตรฐานของ GodratSF+ พัฒนาม้าขวาขึ้นเทียบโคน',
    moves: ['g1f3'],
  },
  {
    code: 'Fast',
    nameTh: 'ม้าเทียมโคนขุนพล ม้าขวา (บุกเร็ว)',
    nameEn: 'Right-knight setup, fast-attack tuning',
    note: 'เหมือน R แต่ตั้งค่าให้พยายามบุกเร็ว (contempt สูง, ชอบเปิดเกม)',
    fast: true,
    moves: ['g1f3'],
  },
  {
    code: 'RR-white',
    nameTh: 'ม้าขวา (เฉพาะหมากขาว)',
    nameEn: 'Right-knight, White only',
    side: 'white',
    note: 'ใช้รูปม้าขวาเมื่อเล่นฝ่ายขาวเท่านั้น',
    moves: ['g1f3'],
  },
  {
    code: 'RR-black',
    nameTh: 'ม้าขวา (เฉพาะหมากดำ)',
    nameEn: 'Right-knight, Black only',
    side: 'black',
    note: 'ใช้รูปม้าขวาเมื่อเล่นฝ่ายดำเท่านั้น',
    moves: [],
  },
  {
    code: 'P-white',
    nameTh: 'ม้าขวาเบี้ยก้ามปู (ขาว, เบี้ย h4)',
    nameEn: 'Right-knight + "crab-claw" pawn, White (h4)',
    side: 'white',
    note: 'รูปม้าขวา ผสมการดันเบี้ยริม h4 แบบก้ามปู',
    moves: ['g1f3', 'h3h4'],
  },
  {
    code: 'P-black',
    nameTh: 'ม้าขวาเบี้ยก้ามปู (ดำ, เบี้ย a5)',
    nameEn: 'Right-knight + "crab-claw" pawn, Black (a5)',
    side: 'black',
    note: 'รูปม้าขวา ผสมการดันเบี้ยริม a5 แบบก้ามปู (ฝ่ายดำ)',
    moves: [],
  },
  {
    code: 'M',
    nameTh: 'เม็ดซ้าย ม้าซ้าย',
    nameEn: 'Met-left, knight-left',
    note: 'เล่นปีกซ้าย ดันเม็ดและพัฒนาม้าซ้าย',
    moves: ['b1c3'],
  },
  {
    code: 'L',
    nameTh: 'ม้าซ้าย เม็ดซ้าย',
    nameEn: 'Knight-left, met-left',
    note: 'สลับลำดับกับ M — ขึ้นม้าซ้ายก่อนแล้วตามด้วยเม็ด',
    moves: ['b1c3'],
  },
  {
    code: 'C',
    nameTh: 'ม้าเทียมโคนผสม',
    nameEn: 'Mixed knight-abreast-khon',
    note: 'ผสมแนวม้าเทียมโคนทั้งสองปีก',
    moves: [],
  },
  {
    code: 'S',
    nameTh: 'ม้ามังกร',
    nameEn: '"Dragon knight"',
    note: 'พัฒนาม้าออกริมแล้ววกเข้าทำเกมรุก',
    moves: [],
  },
  {
    code: 'H',
    nameTh: 'ม้าลู่ (ม้าตรงกันแนวตั้ง)',
    nameEn: 'Knights on the same file',
    note: 'จัดม้าทั้งสองให้อยู่แนวตั้งเดียวกัน',
    moves: [],
  },
  {
    code: 'K',
    nameTh: 'ม้าเทียมมังกรสลับ',
    nameEn: 'Alternating dragon knight-abreast',
    note: 'สลับแนวม้าเทียม/ม้ามังกรตามจังหวะคู่ต่อสู้',
    moves: [],
  },
  {
    code: 'T',
    nameTh: 'ม้าเทียมโคนขุนพลคู่ (ขาว) / โคนกระจกเงา (ดำ)',
    nameEn: 'Double knight-abreast-khon (mirror for Black)',
    note: 'ฝ่ายดำจะขึ้นโคนเป็นภาพสะท้อนตรงข้ามกับฝ่ายขาว',
    moves: [],
  },
  {
    code: 'N',
    nameTh: 'ม้าอุปการ',
    nameEn: '"Patron knight"',
    note: 'วางม้าให้หนุนหมากกลางและคุมช่องสำคัญ',
    moves: [],
  },
  {
    code: 'O',
    nameTh: 'เรือมเหศวร',
    nameEn: '"Great rook"',
    note: 'เปิดแถวเรือเร็ว เน้นเกมเรือคู่',
    moves: [],
  },
  {
    code: 'MC',
    nameTh: 'เม็ดซ้ายโคนนายผล',
    nameEn: 'Met-left + "khon-nai-pol"',
    note: 'ผสมเม็ดซ้ายกับการวางโคนแบบนายผล',
    moves: [],
  },
  {
    code: 'NM',
    nameTh: 'ม้าอุปการ + เม็ดซ้าย',
    nameEn: 'Patron-knight + met-left',
    note: 'ผสมแนว N กับ M',
    moves: [],
  },
  {
    code: 'NO',
    nameTh: 'ม้าอุปการ + เรือมเหศวร',
    nameEn: 'Patron-knight + great-rook',
    note: 'ผสมแนว N กับ O',
    moves: [],
  },
];

export const FORMATION_BY_CODE = Object.fromEntries(FORMATIONS.map((f) => [f.code, f]));

/**
 * สร้าง OpeningBook เล็ก ๆ จากรายการ formations (ใช้ moves stub ที่มี)
 * @param {import('../src/board.js').Board} startBoard
 * @param {typeof import('../src/book.js').OpeningBook} OpeningBook
 */
export function buildFormationBook(startBoard, OpeningBook) {
  const lines = FORMATIONS.map((f) => f.moves).filter((m) => m.length > 0);
  return OpeningBook.fromLines(startBoard, lines, 8);
}
