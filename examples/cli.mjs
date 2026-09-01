// ============================================================================
//  Engine MakrukThai  -  examples/cli.mjs
//  เล่นหมากรุกไทยกับเอนจิ้นในเทอร์มินัล
//  รัน:  node "examples/cli.mjs"        (คุณเล่นฝ่ายขาว)
//        node "examples/cli.mjs" black  (คุณเล่นฝ่ายดำ)
//
//  คำสั่งระหว่างเล่น:
//    <หมากเดิน>   เช่น  f3f4  หรือ  Nf3  หรือ  e5f6=M
//    go           ให้เอนจิ้นเดินแทนตาปัจจุบัน
//    undo         ถอน 1 ตา (ถอนทั้งของเราและของเอนจิ้น)
//    hint         ขอคำแนะนำหมากเดิน
//    eval         แสดงคะแนนประเมิน
//    moves        แสดงหมากเดินที่ถูกกติกาทั้งหมด
//    fen [x]      แสดง/ตั้ง FEN
//    level <0-20> ตั้งระดับความเก่ง
//    time <ms>    ตั้งเวลาคิดต่อตา
//    new          เริ่มเกมใหม่
//    quit
// ============================================================================
import { createInterface } from 'node:readline';
import { MakrukEngine } from '../src/engine.js';

const humanSide = (process.argv[2] || 'white').toLowerCase().startsWith('b') ? 'black' : 'white';
const engine = new MakrukEngine({ skill: 20 });
let moveTime = 1000;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

function show() {
  console.log(engine.ascii());
  const c = engine.countingStatus();
  if (c.active) console.log('  * ' + c.text);
  if (engine.inCheck()) console.log('  * รุก!');
}

function reportOver() {
  const v = engine.isGameOver();
  if (!v.over) return false;
  const th = {
    checkmate: 'รุกจน', stalemate: 'อับ (เสมอ)', threefold: 'เสมอ (ตำแหน่งซ้ำ 3 ครั้ง)',
    'fifty-move': 'เสมอ (50 ตาไม่มีความคืบหน้า)', counting: 'เสมอ (ครบการนับ)',
    'insufficient-material': 'เสมอ (กำลังไม่พอ)',
  }[v.reason] || v.reason;
  console.log(`\n=== จบเกม: ${th}  ผล ${v.result} ${v.winner ? '(' + v.winner + ' ชนะ)' : ''} ===`);
  return true;
}

async function engineMove() {
  process.stdout.write(`เอนจิ้นกำลังคิด (${moveTime} ms)... `);
  let lastInfo;
  const g = engine.go({ movetime: moveTime }, (i) => { lastInfo = i; });
  if (!g) { console.log('(ไม่มีหมากเดิน)'); return; }
  const sc = g.book ? 'ตำรา' :
    (Math.abs(g.score) >= 29000 ? `#${Math.sign(g.score) * Math.ceil((30000 - Math.abs(g.score)) / 2)}` : (g.score / 100).toFixed(2));
  console.log(`เดิน ${g.san}  (${g.uci})   score=${sc}  depth=${g.depth}  nodes=${(g.nodes || 0).toLocaleString()}`);
}

async function main() {
  console.log('=== Engine MakrukThai - โหมดเทอร์มินัล ===');
  console.log(`คุณเล่นฝ่าย: ${humanSide === 'white' ? 'ขาว (ตัวพิมพ์ใหญ่)' : 'ดำ (ตัวพิมพ์เล็ก)'}`);
  show();

  if (humanSide === 'black') await engineMove(), show();

  for (;;) {
    if (reportOver()) break;
    const line = (await ask('\n> ')).trim();
    if (!line) continue;
    const [cmd, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');

    if (cmd === 'quit' || cmd === 'exit') break;
    else if (cmd === 'new') { engine.newGame(); show(); if (humanSide === 'black') { await engineMove(); show(); } }
    else if (cmd === 'go') { await engineMove(); show(); }
    else if (cmd === 'undo') {
      engine.undo(); engine.undo(); show();
    }
    else if (cmd === 'hint') {
      const r = engine.think({ movetime: Math.min(moveTime, 600) });
      console.log('  แนะนำ: ' + (r.bestMove || '-') + '  (pv: ' + (r.pv || []).join(' ') + ')');
    }
    else if (cmd === 'eval') {
      const cp = engine.evaluate();
      console.log(`  คะแนน (มุมมองขาว): ${(cp / 100).toFixed(2)}  [${cp} cp]`);
    }
    else if (cmd === 'moves') {
      console.log('  ' + engine.legalMovesSan().join(', '));
    }
    else if (cmd === 'fen') {
      if (arg) { try { engine.setFen(arg); show(); } catch (e) { console.log('  FEN ผิด: ' + e.message); } }
      else console.log('  ' + engine.fen());
    }
    else if (cmd === 'level') { engine.setOption('Skill Level', +arg); console.log('  ระดับ = ' + engine.options.skill); }
    else if (cmd === 'time') { moveTime = Math.max(50, +arg || 1000); console.log('  เวลาคิด = ' + moveTime + ' ms'); }
    else {
      try {
        const m = engine.move(line);
        console.log('  คุณเดิน ' + m.san);
        show();
        if (reportOver()) break;
        await engineMove();
        show();
      } catch (e) {
        console.log('  ' + e.message + '  (พิมพ์ "moves" เพื่อดูหมากเดินที่ถูกกติกา)');
      }
    }
  }
  rl.close();
}

main();
