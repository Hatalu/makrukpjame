// ============================================================================
//  Engine MakrukThai  -  board.js
//  โครงสร้างกระดาน + make/undo move + FEN + Zobrist + ตรวจการรุก
// ============================================================================
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, KING,
  mk, pcType, pcColor, fileOf, rankOf, squareName, parseSquare,
  START_FEN, TYPE_TO_CHAR, CHAR_TO_TYPE, PROMO_RANK,
} from './constants.js';
import { squareAttackedBy } from './tables.js';
import {
  Z_PIECE_LO, Z_PIECE_HI, Z_SIDE_LO, Z_SIDE_HI,
} from './zobrist.js';
import { newCounting, cloneCounting, updateCounting } from './counting.js';

export class Board {
  constructor(fen) {
    /** @type {Int8Array} รหัสหมากต่อช่อง (0 = ว่าง) */
    this.board = new Int8Array(64);
    this.turn = WHITE;
    this.kingSq = [-1, -1];
    this.halfmove = 0;      // จำนวน ply ตั้งแต่กินตัว/เดินเบี้ยครั้งล่าสุด
    this.fullmove = 1;
    this.ply = 0;           // จำนวน ply ที่เดินมาแล้ว (นับจากตอน setFen)
    this.keyLo = 0;
    this.keyHi = 0;
    this.counting = newCounting();
    this._undo = [];        // สแต็คสำหรับ undoMove
    this._rep = [];         // ประวัติกุญแจ {lo,hi} ต่อ ply (ใช้ตรวจเสมอ 3 ครั้ง)
    this.setFen(fen || START_FEN);
  }

  // -------------------------------------------------------------------- FEN
  setFen(fen) {
    const parts = String(fen).trim().split(/\s+/);
    this.board.fill(EMPTY);
    this.kingSq = [-1, -1];

    const rows = parts[0].split('/');
    for (let ri = 0; ri < 8; ri++) {
      const rank = 7 - ri; // แถวแรกของ FEN = rank 8
      let file = 0;
      for (const ch of rows[ri] || '') {
        if (ch >= '1' && ch <= '9') { file += +ch; continue; }
        const lower = ch.toLowerCase();
        const type = CHAR_TO_TYPE[lower];
        if (!type) continue;
        const color = ch === lower ? BLACK : WHITE;
        const sq = rank * 8 + file;
        this.board[sq] = mk(color, type);
        if (type === KING) this.kingSq[color] = sq;
        file++;
      }
    }

    this.turn = (parts[1] || 'w') === 'b' ? BLACK : WHITE;

    // ข้าม field castling / en-passant ถ้ามี (หมากรุกไทยเป็น '-' เสมอ)
    let idx = 2;
    if (parts[idx] === '-' || /^[KQkqA-Ha-h]+$/.test(parts[idx] || '') && !/^\d/.test(parts[idx])) {
      if (parts[idx] === '-' || /[KQkq]/.test(parts[idx])) idx++;
    }
    if (parts[idx] === '-' || /^[a-h][1-8]$/.test(parts[idx] || '')) idx++;

    this.halfmove = parts[idx] !== undefined && /^\d+$/.test(parts[idx]) ? +parts[idx] : 0;
    this.fullmove = parts[idx + 1] !== undefined && /^\d+$/.test(parts[idx + 1]) ? +parts[idx + 1] : 1;

    // ตัวนับหมากแบบ incremental (ใช้เร่งกฎการนับ ไม่ต้องสแกน 64 ช่องทุกตา)
    this.npawns = 0;
    this.nNonKing = [0, 0];
    this.npieces = 0;
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (p === EMPTY) continue;
      this.npieces++;
      const ty = pcType(p);
      if (ty === PAWN) this.npawns++;
      if (ty !== KING) this.nNonKing[pcColor(p)]++;
    }

    this.ply = 0;
    this._undo.length = 0;
    this._rep.length = 0;
    this.counting = newCounting();
    this._recomputeKey();
    this._rep.push({ lo: this.keyLo, hi: this.keyHi });
    // เผื่อโหลดตำแหน่งที่ควรเริ่มนับหมากทันที
    updateCounting(this, /*movedType*/ 0, /*captured*/ EMPTY, /*firstEval*/ true);
  }

  fen() {
    let placement = '';
    for (let rank = 7; rank >= 0; rank--) {
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 8 + file];
        if (p === EMPTY) { empty++; continue; }
        if (empty) { placement += empty; empty = 0; }
        const ch = TYPE_TO_CHAR[pcType(p)];
        placement += pcColor(p) === WHITE ? ch.toUpperCase() : ch;
      }
      if (empty) placement += empty;
      if (rank > 0) placement += '/';
    }
    return `${placement} ${this.turn === WHITE ? 'w' : 'b'} - - ${this.halfmove} ${this.fullmove}`;
  }

  ascii() {
    const S = { 1: 'เบี้ย', 2: 'ม้า', 3: 'โคน', 4: 'เม็ด', 5: 'เรือ', 6: 'ขุน' };
    let out = '\n  +------------------------+\n';
    for (let rank = 7; rank >= 0; rank--) {
      out += `${rank + 1} |`;
      for (let file = 0; file < 8; file++) {
        const p = this.board[rank * 8 + file];
        if (p === EMPTY) { out += ' . '; continue; }
        const ch = TYPE_TO_CHAR[pcType(p)];
        out += ' ' + (pcColor(p) === WHITE ? ch.toUpperCase() : ch) + ' ';
      }
      out += '|\n';
    }
    out += '  +------------------------+\n    a  b  c  d  e  f  g  h\n';
    out += `  ตาเดิน: ${this.turn === WHITE ? 'ขาว (W)' : 'ดำ (b)'}   FEN: ${this.fen()}\n`;
    return out;
  }

  // ------------------------------------------------------------- zobrist
  _recomputeKey() {
    let lo = 0, hi = 0;
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (p === EMPTY) continue;
      lo ^= Z_PIECE_LO[p][s];
      hi ^= Z_PIECE_HI[p][s];
    }
    if (this.turn === BLACK) { lo ^= Z_SIDE_LO; hi ^= Z_SIDE_HI; }
    this.keyLo = lo | 0;
    this.keyHi = hi | 0;
  }

  _xorPiece(code, sq) {
    this.keyLo ^= Z_PIECE_LO[code][sq];
    this.keyHi ^= Z_PIECE_HI[code][sq];
  }

  // ------------------------------------------------------------- make/undo
  /** @param {{from:number,to:number,piece:number,captured:number,promotion:number}} m */
  makeMove(m) {
    const { from, to } = m;
    const us = this.turn, them = us ^ 1;
    const pc = this.board[from];
    const cap = m.captured;

    this._undo.push({
      cap,
      halfmove: this.halfmove,
      keyLo: this.keyLo,
      keyHi: this.keyHi,
      counting: cloneCounting(this.counting),
      promoted: m.promotion !== 0,
      isNull: false,
    });

    this._xorPiece(pc, from);
    if (cap !== EMPTY) this._xorPiece(cap, to);

    const placed = m.promotion !== 0 ? mk(us, MET) : pc;
    this.board[to] = placed;
    this.board[from] = EMPTY;
    this._xorPiece(placed, to);

    if (pcType(pc) === KING) this.kingSq[us] = to;

    // ปรับตัวนับ incremental
    if (cap !== EMPTY) {
      this.npieces--;
      this.nNonKing[them]--;
      if (pcType(cap) === PAWN) this.npawns--;
    }
    if (m.promotion !== 0) this.npawns--; // เบี้ย -> เม็ด

    this.halfmove = (pcType(pc) === PAWN || cap !== EMPTY) ? 0 : this.halfmove + 1;

    this.turn = them;
    this.keyLo ^= Z_SIDE_LO; this.keyHi ^= Z_SIDE_HI;
    if (us === BLACK) this.fullmove++;
    this.ply++;

    this._rep.push({ lo: this.keyLo, hi: this.keyHi });
    updateCounting(this, pcType(pc), cap, false);
  }

  undoMove(m) {
    const u = this._undo.pop();
    const them = this.turn;
    const us = them ^ 1;
    this.turn = us;
    if (us === BLACK) this.fullmove--;
    this.ply--;
    this._rep.pop();

    const { from, to } = m;
    const placed = this.board[to];
    const orig = u.promoted ? mk(us, PAWN) : placed;
    this.board[from] = orig;
    this.board[to] = u.cap;
    if (pcType(orig) === KING) this.kingSq[us] = from;

    if (u.promoted) this.npawns++;
    if (u.cap !== EMPTY) {
      this.npieces++;
      this.nNonKing[them]++;
      if (pcType(u.cap) === PAWN) this.npawns++;
    }

    this.halfmove = u.halfmove;
    this.keyLo = u.keyLo;
    this.keyHi = u.keyHi;
    this.counting = u.counting;
  }

  makeNullMove() {
    this._undo.push({
      halfmove: this.halfmove,
      keyLo: this.keyLo,
      keyHi: this.keyHi,
      counting: cloneCounting(this.counting),
      isNull: true,
    });
    this.turn ^= 1;
    this.keyLo ^= Z_SIDE_LO; this.keyHi ^= Z_SIDE_HI;
    this.halfmove++;
    this.ply++;
    this._rep.push({ lo: this.keyLo, hi: this.keyHi });
  }

  undoNullMove() {
    const u = this._undo.pop();
    this.turn ^= 1;
    this.halfmove = u.halfmove;
    this.keyLo = u.keyLo;
    this.keyHi = u.keyHi;
    this.counting = u.counting;
    this.ply--;
    this._rep.pop();
  }

  // ------------------------------------------------------------- queries
  isSquareAttacked(sq, by) { return squareAttackedBy(this.board, sq, by); }

  inCheck(side = this.turn) {
    return squareAttackedBy(this.board, this.kingSq[side], side ^ 1);
  }

  /** ตำแหน่งปัจจุบันซ้ำกับที่ผ่านมา >= needed ครั้งหรือไม่ */
  isRepetition(needed = 1) {
    const lo = this.keyLo, hi = this.keyHi;
    const len = this._rep.length;
    const floor = Math.max(0, len - 1 - this.halfmove);
    let count = 0;
    for (let i = len - 3; i >= floor; i -= 2) {
      const e = this._rep[i];
      if (e.lo === lo && e.hi === hi) {
        count++;
        if (count >= needed) return true;
      }
    }
    return false;
  }

  /** นับหมากแต่ละชนิดของทั้งสองฝ่าย -> Int8Array(16) index = pieceCode */
  pieceCounts() {
    const c = new Int8Array(16);
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (p !== EMPTY) c[p]++;
    }
    return c;
  }

  clone() {
    const b = Object.create(Board.prototype);
    b.board = this.board.slice();
    b.turn = this.turn;
    b.kingSq = this.kingSq.slice();
    b.halfmove = this.halfmove;
    b.fullmove = this.fullmove;
    b.ply = this.ply;
    b.keyLo = this.keyLo;
    b.keyHi = this.keyHi;
    b.counting = cloneCounting(this.counting);
    b.npawns = this.npawns;
    b.nNonKing = this.nNonKing.slice();
    b.npieces = this.npieces;
    b._undo = [];
    b._rep = this._rep.map((e) => ({ lo: e.lo, hi: e.hi }));
    return b;
  }
}

export { squareName, parseSquare, PROMO_RANK };
