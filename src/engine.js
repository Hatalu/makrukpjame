// ============================================================================
//  Engine MakrukThai  -  engine.js
//  หน้ากาก (facade) ระดับสูงสำหรับใช้งานจริงในเว็บฝึกหมากรุกไทย
//
//  ตัวอย่าง:
//    import { MakrukEngine } from './src/engine.js';
//    const eng = new MakrukEngine({ skill: 12 });
//    eng.move('f3f4');
//    const { bestMove } = eng.think({ movetime: 800 });
//    eng.move(bestMove);
//    console.log(eng.ascii(), eng.isGameOver());
// ============================================================================
import { START_FEN, WHITE, BLACK } from './constants.js';
import { Board } from './board.js';
import { legalMoves, perft as perftFn } from './movegen.js';
import { evaluate } from './evaluate.js';
import { insufficientMaterial } from './evaluate.js';
import { countingResult, describeCounting } from './counting.js';
import { Search } from './search.js';
import { moveToUci, uciToMove, moveToSan, sanToMove } from './notation.js';
import { OpeningBook } from './book.js';

export class MakrukEngine {
  constructor(opts = {}) {
    this.board = new Board(opts.fen || START_FEN);
    this.searcher = new Search(opts.hash || 16);
    this.book = opts.book instanceof OpeningBook ? opts.book
      : (opts.book ? OpeningBook.fromJSON(opts.book) : null);
    this.options = {
      skill: 20,
      useBook: true,
      bookMode: 'weighted',
      bookMaxPly: 16,
      moveTime: 1000,
    };
    this._moveStack = [];
    if (opts.skill != null) this.setOption('Skill Level', opts.skill);
    if (opts.contempt != null) this.setOption('Contempt', opts.contempt);
  }

  // --------------------------------------------------------------- state
  newGame() {
    this.board.setFen(START_FEN);
    this._moveStack.length = 0;
    this.searcher.clearTT();
  }
  setFen(fen) {
    this.board.setFen(fen);
    this._moveStack.length = 0;
  }
  fen() { return this.board.fen(); }
  ascii() { return this.board.ascii(); }
  turn() { return this.board.turn; }
  turnName() { return this.board.turn === WHITE ? 'white' : 'black'; }
  ply() { return this.board.ply; }

  // -------------------------------------------------------------- moves
  legalMoves() { return legalMoves(this.board).map(moveToUci); }
  legalMovesSan() {
    return legalMoves(this.board).map((m) => moveToSan(this.board, m));
  }
  legalMovesFrom(sqOrName) {
    const sq = typeof sqOrName === 'number' ? sqOrName
      : (sqOrName.charCodeAt(0) - 97) + (sqOrName.charCodeAt(1) - 49) * 8;
    return legalMoves(this.board).filter((m) => m.from === sq).map(moveToUci);
  }

  _resolve(x) {
    if (x && typeof x === 'object' && 'from' in x && 'to' in x) {
      // ตรวจซ้ำว่าถูกกติกา
      for (const m of legalMoves(this.board)) {
        if (m.from === x.from && m.to === x.to) return m;
      }
      return null;
    }
    const s = String(x).trim();
    return /^[a-h][1-8][a-h][1-8]/.test(s.toLowerCase())
      ? uciToMove(this.board, s)
      : sanToMove(this.board, s);
  }

  /** เดินหมาก 1 ตา (รับ uci / san / {from,to}) -> คืน move object; โยน error ถ้าผิดกติกา */
  move(x) {
    const m = this._resolve(x);
    if (!m) throw new Error('illegal move: ' + JSON.stringify(x));
    const san = moveToSan(this.board, m);
    this.board.makeMove(m);
    this._moveStack.push(m);
    return { ...m, uci: moveToUci(m), san };
  }

  /** ถอนหมากตาล่าสุด */
  undo() {
    const m = this._moveStack.pop();
    if (!m) return null;
    this.board.undoMove(m);
    return m;
  }

  history() { return this._moveStack.map(moveToUci); }

  // ------------------------------------------------------------- verdict
  isGameOver() {
    const lm = legalMoves(this.board);
    const inChk = this.board.inCheck();
    if (lm.length === 0) {
      if (inChk) {
        return {
          over: true,
          result: this.board.turn === WHITE ? '0-1' : '1-0',
          reason: 'checkmate',
          winner: this.board.turn === WHITE ? 'black' : 'white',
        };
      }
      return { over: true, result: '1/2-1/2', reason: 'stalemate' };
    }
    if (this.board.isRepetition(2)) return { over: true, result: '1/2-1/2', reason: 'threefold' };
    if (this.board.halfmove >= 100) return { over: true, result: '1/2-1/2', reason: 'fifty-move' };
    if (countingResult(this.board) === 'draw') return { over: true, result: '1/2-1/2', reason: 'counting' };
    if (insufficientMaterial(this.board)) return { over: true, result: '1/2-1/2', reason: 'insufficient-material' };
    return { over: false };
  }

  inCheck() { return this.board.inCheck(); }
  countingStatus() { return describeCounting(this.board); }
  /** คะแนนประเมิน (centipawn) มุมมองฝ่ายขาวเป็นบวก */
  evaluate() { return evaluate(this.board); }
  perft(depth) { return perftFn(this.board, depth); }

  // --------------------------------------------------------------- think
  /**
   * ให้เอนจิ้นคิดหาหมากที่ดีที่สุด
   * @param {{movetime?:number, depth?:number, nodes?:number, useBook?:boolean}} limits
   * @param {(info:object)=>void} [onInfo]
   */
  think(limits = {}, onInfo) {
    const useBook = limits.useBook ?? this.options.useBook;
    if (useBook && this.book && this.board.ply < this.options.bookMaxPly) {
      const bm = this.book.probe(this.board, this.options.bookMode);
      if (bm) {
        return {
          bestMove: moveToUci(bm), move: bm, book: true,
          score: 0, depth: 0, nodes: 0, nps: 0, pv: [moveToUci(bm)],
        };
      }
    }
    const l = {
      depth: limits.depth,
      nodes: limits.nodes,
      movetime: limits.depth || limits.nodes ? limits.movetime : (limits.movetime ?? this.options.moveTime),
    };
    return this.searcher.think(this.board, l, onInfo);
  }

  /** คิดแล้วเดินให้เลย -> คืนข้อมูลหมากที่เดิน */
  go(limits = {}, onInfo) {
    const r = this.think(limits, onInfo);
    if (!r.bestMove) return null;
    const played = this.move(r.bestMove);
    return { ...played, score: r.score, depth: r.depth, nodes: r.nodes, book: !!r.book, pv: r.pv };
  }

  // -------------------------------------------------------------- options
  setOption(name, value) {
    switch (String(name).toLowerCase()) {
      case 'skill level': case 'skill':
        this.options.skill = clamp(+value, 0, 20);
        this.searcher.skill = this.options.skill;
        break;
      case 'hash':
        this.searcher.resize(Math.max(1, +value | 0));
        break;
      case 'contempt':
        this.searcher.contempt = +value | 0;
        break;
      case 'ownbook': case 'usebook':
        this.options.useBook = !!value && value !== 'false';
        break;
      case 'bookmode':
        this.options.bookMode = String(value);
        break;
      case 'bookmaxply':
        this.options.bookMaxPly = +value | 0;
        break;
      case 'movetime':
        this.options.moveTime = +value | 0;
        break;
      default:
        return false;
    }
    return true;
  }

  loadBook(json) { this.book = OpeningBook.fromJSON(json); }
  setBook(book) { this.book = book; }
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

export { Board, OpeningBook, WHITE, BLACK };
export { moveToUci, uciToMove, moveToSan, sanToMove } from './notation.js';
export { legalMoves, perft } from './movegen.js';
export { evaluate } from './evaluate.js';
