// ============================================================================
//  Engine MakrukThai  -  worker/engine.worker.js
//  ห่อเอนจิ้นไว้ใน Web Worker เพื่อให้หน้าเว็บไม่ค้างระหว่างคิด
//
//  ใช้งาน (ฝั่งหน้าเว็บ):
//    const w = new Worker('./worker/engine.worker.js', { type: 'module' });
//    w.postMessage({ type: 'newgame' });
//    w.postMessage({ type: 'position', fen: START_FEN, moves: ['f3f4'] });
//    w.onmessage = (e) => { ... e.data.type === 'info' | 'bestmove' | 'eval' | ... };
//    w.postMessage({ type: 'go', movetime: 1000 });
//
//  โปรโตคอลข้อความ (rที่รับ):
//    { type:'newgame' }
//    { type:'position', fen?, moves?:string[] }
//    { type:'setoption', name, value }
//    { type:'go', movetime?, depth?, nodes? }
//    { type:'stop' }               (หยุดการคิดรอบปัจจุบัน)
//    { type:'eval' }
//    { type:'perft', depth }
//    { type:'legal' }              (ขอรายการหมากเดินที่ถูกกติกา)
//    { type:'loadbook', book }     (plain JSON object)
//  ข้อความที่ส่งกลับ:
//    { type:'ready' }
//    { type:'info', depth, score, nodes, nps, pv, ... }
//    { type:'bestmove', move, ponder?, book?, score, depth, nodes }
//    { type:'eval', cp }
//    { type:'perft', depth, nodes, ms }
//    { type:'legal', moves, movesSan }
//    { type:'state', fen, turn, gameOver, counting, inCheck }
//    { type:'error', message }
// ============================================================================
import { MakrukEngine } from '../src/engine.js';
import { moveToSan, moveToUci } from '../src/notation.js';
import { START_FEN } from '../src/constants.js';

const engine = new MakrukEngine();
let busy = false;

// หมายเหตุ: JavaScript ใน worker เป็น single-thread การค้นหาแบบ synchronous
// จึงถูก "หยุดกลางคัน" ไม่ได้ ให้คุมเวลาคิดผ่าน movetime แทน (แนะนำ 300-1500 ms)
// ข้อความ {type:'stop'} จะมีผลก็ต่อเมื่อรอบคิดปัจจุบันจบแล้ว

function postState() {
  self.postMessage({
    type: 'state',
    fen: engine.fen(),
    turn: engine.turnName(),
    ply: engine.ply(),
    inCheck: engine.inCheck(),
    counting: engine.countingStatus(),
    gameOver: engine.isGameOver(),
  });
}

self.onmessage = (ev) => {
  const msg = ev.data || {};
  try {
    switch (msg.type) {
      case 'newgame':
        engine.newGame();
        postState();
        break;

      case 'position': {
        engine.setFen(msg.fen || START_FEN);
        if (Array.isArray(msg.moves)) {
          for (const mv of msg.moves) engine.move(mv);
        }
        postState();
        break;
      }

      case 'domove': {
        try {
          const r = engine.move(msg.uci);
          self.postMessage({ type: 'moved', uci: r.uci, san: r.san });
        } catch (e) {
          self.postMessage({ type: 'error', message: 'illegal move: ' + msg.uci });
        }
        postState();
        break;
      }

      case 'undo': {
        const n = Math.max(1, msg.count | 0 || 1);
        for (let i = 0; i < n; i++) engine.undo();
        postState();
        break;
      }

      case 'setoption':
        engine.setOption(msg.name, msg.value);
        break;

      case 'loadbook':
        engine.loadBook(msg.book || {});
        break;

      case 'legal':
        self.postMessage({
          type: 'legal',
          moves: engine.legalMoves(),
          movesSan: engine.legalMovesSan(),
        });
        break;

      case 'eval':
        self.postMessage({ type: 'eval', cp: engine.evaluate() });
        break;

      case 'perft': {
        const t0 = performance.now();
        const n = engine.perft(msg.depth | 0);
        self.postMessage({ type: 'perft', depth: msg.depth | 0, nodes: n, ms: Math.round(performance.now() - t0) });
        break;
      }

      case 'stop':
        // ไม่มีผลกับรอบที่กำลังคิดอยู่ (ดูหมายเหตุด้านบน)
        break;

      case 'analyze': {
        const serial = msg.serial || 0;
        setTimeout(() => {
          let moves = [], depth = 0;
          try {
            const sk = engine.searcher.skill;
            engine.searcher.skill = 19;
            const r = engine.think({ movetime: msg.movetime || 1500, useBook: false });
            engine.searcher.skill = sk;
            depth = r.depth || 0;
            const rs = engine.searcher.rootScoresDone || engine.searcher.rootScores || [];
            const seen = new Set();
            for (const e of rs) {
              const u = moveToUci(e.move);
              if (seen.has(u)) continue; seen.add(u);
              let san = u; try { san = moveToSan(engine.board, e.move); } catch (x) {}
              moves.push({ uci: u, san, score: e.score });
            }
            moves.sort((a, b) => b.score - a.score);
          } catch (e) {}
          self.postMessage({ type: 'analysis', serial, moves, depth });
        }, 0);
        break;
      }

      case 'go': {
        if (busy) { self.postMessage({ type: 'error', message: 'engine busy' }); break; }
        busy = true;
        const serial = msg.serial || 0;

        const limits = {
          movetime: msg.movetime,
          depth: msg.depth,
          nodes: msg.nodes,
          useBook: msg.useBook,
        };

        // ให้ event loop หายใจก่อน แล้วค่อยคิด
        setTimeout(() => {
          const onInfo = (info) => self.postMessage({ type: 'info', serial, ...info });
          let result = null;
          try {
            result = engine.think(limits, onInfo);
          } catch (e) {
            self.postMessage({ type: 'error', message: String(e && e.message || e) });
          }
          busy = false;
          if (result && result.bestMove) {
            self.postMessage({
              type: 'bestmove',
              serial,
              move: result.bestMove,
              san: safeSan(result.move),
              book: !!result.book,
              score: result.score,
              depth: result.depth,
              nodes: result.nodes,
              nps: result.nps,
              pv: result.pv,
            });
          } else {
            self.postMessage({ type: 'bestmove', serial, move: null });
          }
        }, 0);
        break;
      }

      default:
        self.postMessage({ type: 'error', message: 'unknown message: ' + msg.type });
    }
  } catch (e) {
    busy = false;
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};

function safeSan(move) {
  try {
    return move ? moveToSan(engine.board, move) : null;
  } catch { return null; }
}

self.postMessage({ type: 'ready' });
