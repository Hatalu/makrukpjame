// ============================================================================
//  Engine MakrukThai  -  jameai.js
//  "JameAI" — บุคลิกการเล่นแบบนักแหกหมาก
//
//  แนวคิด 3 ข้อ
//    1. ไม่ค่อยอยากเดินเสมอ   -> contempt อ้างอิงฝ่ายเรา + veto ตาที่พาไปเสมอทันที
//    2. ชอบแหกหมาก / เดินเสี่ยง -> ให้คะแนน "ความแหก" (risk) กับทุกตาเดิน
//    3. แต่ต้องพิสูจน์ได้ก่อน   -> ตาเสี่ยงจะถูกค้นหาซ้ำแบบ full-window
//                               ถ้าผลลัพธ์ "ไม่ได้เปรียบ" หรือแย่กว่าตาดีสุดเกิน margin
//                               -> ไม่เดินทางนั้นเด็ดขาด
//
//  ผลลัพธ์: ได้เอนจิ้นที่เล่นดุ บูชาการบุก แต่ไม่เคยเสียสละแบบมั่ว
//  เพราะทุกการเสียสละผ่านการคำนวณล่วงหน้าแล้วว่ายังดีกว่าหรือเท่าเดิม
//
//  ใช้งาน:
//    import { MakrukEngine } from './engine.js';
//    import { JameAI } from './jameai.js';
//    const eng = new MakrukEngine();
//    const jame = new JameAI(eng);
//    const r = jame.pickMove({ movetime: 1500 });   // หรือ { depth: 8 }
//    eng.move(r.bestMove);
// ============================================================================
import {
  EMPTY, PAWN, KING, MET,
  pcType, pcColor, rankOf, fileOf, PIECE_VALUE, MATE_IN_MAX, PROMO_RANK,
} from './constants.js';
import { generateMoves, legalMoves } from './movegen.js';
import { see, Search } from './search.js';
import { countingResult } from './counting.js';
import { insufficientMaterial } from './evaluate.js';
import { moveToUci } from './notation.js';

const jameNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** ค่าตั้งต้นของบุคลิก JameAI */
export const JAME_DEFAULTS = {
  contempt: 45,        // เกลียดเสมอแค่ไหน (centipawn) — ยิ่งสูงยิ่งดิ้นหนีเสมอ
  margin: 30,          // ยอมให้ตาแหกแย่กว่าตาดีสุดได้ไม่เกินเท่านี้ (ตอนสูสี)
  minEdge: 0,          // ผลหลังแหกต้องไม่ต่ำกว่านี้ = ต้องไม่เสียเปรียบ (ตามโจทย์)
  minRisk: 60,         // ต้องเสียสละจริงอย่างน้อยเท่านี้ถึงเรียกว่า "แหก"
  maxCandidates: 3,    // ตรวจสอบตาแหกได้มากสุดกี่ตา
  riskWeight: 0.06,    // น้ำหนักความแหกตอนจัดอันดับ (risk -> centipawn)
  drawTolerance: 70,   // ยอมเสียแต้มเท่าไหร่เพื่อหนีเสมอ
  verifyFrac: 0.45,    // สัดส่วนเวลาที่กันไว้ "พิสูจน์" ตาแหก
  verifyExtra: 1,      // verify ลึกกว่าการค้นหาหลักกี่ ply (การเสียสละต้องมองไกลกว่า)
  convertAt: 250,      // ได้เปรียบเกินนี้ = เก็บให้จบ อย่าโชว์ลีลา
  desperateAt: -250,   // เสียเปรียบเกินนี้ = ต้องเสี่ยงแล้ว
};

/**
 * margin ที่ใช้จริง ขึ้นกับว่าตอนนี้ได้เปรียบหรือเสียเปรียบ
 *   ชนะอยู่ -> แทบไม่ยอมเสียแต้ม (เก็บเกมให้จบ)
 *   สูสี   -> ยอมได้ตามค่าตั้ง
 *   แพ้อยู่ -> ยอมเสี่ยงหนักขึ้น (ไม่งั้นก็แพ้อยู่ดี)
 */
/** การคำนวณล่วงหน้าเชื่อได้แค่ไหน: ลึก 3 = 0, ลึก 9+ = เต็ม */
export function depthTrust(verifyDepth) {
  return Math.max(0, Math.min(1, (verifyDepth - 3) / 6));
}

/**
 * ตาแหกต้องได้คะแนนอย่างน้อย  sBest + requiredEdge  ถึงจะเล่น
 *   ตื้น  -> ต้อง "ดีกว่า" ตาดีสุดชัดเจน (+40) เพราะการทิ้งหมากที่มองไม่ไกลมักเป็นภาพลวง
 *   ลึก  -> ยอมให้แย่กว่าได้ตาม margin ที่ปรับตามสถานการณ์
 */
export function requiredEdge(o, bestScore, verifyDepth) {
  const t = depthTrust(verifyDepth);
  const allow = effectiveMargin(o, bestScore);
  return 40 + (-allow - 40) * t;
}

export function effectiveMargin(o, bestScore) {
  if (bestScore >= o.convertAt) return 0;                 // ชนะอยู่: เก็บให้จบ ห้ามเสียแต้ม
  if (bestScore >= 60) return Math.min(o.margin, 6);      // นำเล็กน้อย: แทบไม่ยอม
  if (bestScore <= o.desperateAt) return o.margin * 3;    // แพ้อยู่: ต้องเสี่ยง
  return o.margin;                                        // สูสี: ยอมได้ตามค่าตั้ง
}

// ---------------------------------------------------------------- risk score
/**
 * ให้คะแนน "ความแหก" ของตาเดิน (0 = เรียบ ๆ, ยิ่งสูงยิ่งดุ/เสี่ยง)
 * ทำงานบนกระดานก่อนเดิน — จะ makeMove/undoMove ชั่วคราวเพื่อดูผล
 */
export function riskScore(board, m) {
  const bd = board.board;
  const us = board.turn;
  const them = us ^ 1;
  const detail = {
    sacrifice: 0, check: false, nearKing: 0, forward: 0, promote: false, repeats: false,
  };

  // (1) กินตัวแบบขาดทุน = เสียสละตรง ๆ
  if (m.captured !== EMPTY) {
    const s = see(bd, m);
    if (s < 0) detail.sacrifice = -s;
  }

  board.makeMove(m);
  try {
    // (2) เดินไปวางให้เขากินฟรี = ยื่นหมากให้ (การแหกที่แท้จริง)
    const offered = bestCaptureGainOn(board, m.to);
    if (offered > 0) detail.sacrifice = Math.max(detail.sacrifice, offered);

    if (board.inCheck(them)) detail.check = true;
    if (board.isRepetition(1)) detail.repeats = true;    // เดินวน = ไม่ใช่การบุก

    const kSq = board.kingSq[them];
    if (kSq >= 0) {
      const d = Math.max(Math.abs(fileOf(m.to) - fileOf(kSq)), Math.abs(rankOf(m.to) - rankOf(kSq)));
      if (d <= 3) detail.nearKing = 4 - d;
    }
    const relRank = us === 0 ? rankOf(m.to) : 7 - rankOf(m.to);
    if (relRank >= 4) detail.forward = relRank - 3;
    if (m.promotion) detail.promote = true;
  } finally {
    board.undoMove(m);
  }

  // "แหกหมาก" = การเสียสละเนื้อหมากเป็นหลัก
  // ท่าบุกอื่น ๆ เป็นแค่เครื่องปรุง ห้ามให้มันกลบแกนหลัก (cap 90)
  let risk = Math.min(520, detail.sacrifice);
  if (risk > 0) {
    let flavour = (detail.check ? 45 : 0) + detail.nearKing * 14 + detail.forward * 8
                + (detail.promote ? 30 : 0);
    risk += Math.min(90, flavour);
  }
  if (detail.repeats) risk = 0;                          // เดินวนไม่นับเป็นการแหก

  return { risk, detail };
}

/** ฝ่ายที่ถึงตาเดินตอนนี้ กินหมากบนช่อง sq ได้กำไรสุทธิสูงสุดเท่าไหร่ (0 ถ้าไม่คุ้ม) */
function bestCaptureGainOn(board, sq) {
  if (board.board[sq] === EMPTY) return 0;
  const pseudo = [];
  generateMoves(board, pseudo);
  let best = 0;
  for (const c of pseudo) {
    if (c.to !== sq || c.captured === EMPTY) continue;
    const g = see(board.board, c);
    if (g > best) best = g;
  }
  return best;
}

// -------------------------------------------------------------------- JameAI
export class JameAI {
  /**
   * @param {import('./engine.js').MakrukEngine} engine
   * @param {Partial<typeof JAME_DEFAULTS>} [opts]
   */
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.opts = { ...JAME_DEFAULTS, ...opts };
    // searcher แยกสำหรับ "พิสูจน์" — ห้ามใช้ตัวเดียวกับการค้นหาหลัก
    // (ไม่งั้น TT/history ของตัวหลักโดน age/ล้างทุกครั้งที่ verify -> อ่อนลงชัดเจน)
    this.verifier = new Search(opts.verifyHashMb || 16);
    this.verifier.skill = 20;
  }

  get searcher() { return this.engine.searcher; }
  get board() { return this.engine.board; }

  setOption(name, value) {
    const k = String(name).toLowerCase().replace(/[\s_-]/g, '');
    const map = {
      contempt: 'contempt', margin: 'margin', minedge: 'minEdge', minrisk: 'minRisk',
      maxcandidates: 'maxCandidates', riskweight: 'riskWeight',
      drawtolerance: 'drawTolerance', verifyfrac: 'verifyFrac', verifyextra: 'verifyExtra',
      convertat: 'convertAt', desperateat: 'desperateAt',
    };
    if (!map[k]) return false;
    this.opts[map[k]] = +value;
    return true;
  }

  /**
   * เลือกตาเดินแบบ JameAI
   * @param {{movetime?:number, depth?:number}} limits
   * @param {(info:object)=>void} [onInfo]
   */
  pickMove(limits = {}, onInfo) {
    const b = this.board;
    const o = this.opts;
    const roots = legalMoves(b);
    if (roots.length === 0) return { bestMove: null, move: null, score: 0, depth: 0, pv: [], jame: { mode: 'none' } };
    if (roots.length === 1) {
      return {
        bestMove: moveToUci(roots[0]), move: roots[0], score: 0, depth: 0,
        pv: [moveToUci(roots[0])], nodes: 0, jame: { mode: 'forced' },
      };
    }

    const t0 = jameNow();
    const byTime = !limits.depth && limits.movetime;
    const mainLimits = limits.depth
      ? { depth: limits.depth }
      : { movetime: Math.max(60, Math.round((limits.movetime || 1000) * (1 - o.verifyFrac))) };

    // ---------- 1) ค้นหาหลัก: ได้ตาดีสุด + ความลึกอ้างอิง ----------
    const savedContempt = this.searcher.contempt;
    this.searcher.contempt = o.contempt;            // เกลียดเสมอ
    const main = this.searcher.think(b, mainLimits, onInfo);
    this.searcher.contempt = savedContempt;

    if (!main.bestMove) return { ...main, jame: { mode: 'none' } };

    const verifyDepth = Math.max(2, (limits.depth ? limits.depth : main.depth) - 1 + (o.verifyExtra | 0));
    const budgetLeft = byTime ? Math.max(0, (limits.movetime || 0) - (jameNow() - t0)) : Infinity;

    // ---------- 2) คัดตาแหก ----------
    const scored = [];
    for (const m of roots) {
      const { risk, detail } = riskScore(b, m);
      if (risk >= o.minRisk) scored.push({ m, risk, detail, uci: moveToUci(m) });
    }
    scored.sort((a, z) => z.risk - a.risk);
    const bestUci = main.bestMove;
    const cands = scored.filter((c) => c.uci !== bestUci).slice(0, o.maxCandidates);

    if (cands.length === 0) {
      return this._finish(main, main.move, { mode: 'best', reason: 'ไม่มีตาแหกที่น่าลอง' }, t0);
    }

    // ---------- 3) พิสูจน์: ค้นหาซ้ำแบบเทียบเท่ากันทุกตา ----------
    const perMove = byTime ? Math.max(40, Math.floor(budgetLeft / (cands.length + 1))) : undefined;
    const sBest = this._verify(main.move, verifyDepth, perMove);
    const verified = [];
    for (const c of cands) {
      const s = this._verify(c.m, verifyDepth, perMove);
      if (s === null) continue;                       // ตรวจไม่ทัน -> ไม่เสี่ยง
      c.score = s;
      verified.push(c);
    }

    // ---------- 4) เงื่อนไขเหล็ก: ต้องไม่เสียเปรียบ ----------
    const need = sBest + requiredEdge(o, sBest, verifyDepth);
    // ยังไม่แพ้ชัด -> ห้ามแหกจนกลายเป็นเสียเปรียบ (minEdge) ; แพ้ชัดแล้วค่อยปล่อย
    const floor = sBest > o.desperateAt ? Math.max(o.minEdge, need) : need;
    const ok = verified.filter((c) => c.score >= floor);

    let chosen = main.move;
    let jame = { mode: 'best', reason: 'ตาแหกทุกทางคำนวณแล้วเสียเปรียบ', checked: verified.length };

    if (ok.length) {
      ok.sort((a, z) => (z.score + z.risk * o.riskWeight) - (a.score + a.risk * o.riskWeight));
      const pick = ok[0];
      chosen = pick.m;
      jame = {
        mode: 'sacrifice',
        risk: Math.round(pick.risk),
        sacrificed: Math.round(pick.detail.sacrifice),
        check: pick.detail.check,
        score: Math.round(pick.score),
        bestScore: Math.round(sBest),
        give: Math.round(sBest - pick.score),
        checked: verified.length,
      };
    }

    // ---------- 5) หนีเสมอ: ถ้าตาที่เลือกพาไปเสมอทันที ลองหาทางอื่น ----------
    const anti = this._avoidDraw(chosen, sBest, verifyDepth, perMove, roots);
    if (anti) { chosen = anti.move; jame = { ...anti.jame, checked: jame.checked }; }

    return this._finish(main, chosen, jame, t0);
  }

  /**
   * เลือกตาเดินจากผลวิเคราะห์หลายเส้นที่ "คำนวณมาแล้ว" (MultiPV ของ Fairy-Stockfish)
   * ใช้ตอน JameAI ขี่บนแกน NNUE — คะแนนแม่นอยู่แล้ว เหลือแค่ตัดสินใจเชิงบุคลิก
   * @param {{uci:string, score:number}[]} lines  score = centipawn มุมมองฝ่ายที่ต้องเดิน
   */
  pickFromLines(lines) {
    const o = this.opts;
    const b = this.board;
    const rows = [];
    for (const ln of lines || []) {
      if (!ln || !ln.uci) continue;
      const m = findMoveByUci(b, ln.uci);
      if (!m) continue;
      const { risk, detail } = riskScore(b, m);
      rows.push({ uci: ln.uci, move: m, score: ln.score | 0, risk, detail });
    }
    if (!rows.length) return null;
    rows.sort((a, z) => z.score - a.score);
    const best = rows[0];

    const vd = (lines.find((l) => l && l.depth) || {}).depth || 10;
    const need = best.score + requiredEdge(o, best.score, vd);
    const floor = best.score > o.desperateAt ? Math.max(o.minEdge, need) : need;
    const ok = rows.filter((r) => r !== best && r.risk >= o.minRisk && r.score >= floor);

    if (!ok.length) {
      return {
        uci: best.uci, move: best.move,
        jame: { mode: 'best', reason: 'ทางแหกคำนวณแล้วเสียเปรียบ', checked: rows.length, score: best.score },
      };
    }
    ok.sort((a, z) => (z.score + z.risk * o.riskWeight) - (a.score + a.risk * o.riskWeight));
    const p = ok[0];
    return {
      uci: p.uci, move: p.move,
      jame: {
        mode: 'sacrifice', risk: Math.round(p.risk), sacrificed: Math.round(p.detail.sacrifice),
        check: p.detail.check, score: p.score, bestScore: best.score,
        give: best.score - p.score, checked: rows.length,
      },
    };
  }

  _finish(main, move, jame, t0) {
    const uci = moveToUci(move);
    return {
      ...main,
      bestMove: uci,
      move,
      pv: uci === main.bestMove ? main.pv : [uci],
      time: Math.round(jameNow() - t0),
      jame,
    };
  }

  /**
   * ค้นหาซ้ำบนกระดานลูกแบบ full-window -> คะแนนมุมมองฝ่ายเรา
   * คืน null ถ้าตรวจไม่เสร็จในเวลาที่ให้ (ถือว่า "พิสูจน์ไม่ได้" -> ไม่เดิน)
   */
  _verify(m, depth, movetime) {
    const b = this.board;
    b.makeMove(m);
    try {
      const imm = immediateResult(b);
      if (imm !== null) return imm;                 // จบเกมทันที: รุกจน/เสมอ
      // รากของการค้นหานี้คือ "ฝ่ายตรงข้าม" -> กลับเครื่องหมาย contempt
      // เพื่อให้ "เกลียดเสมอ" ยังเป็นมุมมองของ JameAI เหมือนเดิม
      this.verifier.contempt = -this.opts.contempt;
      const r = this.verifier.think(b, movetime ? { depth, movetime } : { depth });
      if (!r.bestMove && r.depth === 0) return null;
      if (movetime && r.depth < Math.min(3, depth)) return null;   // ตื้นเกินกว่าจะเชื่อ
      return -r.score;
    } finally {
      b.undoMove(m);
    }
  }

  /** ถ้าตาที่เลือกทำให้เสมอทันที -> มองหาตาอื่นที่ยังไม่แย่เกิน drawTolerance */
  _avoidDraw(chosen, sBest, depth, movetime, roots) {
    const b = this.board;
    b.makeMove(chosen);
    const res = immediateResult(b);
    b.undoMove(chosen);
    if (res === null || res !== 0) return null;      // ไม่ได้เสมอทันที -> ไม่ต้องทำอะไร

    const o = this.opts;
    let best = null;
    for (const m of roots) {
      if (m === chosen) continue;
      const s = this._verify(m, Math.max(2, depth - 1), movetime);
      if (s === null || s <= 0) continue;            // ต้องยัง "ได้เปรียบ" จริง
      if (s < -o.drawTolerance) continue;
      if (!best || s > best.s) best = { m, s };
    }
    if (!best) return null;
    return {
      move: best.m,
      jame: { mode: 'antidraw', reason: 'เลี่ยงเสมอ', score: Math.round(best.s) },
    };
  }
}

/** หา move object จากสตริง uci บนกระดานที่ให้ */
export function findMoveByUci(board, uci) {
  for (const m of legalMoves(board)) if (moveToUci(m) === uci) return m;
  return null;
}

/** ผลทันทีหลังเดิน (มุมมองฝ่ายที่เพิ่งเดิน): +MATE = รุกจนเขา, 0 = เสมอ, null = เกมยังไม่จบ */
function immediateResult(b) {
  const lm = legalMoves(b);
  if (lm.length === 0) return b.inCheck() ? MATE_IN_MAX + 500 : 0;   // อับ = เสมอ
  if (b.isRepetition(2) || b.halfmove >= 100) return 0;
  if (countingResult(b) === 'draw') return 0;
  if (insufficientMaterial(b)) return 0;
  return null;
}

/** ข้อความไทยอธิบายว่า JameAI คิดอะไรอยู่ (สำหรับโชว์ในเว็บ) */
export function jameNote(jame) {
  if (!jame) return '';
  switch (jame.mode) {
    case 'sacrifice': {
      const what = jame.sacrificed >= 450 ? 'เรือ'
        : jame.sacrificed >= 300 ? 'ม้า'
        : jame.sacrificed >= 230 ? 'โคน'
        : jame.sacrificed >= 170 ? 'เม็ด'
        : jame.sacrificed >= 80 ? 'เบี้ย' : 'แต้ม';
      const verdict = jame.score > 30 ? 'ยังได้เปรียบ' : jame.score >= -30 ? 'ยังสูสี ไม่เสียเปรียบ' : 'ยังไม่แย่';
      return jame.sacrificed >= 80
        ? `แหกหมาก! ยอมทิ้ง${what} — คำนวณล่วงหน้าแล้ว${verdict} (${fmtCp(jame.score)})`
        : `บุกดุ ๆ${jame.check ? ' พร้อมรุก' : ''} — คำนวณล่วงหน้าแล้ว${verdict} (${fmtCp(jame.score)})`;
    }
    case 'antidraw': return `ไม่เอาเสมอ — หาทางเล่นต่อ (${fmtCp(jame.score)})`;
    case 'forced':   return 'มีตาเดียว';
    case 'best':     return jame.reason === 'ไม่มีตาแหกที่น่าลอง'
      ? 'ยังไม่มีช่องแหก — เดินตามหลักไปก่อน'
      : 'ทางแหกคำนวณแล้วเสียเปรียบ — ไม่เสี่ยง';
    default: return '';
  }
}

function fmtCp(cp) {
  if (cp === undefined || cp === null) return '—';
  if (Math.abs(cp) >= MATE_IN_MAX) return 'รุกจน';
  return (cp >= 0 ? '+' : '') + (cp / 100).toFixed(2);
}
