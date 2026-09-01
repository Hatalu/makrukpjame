// ============================================================================
//  Engine MakrukThai  -  book.js
//  ตำราเปิดหมาก (opening book)  -  เก็บเป็น map: zobristKey -> [{uci, weight}]
//
//  ใช้ร่วมกับ GodratSF+ ได้: นำไฟล์ .pgn ที่เอนจิ้นนั้นเล่นไว้มา import ผ่าน
//  tools/import-pgn.mjs แล้วโหลด JSON ที่ได้เข้ามาที่นี่ หรือกำหนด "รูปแบบเปิดหมาก"
//  จาก data/formations.js
// ============================================================================
import { uciToMove } from './notation.js';

export class OpeningBook {
  constructor() {
    /** @type {Map<string, Array<{uci:string, weight:number}>>} */
    this.map = new Map();
  }

  static key(board) {
    return (board.keyLo >>> 0) + ':' + (board.keyHi >>> 0);
  }

  /** สร้างจาก plain object { "lo:hi": [{uci,weight}], ... } */
  static fromJSON(obj) {
    const b = new OpeningBook();
    for (const k of Object.keys(obj || {})) b.map.set(k, obj[k]);
    return b;
  }

  toJSON() {
    const o = {};
    for (const [k, v] of this.map) o[k] = v;
    return o;
  }

  get size() { return this.map.size; }

  addEntry(board, uci, weight = 1) {
    const k = OpeningBook.key(board);
    let arr = this.map.get(k);
    if (!arr) { arr = []; this.map.set(k, arr); }
    const found = arr.find((e) => e.uci === uci);
    if (found) found.weight += weight;
    else arr.push({ uci, weight });
  }

  /**
   * สร้าง book จากรายการ "แนวเปิด" (แต่ละแนวคือ array ของ uci moves)
   * @param {Board} startBoard  ตำแหน่งเริ่ม (จะถูก clone)
   * @param {string[][]} lines
   * @param {number} maxPly
   */
  static fromLines(startBoard, lines, maxPly = 20) {
    const book = new OpeningBook();
    for (const line of lines) {
      const b = startBoard.clone();
      for (let i = 0; i < line.length && i < maxPly; i++) {
        const mv = uciToMove(b, line[i]);
        if (!mv) break;
        book.addEntry(b, line[i], 1);
        b.makeMove(mv);
      }
    }
    return book;
  }

  /**
   * เลือกหมากจาก book สำหรับตำแหน่งปัจจุบัน
   * @param {Board} board
   * @param {'weighted'|'best'|'random'} mode
   * @returns {object|null} move object หรือ null ถ้าไม่มีในตำรา
   */
  probe(board, mode = 'weighted') {
    const arr = this.map.get(OpeningBook.key(board));
    if (!arr || arr.length === 0) return null;

    let chosen;
    if (mode === 'best') {
      chosen = arr.reduce((a, c) => (c.weight > a.weight ? c : a));
    } else if (mode === 'random') {
      chosen = arr[Math.floor(Math.random() * arr.length)];
    } else {
      const total = arr.reduce((s, e) => s + Math.max(0, e.weight), 0);
      let r = Math.random() * total;
      chosen = arr[arr.length - 1];
      for (const e of arr) { r -= Math.max(0, e.weight); if (r <= 0) { chosen = e; break; } }
    }
    return uciToMove(board, chosen.uci);
  }
}
