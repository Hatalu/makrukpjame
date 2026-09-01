// ============================================================================
//  Engine MakrukThai  -  search.js
//  การค้นหา alpha-beta แบบ Stockfish-lite:
//    iterative deepening + aspiration window + PVS
//    transposition table (64-bit key, สอง 32-bit)
//    null-move pruning, late move reductions, reverse futility
//    quiescence search (กินตัว + เลื่อนขั้น) + delta pruning
//    move ordering: TT move / MVV-LVA / killers / history
//    รองรับระดับความเก่ง (Skill Level 0..20) สำหรับเว็บฝึกซ้อม
// ============================================================================
import {
  WHITE, BLACK, EMPTY, PAWN, KNIGHT, KHON, MET, ROOK, KING,
  mk, pcType, pcColor, PIECE_VALUE,
  MATE, MATE_IN_MAX, INF, DRAW_SCORE, MAX_PLY,
} from './constants.js';
import { generateMoves } from './movegen.js';
import { squareAttackedBy } from './tables.js';
import { evaluate, insufficientMaterial } from './evaluate.js';
import { countingResult } from './counting.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const FLAG_NONE = 0, FLAG_EXACT = 1, FLAG_LOWER = 2, FLAG_UPPER = 3;

const packMove = (m) => (m.from | (m.to << 6) | ((m.promotion ? 1 : 0) << 12));

export class Search {
  constructor(hashMb = 16) {
    this.skill = 20;
    this.contempt = 0;
    this.history = new Int32Array(15 * 64);
    this.killers = new Int32Array(MAX_PLY * 2);
    this._pv = [];
    this.resize(hashMb);
    this._rng = 0x2545f491 >>> 0;
  }

  // -------------------------------------------------------- transposition
  resize(mb) {
    const bytesPerEntry = 16;
    let entries = Math.max(1 << 12, Math.floor((mb * 1024 * 1024) / bytesPerEntry));
    let pow = 1;
    while (pow * 2 <= entries) pow *= 2;
    this.ttSize = pow;
    this.ttMask = pow - 1;
    this.ttKey = new Int32Array(pow);     // lock = keyHi
    this.ttMove = new Int32Array(pow);
    this.ttScore = new Int32Array(pow);
    this.ttDepth = new Int8Array(pow);
    this.ttFlag = new Uint8Array(pow);
    this.ttGen = new Uint8Array(pow);
    this.generation = 0;
  }
  clearTT() {
    this.ttKey.fill(0); this.ttMove.fill(0); this.ttScore.fill(0);
    this.ttDepth.fill(0); this.ttFlag.fill(0); this.ttGen.fill(0);
  }

  _rand() {
    // xorshift32
    let x = this._rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this._rng = x;
    return x / 4294967296;
  }

  // -------------------------------------------------------------- driver
  /**
   * @param {import('./board.js').Board} board
   * @param {{movetime?:number, depth?:number, nodes?:number}} limits
   * @param {(info:object)=>void} [onInfo]
   */
  think(board, limits = {}, onInfo) {
    this.board = board;
    this.nodes = 0;
    this.stopped = false;
    this.startTime = now();
    this.deadline = limits.movetime ? this.startTime + limits.movetime : Infinity;
    this.nodeLimit = limits.nodes || Infinity;
    this.history.fill(0);
    this.killers.fill(0);
    this.generation = (this.generation + 1) & 0xff;
    this.rootScores = [];

    const rootMoves = this._legalRoot();
    if (rootMoves.length === 0) {
      return { bestMove: null, move: null, score: 0, depth: 0, pv: [], nodes: 0, nps: 0 };
    }

    const skillMaxDepth = this.skill >= 20 ? 99 : Math.max(2, this.skill + 2);
    const maxDepth = Math.min(limits.depth || 64, skillMaxDepth, MAX_PLY - 2);
    const totalTime = this.deadline === Infinity ? Infinity : this.deadline - this.startTime;

    let best = rootMoves[0];
    let bestScore = 0;
    let completedDepth = 0;
    let lastPv = [best];
    let prevIterTime = 0;

    for (let d = 1; d <= maxDepth; d++) {
      const iterStart = now();
      this.rootBest = null;
      this.rootScores = [];
      let score;

      if (d >= 4 && Math.abs(bestScore) < MATE_IN_MAX) {
        let window = 24;
        let a = bestScore - window, bta = bestScore + window;
        for (;;) {
          score = this._search(a, bta, d, 0, true);
          if (this.stopped) break;
          if (score <= a) { window *= 2; a = bestScore - window; if (window > 700) a = -INF; }
          else if (score >= bta) { window *= 2; bta = bestScore + window; if (window > 700) bta = INF; }
          else break;
        }
      } else {
        score = this._search(-INF, INF, d, 0, true);
      }

      if (this.stopped && d > 1) break;

      if (this.rootBest) { best = this.rootBest; bestScore = score; }
      completedDepth = d;
      lastPv = this._extractPv(best, d);

      if (onInfo) {
        const t = now() - this.startTime;
        onInfo({
          depth: d,
          score: bestScore,
          scoreType: Math.abs(bestScore) >= MATE_IN_MAX ? 'mate' : 'cp',
          mate: Math.abs(bestScore) >= MATE_IN_MAX
            ? Math.sign(bestScore) * Math.ceil((MATE - Math.abs(bestScore)) / 2)
            : undefined,
          nodes: this.nodes,
          time: Math.round(t),
          nps: t > 0 ? Math.round((this.nodes / t) * 1000) : 0,
          pv: lastPv.map((m) => require_uci(m)),
        });
      }

      if (Math.abs(bestScore) >= MATE_IN_MAX) break;

      // คาดการณ์เวลาของ iteration ถัดไป (~2.2x ของรอบนี้) ถ้าไม่น่าจบทันก็หยุด
      if (totalTime !== Infinity && d >= 4) {
        const elapsed = now() - this.startTime;
        const thisIter = now() - iterStart;
        const predictNext = Math.max(thisIter, prevIterTime) * 2.2;
        if (elapsed + predictNext > totalTime) break;
      }
      prevIterTime = now() - iterStart;
    }

    let chosen = best;
    if (this.skill < 20) chosen = this._applySkill(best, bestScore) || best;

    const t = now() - this.startTime;
    return {
      bestMove: require_uci(chosen),
      move: chosen,
      score: bestScore,
      depth: completedDepth,
      pv: lastPv.map((m) => require_uci(m)),
      nodes: this.nodes,
      nps: t > 0 ? Math.round((this.nodes / t) * 1000) : 0,
    };
  }

  _legalRoot() {
    const b = this.board;
    const pseudo = [];
    generateMoves(b, pseudo);
    const us = b.turn;
    const out = [];
    for (const m of pseudo) {
      b.makeMove(m);
      if (!squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) out.push(m);
      b.undoMove(m);
    }
    return out;
  }

  _checkTime() {
    if (this.nodes >= this.nodeLimit || now() >= this.deadline) this.stopped = true;
  }

  _stmEval() {
    const e = evaluate(this.board);
    return this.board.turn === WHITE ? e : -e;
  }

  _hasNonKingPawnMaterial(side) {
    const bd = this.board.board;
    for (let s = 0; s < 64; s++) {
      const p = bd[s];
      if (p === EMPTY || pcColor(p) !== side) continue;
      const t = pcType(p);
      if (t === KNIGHT || t === KHON || t === MET || t === ROOK) return true;
    }
    return false;
  }

  _drawScore() {
    // contempt เล็กน้อย: ฝ่ายเดินไม่ชอบเสมอ
    return DRAW_SCORE - (this.board.turn === WHITE ? this.contempt : -this.contempt);
  }

  // ----------------------------------------------------------- alpha-beta
  _search(alpha, beta, depth, ply, isPvRoot) {
    const b = this.board;
    this.nodes++;
    if ((this.nodes & 2047) === 0) this._checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 2) return this._stmEval();

    const pvNode = beta - alpha > 1;

    if (ply > 0) {
      if (b.isRepetition(1) || b.halfmove >= 100 ||
          countingResult(b) === 'draw' || insufficientMaterial(b)) {
        return this._drawScore();
      }
      // mate distance pruning
      if (alpha < -MATE + ply) alpha = -MATE + ply;
      if (beta > MATE - ply - 1) beta = MATE - ply - 1;
      if (alpha >= beta) return alpha;
    }

    const inChk = b.inCheck();
    if (depth <= 0 && !inChk) return this._quiesce(alpha, beta, ply);
    if (depth < 0) depth = 0;

    // ---- TT probe ----
    const idx = (b.keyLo >>> 0) & this.ttMask;
    const lock = b.keyHi | 0;
    let ttMove = 0;
    if (this.ttFlag[idx] !== FLAG_NONE && this.ttKey[idx] === lock) {
      ttMove = this.ttMove[idx];
      if (!pvNode && this.ttDepth[idx] >= depth) {
        let s = this.ttScore[idx];
        if (s >= MATE_IN_MAX) s -= ply;
        else if (s <= -MATE_IN_MAX) s += ply;
        const f = this.ttFlag[idx];
        if (f === FLAG_EXACT) return s;
        if (f === FLAG_LOWER && s >= beta) return s;
        if (f === FLAG_UPPER && s <= alpha) return s;
      }
    }

    const staticEval = inChk ? -INF : this._stmEval();

    // ---- reverse futility / static null ----
    if (!pvNode && !inChk && depth <= 6 &&
        staticEval - 78 * depth >= beta && Math.abs(beta) < MATE_IN_MAX) {
      return staticEval;
    }

    // ---- null-move pruning ----
    if (!pvNode && !inChk && depth >= 3 &&
        staticEval >= beta && Math.abs(beta) < MATE_IN_MAX &&
        this._hasNonKingPawnMaterial(b.turn)) {
      const R = 2 + ((depth / 4) | 0);
      b.makeNullMove();
      const s = -this._search(-beta, -beta + 1, depth - 1 - R, ply + 1, false);
      b.undoNullMove();
      if (this.stopped) return 0;
      if (s >= beta) return s >= MATE_IN_MAX ? beta : s;
    }

    // ---- generate & order ----
    const moves = [];
    generateMoves(b, moves);
    this._order(moves, ttMove, ply);

    const us = b.turn;
    let bestScore = -INF;
    let bestMove = 0;
    let flag = FLAG_UPPER;
    let legal = 0;
    const rootFull = ply === 0 && this.skill < 20;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      b.makeMove(m);
      if (squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) { b.undoMove(m); continue; }
      legal++;

      const gcheck = squareAttackedBy(b.board, b.kingSq[b.turn], b.turn ^ 1);
      const isCap = m.captured !== EMPTY;
      const isProm = m.promotion !== 0;
      const ext = gcheck ? 1 : 0;
      const newDepth = depth - 1 + ext;

      let s;
      if (legal === 1 || rootFull) {
        s = -this._search(-beta, -alpha, newDepth, ply + 1, false);
      } else {
        let red = 0;
        if (depth >= 3 && legal > 3 && !isCap && !isProm && !gcheck && !inChk) {
          red = 1 + ((depth > 6 && legal > 6) ? 1 : 0);
        }
        s = -this._search(-alpha - 1, -alpha, newDepth - red, ply + 1, false);
        if (s > alpha && (red > 0 || (pvNode && s < beta))) {
          s = -this._search(-beta, -alpha, newDepth, ply + 1, false);
        }
      }

      b.undoMove(m);
      if (this.stopped) return 0;

      if (ply === 0) this.rootScores.push({ move: m, score: s });

      if (s > bestScore) {
        bestScore = s;
        bestMove = packMove(m);
        if (s > alpha) {
          alpha = s;
          flag = FLAG_EXACT;
          if (ply === 0) { this.rootBest = m; this.rootBestScore = s; }
          if (s >= beta) {
            flag = FLAG_LOWER;
            if (!isCap && !isProm) {
              this._addKiller(ply, m);
              this.history[(m.piece << 6) + m.to] += depth * depth;
            }
            break;
          }
        }
      }
    }

    if (legal === 0) {
      // รุกจน = แพ้  /  อับ (stalemate) = เสมอ  (กติกาหมากรุกไทย)
      return inChk ? -MATE + ply : this._drawScore();
    }

    // ---- TT store ----
    let store = bestScore;
    if (store >= MATE_IN_MAX) store += ply;
    else if (store <= -MATE_IN_MAX) store -= ply;
    const replace = this.ttFlag[idx] === FLAG_NONE ||
      this.ttGen[idx] !== this.generation ||
      depth >= this.ttDepth[idx];
    if (replace) {
      this.ttKey[idx] = lock;
      this.ttMove[idx] = bestMove || ttMove;
      this.ttScore[idx] = store;
      this.ttDepth[idx] = depth;
      this.ttFlag[idx] = flag;
      this.ttGen[idx] = this.generation;
    }

    return bestScore;
  }

  // ----------------------------------------------------------- quiescence
  _quiesce(alpha, beta, ply) {
    const b = this.board;
    this.nodes++;
    if ((this.nodes & 2047) === 0) this._checkTime();
    if (this.stopped) return 0;
    if (ply >= MAX_PLY - 1) return this._stmEval();

    const inChk = b.inCheck();
    let best;
    if (inChk) {
      best = -INF;
    } else {
      best = this._stmEval();
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    }

    const moves = [];
    generateMoves(b, moves, !inChk); // ถ้าถูกรุก -> สร้างทุกตาหนีรุก
    this._order(moves, 0, ply);

    const us = b.turn;
    let anyLegal = false;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];

      if (!inChk) {
        // delta pruning
        const gain = m.captured !== EMPTY ? PIECE_VALUE[pcType(m.captured)] : 0;
        const promoGain = m.promotion ? PIECE_VALUE[MET] - PIECE_VALUE[PAWN] : 0;
        if (best + gain + promoGain + 90 < alpha) continue;
      }

      b.makeMove(m);
      if (squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) { b.undoMove(m); continue; }
      anyLegal = true;
      const s = -this._quiesce(-beta, -alpha, ply + 1);
      b.undoMove(m);
      if (this.stopped) return 0;

      if (s > best) {
        best = s;
        if (s > alpha) {
          alpha = s;
          if (s >= beta) return s;
        }
      }
    }

    if (inChk && !anyLegal) return -MATE + ply;
    return best;
  }

  // ------------------------------------------------------------- ordering
  _order(moves, ttMove, ply) {
    const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const pm = packMove(m);
      let sc;
      if (pm === ttMove) sc = 2_000_000;
      else if (m.captured !== EMPTY) {
        sc = 1_000_000 + 16 * PIECE_VALUE[pcType(m.captured)] - PIECE_VALUE[pcType(m.piece)];
        if (m.promotion) sc += 300_000;
      } else if (m.promotion) sc = 900_000;
      else if (pm === k0) sc = 800_000;
      else if (pm === k1) sc = 790_000;
      else sc = this.history[(m.piece << 6) + m.to] | 0;
      m.score = sc;
    }
    moves.sort((a, c) => c.score - a.score);
  }

  _addKiller(ply, m) {
    const pm = packMove(m);
    const i = ply * 2;
    if (this.killers[i] !== pm) {
      this.killers[i + 1] = this.killers[i];
      this.killers[i] = pm;
    }
  }

  // -------------------------------------------------------------- PV / skill
  _extractPv(firstMove, maxLen) {
    const b = this.board;
    const pv = [];
    const applied = [];
    const seen = new Set();
    let cur = firstMove;

    for (let d = 0; d < maxLen + 2 && cur; d++) {
      // ตรวจว่า cur ถูกกติกาในตำแหน่งนี้
      const legal = [];
      generateMoves(b, legal);
      let ok = null;
      for (const mm of legal) {
        if (mm.from === cur.from && mm.to === cur.to && (!!mm.promotion === !!cur.promotion)) { ok = mm; break; }
      }
      if (!ok) break;
      const us = b.turn;
      b.makeMove(ok);
      if (squareAttackedBy(b.board, b.kingSq[us], us ^ 1)) { b.undoMove(ok); break; }
      pv.push(ok);
      applied.push(ok);
      const key = (b.keyLo >>> 0) + ':' + (b.keyHi >>> 0);
      if (seen.has(key)) break;
      seen.add(key);

      const idx = (b.keyLo >>> 0) & this.ttMask;
      if (this.ttFlag[idx] === FLAG_NONE || this.ttKey[idx] !== (b.keyHi | 0)) { cur = null; }
      else {
        const pk = this.ttMove[idx];
        if (!pk) { cur = null; }
        else cur = { from: pk & 63, to: (pk >> 6) & 63, promotion: (pk >> 12) & 1 ? MET : 0 };
      }
    }

    for (let i = applied.length - 1; i >= 0; i--) b.undoMove(applied[i]);
    return pv.length ? pv : (firstMove ? [firstMove] : []);
  }

  _applySkill(best, bestScore) {
    if (!this.rootScores || this.rootScores.length <= 1) return best;
    let top = -INF;
    for (const r of this.rootScores) if (r.score > top) top = r.score;
    const margin = (20 - this.skill) * 12 + 12;
    const pool = this.rootScores.filter((r) => r.score >= top - margin);
    if (pool.length <= 1) return best;
    const temp = 45 + (20 - this.skill) * 10;
    const weights = pool.map((r) => Math.exp((r.score - top) / temp));
    const sum = weights.reduce((a, c) => a + c, 0);
    let pick = this._rand() * sum;
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i];
      if (pick <= 0) return pool[i].move;
    }
    return pool[pool.length - 1].move;
  }
}

// helper แยกไว้ท้ายไฟล์เพื่อเลี่ยง import วนกับ notation.js
function require_uci(m) {
  if (!m) return null;
  const a = 'abcdefgh'[m.from & 7] + ((m.from >> 3) + 1);
  const b = 'abcdefgh'[m.to & 7] + ((m.to >> 3) + 1);
  return a + b + (m.promotion ? '=M' : '');
}
