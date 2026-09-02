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
  mk, pcType, pcColor, PIECE_VALUE, PROMO_RANK, rankOf,
  MATE, MATE_IN_MAX, INF, DRAW_SCORE, MAX_PLY,
} from './constants.js';
import { generateMoves } from './movegen.js';
import {
  squareAttackedBy, KNIGHT_MOVES, KING_MOVES, MET_MOVES,
  KHON_ATK_FROM, PAWN_ATK_FROM, ROOK_RAYS,
} from './tables.js';
import { evaluate, insufficientMaterial } from './evaluate.js';
import { countingResult } from './counting.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const FLAG_NONE = 0, FLAG_EXACT = 1, FLAG_LOWER = 2, FLAG_UPPER = 3;

// ค่าหมากสำหรับ SEE (index by type)
const SEE_VAL = [0, 100, 315, 255, 190, 510, 20000];
const _seeOcc = new Uint8Array(64);
const _seeGain = new Int32Array(40);

/**
 * SEE - static exchange evaluation บนช่อง m.to (มุมมองฝ่ายที่เดิน m)
 * ใช้เฉพาะกับหมากกินตัว  คืนผลได้-เสียสุทธิ (centipawn)
 */
function see(bd, m) {
  const to = m.to, from = m.from;
  let side = pcColor(bd[from]) ^ 1;
  for (let i = 0; i < 64; i++) _seeOcc[i] = bd[i] !== EMPTY ? 1 : 0;
  _seeOcc[from] = 0;

  let d = 0;
  _seeGain[0] = m.captured !== EMPTY ? SEE_VAL[pcType(m.captured)] : 0;
  if (m.promotion) _seeGain[0] += SEE_VAL[MET] - SEE_VAL[PAWN];

  const fromType = pcType(bd[from]);
  let atkVal = (m.promotion && fromType === PAWN) ? SEE_VAL[MET] : SEE_VAL[fromType];

  for (;;) {
    const aSq = seeLeastAttacker(bd, to, side);
    if (aSq < 0) break;
    d++;
    _seeGain[d] = atkVal - _seeGain[d - 1];
    if (Math.max(-_seeGain[d - 1], _seeGain[d]) < 0) break;
    const t2 = pcType(bd[aSq]);
    atkVal = (t2 === PAWN && rankOf(to) === PROMO_RANK[side]) ? SEE_VAL[MET] : SEE_VAL[t2];
    _seeOcc[aSq] = 0;
    side ^= 1;
  }
  while (--d > 0) _seeGain[d - 1] = -Math.max(-_seeGain[d - 1], _seeGain[d]);
  return _seeGain[0];
}

/** square ของหมากฝ่าย side ที่ถูกที่สุดซึ่งจู่โจม `to` ตาม _seeOcc ปัจจุบัน (หรือ -1) */
function seeLeastAttacker(bd, to, side) {
  const pf = PAWN_ATK_FROM[side][to], pc = mk(side, PAWN);
  for (let i = 0; i < pf.length; i++) if (_seeOcc[pf[i]] && bd[pf[i]] === pc) return pf[i];
  const nm = KNIGHT_MOVES[to], nc = mk(side, KNIGHT);
  for (let i = 0; i < nm.length; i++) if (_seeOcc[nm[i]] && bd[nm[i]] === nc) return nm[i];
  const sm = KHON_ATK_FROM[side][to], sc = mk(side, KHON);
  for (let i = 0; i < sm.length; i++) if (_seeOcc[sm[i]] && bd[sm[i]] === sc) return sm[i];
  const mm = MET_MOVES[to], mc = mk(side, MET);
  for (let i = 0; i < mm.length; i++) if (_seeOcc[mm[i]] && bd[mm[i]] === mc) return mm[i];
  const rays = ROOK_RAYS[to], rc = mk(side, ROOK);
  for (let dd = 0; dd < 4; dd++) {
    const ray = rays[dd];
    for (let i = 0; i < ray.length; i++) {
      const q = ray[i];
      if (!_seeOcc[q]) continue;
      if (bd[q] === rc) return q;
      break;
    }
  }
  const km = KING_MOVES[to], kc = mk(side, KING);
  for (let i = 0; i < km.length; i++) if (_seeOcc[km[i]] && bd[km[i]] === kc) return km[i];
  return -1;
}

// ---- ตารางระดับความเก่ง (Skill 0..20) ----------------------------------
//  ยิ่งต่ำ = ค้นหาตื้น + สุ่มพลาดบ่อย + ใช้เวลาน้อย   ยิ่งสูง = เต็มกำลัง
const SKILL_DEPTH  = [1, 1, 2, 2, 3, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 26, 40, 64, 99];
const SKILL_BLUNDER = [0.62, 0.54, 0.47, 0.40, 0.34, 0.28, 0.23, 0.18, 0.14, 0.10, 0.07,
                       0.05, 0.03, 0.018, 0.010, 0.004, 0, 0, 0, 0, 0];
const SKILL_TIMEFRAC = [0.20, 0.24, 0.28, 0.33, 0.38, 0.44, 0.50, 0.57, 0.64, 0.72, 0.80,
                        0.86, 0.91, 0.95, 0.98, 1, 1, 1, 1, 1, 1];

const packMove = (m) => (m.from | (m.to << 6) | ((m.promotion ? 1 : 0) << 12));

export class Search {
  constructor(hashMb = 16) {
    this.skill = 20;
    this.contempt = 0;
    this.history = new Int32Array(15 * 64);
    this.killers = new Int32Array(MAX_PLY * 2);
    this._pv = [];
    this.resize(hashMb);
    // seed แบบสุ่มต่อ instance เพื่อให้บอทไม่เดินซ้ำเดิมทุกเกม (override ได้ด้วย setSeed)
    this._rng = (((Date.now() >>> 0) ^ 0x2545f491) >>> 0) || 0x2545f491;
  }

  setSeed(n) { this._rng = (n >>> 0) || 0x2545f491; }

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
    const sk = Math.max(0, Math.min(20, this.skill | 0));
    const timeFrac = sk >= 20 ? 1 : SKILL_TIMEFRAC[sk];
    this.deadline = limits.movetime ? this.startTime + limits.movetime * timeFrac : Infinity;
    this.nodeLimit = limits.nodes || Infinity;
    this.history.fill(0);
    this.killers.fill(0);
    this.generation = (this.generation + 1) & 0xff;
    this.rootScores = [];
    this.rootScoresDone = null;

    const rootMoves = this._legalRoot();
    if (rootMoves.length === 0) {
      return { bestMove: null, move: null, score: 0, depth: 0, pv: [], nodes: 0, nps: 0 };
    }

    const skillMaxDepth = sk >= 20 ? 99 : SKILL_DEPTH[sk];
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
      if (this.rootScores.length) this.rootScoresDone = this.rootScores.slice();
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
    if (sk < 20) chosen = this._applySkill(best, sk, bestScore) || best;

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
        // ข้ามการกินตัวที่ SEE ติดลบ (แลกแล้วเสียเปล่า)
        if (m.captured !== EMPTY && !m.promotion && see(b.board, m) < 0) continue;
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
  //  TT > กินตัวชนะ(SEE>=0, MVV-LVA) > เลื่อนขั้น > killers > history(quiet) > กินตัวเสีย(SEE<0)
  _order(moves, ttMove, ply) {
    const k0 = this.killers[ply * 2], k1 = this.killers[ply * 2 + 1];
    const bd = this.board.board;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const pm = packMove(m);
      let sc;
      if (pm === ttMove) sc = 3_000_000;
      else if (m.captured !== EMPTY) {
        const mvv = 16 * PIECE_VALUE[pcType(m.captured)] - PIECE_VALUE[pcType(m.piece)];
        const good = see(bd, m) >= 0;
        sc = (good ? 2_000_000 : 100_000) + mvv + (m.promotion ? 500_000 : 0);
      } else if (m.promotion) sc = 1_900_000;
      else if (pm === k0) sc = 1_800_000;
      else if (pm === k1) sc = 1_790_000;
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

  /**
   * ปรับหมากที่จะเดินตามระดับความเก่ง (เรียกเมื่อ sk < 20)
   *  - โอกาส "พลาด" : สุ่มหมากจากครึ่งที่แย่กว่า (ยิ่ง skill ต่ำยิ่งบ่อย)
   *  - ปกติ         : สุ่มแบบถ่วงน้ำหนักจากกลุ่มหมากที่ใกล้เคียงหมากดีที่สุด
   *  (ใช้ร่วมกับการจำกัดความลึก/เวลาใน think() ซึ่งเป็นตัวหลักที่ทำให้อ่อนลง)
   */
  _applySkill(best, sk, bestScore) {
    const rs = this.rootScoresDone && this.rootScoresDone.length ? this.rootScoresDone : this.rootScores;
    if (!rs || rs.length <= 1) return best;

    const sorted = rs.slice().sort((a, c) => c.score - a.score);
    const top = sorted[0].score;

    // ห้ามพลาดถ้ากำลังจะโดนรุกจน / หรือมีทางรุกจนอยู่ในมือ
    const nearMate = Math.abs(top) >= MATE_IN_MAX || Math.abs(bestScore) >= MATE_IN_MAX;

    // 1) โอกาสเล่นพลาด
    const blunder = sk < SKILL_BLUNDER.length ? SKILL_BLUNDER[sk] : 0;
    if (!nearMate && blunder > 0 && this._rand() < blunder && sorted.length >= 2) {
      // เลือกจากครึ่งล่าง (แต่ไม่เอาหมากที่แย่หนักจนโดนรุกจนทันที ถ้าเลี่ยงได้)
      const start = Math.max(1, Math.floor(sorted.length / 2));
      const tail = sorted.slice(start).filter((r) => r.score > -MATE_IN_MAX);
      const bag = tail.length ? tail : sorted.slice(1);
      return bag[(this._rand() * bag.length) | 0].move;
    }

    // 2) สุ่มถ่วงน้ำหนักจากกลุ่มใกล้หมากดีที่สุด (คมที่ระดับสูง กว้างที่ระดับต่ำ)
    const g = 20 - sk;
    const margin = Math.pow(g, 1.6) * 3 + 8;            // cp: sk19≈11 · sk12≈95 · sk4≈280
    const pool = sorted.filter((r) => r.score >= top - margin);
    if (pool.length <= 1) return best;
    const temp = Math.pow(g, 1.5) * 4 + 18;
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
