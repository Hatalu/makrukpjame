# Engine MakrukThai

เอนจิ้น AI **หมากรุกไทย (Makruk)** เขียนด้วย JavaScript ล้วน (ES module) รันในเบราว์เซอร์ได้ทันที
ไม่ต้อง build ไม่ต้องมี WASM — เหมาะกับเว็บไซต์ฝึกซ้อมหมากรุกไทยโดยตรง

สถาปัตยกรรมเดินตามแนว **Stockfish** (alpha-beta + transposition table + quiescence +
iterative deepening) แต่ปรับกติกา/การประเมินเป็นของหมากรุกไทยทั้งหมด และใส่ **ระดับความเก่ง
(Skill 0–20)** สำหรับผู้เริ่มต้นถึงผู้เล่นแข่ง

---

## GodratSF+ กับเอนจิ้นตัวนี้ต่างกันอย่างไร

| | GodratSF+ (ของเพื่อนคุณ) | Engine MakrukThai (ตัวนี้) |
|---|---|---|
| ฐาน | Fairy-Stockfish / Makruk-Stockfish (C++) คอมไพล์เป็น `.exe` | เขียนใหม่ทั้งหมดด้วย JavaScript |
| รันที่ไหน | โปรแกรม WinBoard / Playok บนวินโดวส์ (ผ่าน UCI2WB) | เบราว์เซอร์ / Node.js — ฝังในเว็บได้เลย |
| การประเมิน | NNUE (โครงข่ายประสาท) | ฟังก์ชันคลาสสิก: กำลังหมาก + PST + mobility + ความปลอดภัยขุน + โครงเบี้ย |
| รูปแบบเปิดหมาก | ล็อกมากับ `.exe` แต่ละไฟล์ (R, Fast, M, L, C, S, …) | `data/formations.js` + ตำราเปิด (opening book) โหลดจากไฟล์ PGN ได้ |
| กฎการนับ | "64 move rule" | นับกระดาน / นับศักดิ์หมาก (ดูหัวข้อกติกา) |
| ความแรง | สูงมาก (เอนจิ้นระดับแข่ง) | ระดับสโมสร–แข่ง ปรับได้ด้วย Skill / เวลาคิด |

> ต้องการพลัง Fairy-Stockfish เต็ม ๆ บนเว็บ ให้ใช้ `fairy-stockfish.wasm` (ประมาณ 1.5–3 MB)
> แต่ถ้าต้องการเอนจิ้นเบา ๆ ควบคุมง่าย ปรับระดับได้ ฝังในหน้าเว็บฝึกซ้อม — ตัวนี้ตอบโจทย์กว่า

---

## เริ่มใช้เร็ว ๆ

### 1) ใน Node.js

```bash
cd "Engine MakrukThai"
npm test          # perft + ตรวจกติกา
npm run play      # เล่นในเทอร์มินัล
```

### 2) ในโค้ด (ทั้ง Node และเบราว์เซอร์)

```js
import { MakrukEngine } from './Engine MakrukThai/src/engine.js';

const eng = new MakrukEngine({ skill: 12 });   // 0 = อ่อนสุด, 20 = เต็มกำลัง

eng.move('f3f4');                               // ฝ่ายขาวเดิน (long algebraic หรือ SAN ก็ได้)
const r = eng.think({ movetime: 800 });         // ให้เอนจิ้นคิด
console.log(r.bestMove, r.score, r.depth, r.pv);
eng.move(r.bestMove);                            // เดินตามที่เอนจิ้นแนะนำ

console.log(eng.ascii());
console.log(eng.isGameOver());                   // { over, result, reason, winner }
console.log(eng.countingStatus());               // สถานะการนับ
```

### 3) ในหน้าเว็บ (แนะนำ: ใช้ Web Worker ไม่ให้ UI ค้าง)

```js
const w = new Worker('./Engine MakrukThai/worker/engine.worker.js', { type: 'module' });
w.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'ready')     w.postMessage({ type: 'newgame' });
  if (m.type === 'info')      console.log('depth', m.depth, 'score', m.score, m.pv);
  if (m.type === 'bestmove')  console.log('บอทเดิน', m.move, m.san);
  if (m.type === 'state')     render(m.fen, m.turn, m.counting, m.gameOver);
};
// ผู้เล่นเดิน
w.postMessage({ type: 'domove', uci: 'f3f4' });
// ให้บอทเดิน
w.postMessage({ type: 'go', movetime: 1000 });
```

### 4) เว็บสนามซ้อม (`web/`)

`web/index.html` = หน้าเว็บสนามซ้อมสมบูรณ์ (กระดาน + เอนจิ้น JS ฝังในไฟล์ + Blob Worker
+ fallback main thread) เปิดไฟล์เดียวได้เลย

```bash
npm run build     # สร้าง web/ ใหม่จาก src/ + tools/standalone.template.html + vendor/
npm run serve     # เสิร์ฟ web/ พร้อม header COOP/COEP (จำเป็นสำหรับ Fairy-Stockfish)
```

โครง `web/` หลัง build:

```
web/
├── index.html                 หน้าเว็บ (เอนจิ้น JS ฝังในตัว)
├── coi-serviceworker.min.js    เปิด cross-origin isolation บนโฮสต์สแตติก
└── fairy/                      Fairy-Stockfish WASM (สมองเต็มพลัง)
    ├── stockfish.js  stockfish.wasm  stockfish.worker.js
```

เอาโฟลเดอร์ `web/` ทั้งหมดไปวางบน GitHub Pages / Netlify / Cloudflare Pages ได้เลย

### 5) สองสมอง: เอนจิ้น JS  ↔  Fairy-Stockfish

หน้าเว็บมีปุ่มสลับ "สมองของบอท":

| | เอนจิ้นเบา (JS) | Fairy-Stockfish + NNUE |
|---|---|---|
| แรง | ระดับสโมสร (depth ~8–10) | **เต็มพลัง (depth ~16+, NNUE)** — คอร์เดียวกับ GodratSF+ |
| ขนาด | ฝังในไฟล์ (~70 KB) | `fairy/` ~1.7 MB + โครงข่าย NNUE ~48 MB (โหลดครั้งเดียว จำในเบราว์เซอร์) |
| ต้องการ | ไม่มี — ทำงานทุกที่ | **cross-origin isolation** (SharedArrayBuffer) |

> **โครงข่าย NNUE** `web/fairy/makruk.nnue` (`makruk-a8c621e24a8c.nnue`, 47.7 MB) ทำให้ประเมินตำแหน่ง
> ระดับ GodratSF+ ถ้าไม่มีไฟล์นี้ Fairy-Stockfish จะถอยไปใช้ classical eval (อ่อนกว่ามาก)
> ดาวน์โหลดใหม่ด้วย `npm run fetch-nnue` (จาก Fairy-Stockfish-NNUE-Catalogue, ianfab)

**Fairy-Stockfish จะใช้ได้ก็ต่อเมื่อหน้าเว็บ cross-origin isolated:**
- **โฮสต์ที่ตั้ง header เองได้** (Cloudflare Pages `_headers`, Netlify `_headers`, เซิร์ฟเวอร์ตัวเอง):
  ตั้ง `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (หรือ `credentialless`)
- **GitHub Pages** (ตั้ง header ไม่ได้): ไฟล์ `coi-serviceworker.min.js` จะจัดการให้อัตโนมัติ (โหลดหน้าใหม่ 1 ครั้ง)
- **ในตัวอย่าง Claude Artifact**: ไม่ isolated → ปุ่ม Fairy-Stockfish จะแจ้งว่าใช้ไม่ได้ ใช้เอนจิ้น JS แทน

> Fairy-Stockfish = Fairy-Stockfish.wasm 1.1.12 (Fabian Fichter, GPL-3.0) รองรับ variant `makruk` ในตัว
> JS engine ยังเป็น "ผู้ตัดสินกระดาน" เสมอ (กติกา/FEN/นับ/จบเกม) — Fairy-SF แค่เลือกหมาก

---

## กติกาหมากรุกไทยที่เอนจิ้นบังคับใช้

| หมาก | สัญลักษณ์ FEN | การเดิน |
|---|---|---|
| ขุน (Khun) | `k` | รอบตัว 1 ช่อง · ไม่มีการ castling |
| เม็ด (Met) | `m` | เฉียง 1 ช่อง (ferz) |
| โคน (Khon) | `s` | เฉียง 4 ทิศ **+ ตรงหน้า 1 ช่อง** (เหมือน "เงิน" โชกิ) |
| ม้า (Ma) | `n` | แบบหมากรุกสากล (กระโดดได้) |
| เรือ (Rua) | `r` | แนวตรงระยะไกล |
| เบี้ย (Bia) | `p` | เดินตรง 1 (ห้ามเดินทีแรก 2) · กินเฉียงหน้า · **ไม่มี en-passant** |

- **เลื่อนขั้น:** เบี้ยที่ไปถึง rank ที่ 6 (นับจากฝั่งตัวเอง) จะกลายเป็น **เม็ด** เท่านั้น
  (ขาว = rank 6, ดำ = rank 3) — SAN เขียน `e6=M`
- **ตำแหน่งเริ่มเกม:** `rnsmksnr/8/pppppppp/8/8/PPPPPPPP/8/RNSKMSNR w - - 0 1`
  (ขุนขาว d1 / เม็ดขาว e1 — ขุนดำ e8 / เม็ดดำ d8 — ชุดตัวอักษรเดียวกับ Fairy-Stockfish)
- **อับ (stalemate) = เสมอ**

### กฎการนับ (ฉบับประยุกต์)

- **นับกระดาน** — เริ่มเมื่อไม่มีเบี้ยเหลือบนกระดาน เป้าหมาย 64 ครึ่งตา
- **นับศักดิ์หมาก** — เริ่มเมื่อฝ่ายหนึ่งเหลือขุนเปล่า เป้าหมายตามกำลังฝ่ายรุก:

  | กำลังฝ่ายรุก | เป้า | | กำลังฝ่ายรุก | เป้า |
  |---|---|---|---|---|
  | เรือ 2 | 8 | | ม้า 2 | 32 |
  | เรือ 1 | 16 | | โคน 1 | 44 |
  | โคน 2 | 22 | | ม้า 1 / อื่น ๆ | 64 |

  ค่านับเริ่มจากจำนวนหมากบนกระดาน แล้วบวกทีละ 1 ทุกครึ่งตา · กินตัวหรือเดินเบี้ย = รีเซ็ต

> เป็นการประยุกต์ให้ใกล้เคียงพฤติกรรม WinBoard/Fairy-Stockfish ("64 move rule")
> ไม่ใช่การบังคับใช้กฎนับฉบับสมบูรณ์ทุกรายละเอียด

---

## โครงสร้างโปรเจกต์

```
Engine MakrukThai/
├── src/
│   ├── constants.js   ค่าคงที่ ชนิดหมาก geometry
│   ├── tables.js      ตารางการเดิน/จู่โจม (precompute) + squareAttackedBy
│   ├── zobrist.js     กุญแจ Zobrist 64 บิต
│   ├── board.js       Board: make/undo, FEN, zobrist, ตัวนับ incremental
│   ├── movegen.js     สร้างหมากเดิน (pseudo/legal) + perft
│   ├── counting.js    กฎการนับ (เสมอ)
│   ├── evaluate.js    ฟังก์ชันประเมิน + PST + insufficient material
│   ├── search.js      alpha-beta, TT, quiescence, LMR, null-move, Skill
│   ├── notation.js    UCI-like ⇄ SAN
│   ├── book.js        OpeningBook (map zobrist → หมากเดิน)
│   ├── engine.js      MakrukEngine  ← หน้ากากหลักที่ใช้งาน
│   └── index.js       re-exports
├── worker/engine.worker.js   ห่อเอนจิ้นใน Web Worker
├── data/
│   ├── formations.js         แคตตาล็อก "รูปแบบเปิดหมาก" แบบ GodratSF+
│   └── book.godratsf.json    ตำราเปิดที่ import จาก PGN ของคุณ (สร้างเอง)
├── tools/
│   ├── import-pgn.mjs         ดูด .pgn → ตำราเปิด JSON
│   └── serve.mjs             เว็บเซิร์ฟเวอร์สแตติกจิ๋ว
├── examples/
│   ├── play.html            เดโมเล่นกับบอท (กระดาน + worker)
│   └── cli.mjs              เล่นในเทอร์มินัล
└── test/
    ├── perft.mjs            perft + make/undo + zobrist (เทียบ generator อิสระแล้ว)
    └── rules.mjs            ตรวจกติกาเฉพาะหมากรุกไทย + การค้นหา + การนับ
```

---

## API หลัก — `MakrukEngine`

```js
new MakrukEngine({ skill = 20, hash = 16, fen?, book?, contempt? })

eng.newGame()                     // เริ่มเกมใหม่
eng.setFen(fen)                   // ตั้งตำแหน่ง (รับ FEN 4 หรือ 6 ช่อง)
eng.fen() / eng.ascii()           // อ่านตำแหน่ง
eng.turn() / eng.turnName()       // ฝ่ายที่ต้องเดิน

eng.move('f3f4' | 'Nf3' | {from,to})   // เดิน 1 ตา → { uci, san, ... } (throw ถ้าผิดกติกา)
eng.undo()                        // ถอนตาล่าสุด
eng.legalMoves() / eng.legalMovesSan()
eng.legalMovesFrom('f3')

eng.think({ movetime?, depth?, nodes?, useBook? }, onInfo?)
     // → { bestMove, move, score, depth, pv, nodes, nps, book? }
eng.go(limits, onInfo)            // think() แล้ว move() ให้เลย

eng.isGameOver()                  // { over, result:'1-0'|'0-1'|'1/2-1/2', reason, winner? }
eng.inCheck()
eng.countingStatus()             // { active, kind, count, limit, text }
eng.evaluate()                   // centipawn (บวก = ขาวได้เปรียบ)
eng.perft(depth)

eng.setOption(name, value)       // 'Skill Level' 0–20 | 'Hash' MB | 'Contempt' | 'MoveTime' | 'UseBook'
eng.loadBook(json)               // โหลดตำราเปิดจาก object JSON
```

**คะแนน (score):** centipawn จากมุมมองฝ่ายที่ต้องเดิน · ค่ารุกจนคือ `±(30000 - ply)`
(เช่น `29996` = รุกจนในอีก ~2 ตา)

**Skill Level:** ต่ำ = จำกัดความลึก + สุ่มเลือกหมากที่ใกล้เคียงหมากดีที่สุด (เหมาะไล่ระดับผู้ฝึก)
`0` ≈ ผู้เริ่มต้น · `10` ≈ ผู้เล่นทั่วไป · `20` = เต็มกำลัง (จำกัดด้วยเวลา/ความลึกที่สั่ง)

---

## ตำราเปิดหมาก (Opening Book) + รูปแบบ GodratSF+

`data/formations.js` เก็บแคตตาล็อกรูปแบบเปิดหมากทั้ง 18 แบบของ GodratSF+
(R, Fast, RR-white/black, P-white/black, M, L, C, S, H, K, T, N, O, MC, NM, NO)
พร้อมชื่อไทย/อังกฤษและคำอธิบาย ใช้ทำปุ่มเลือก "สไตล์บอท" ในเว็บได้

สร้างตำราเปิดจริงจากไฟล์ PGN (เช่นเกมที่ GodratSF+ เคยเล่น):

```bash
node tools/import-pgn.mjs "../หมากรุกไทย" --out data/book.godratsf.json --maxply 20
```

แล้วโหลดเข้าเอนจิ้น:

```js
import book from './data/book.godratsf.json' with { type: 'json' };
const eng = new MakrukEngine({ book, skill: 16 });
```

หรือส่งให้ worker: `w.postMessage({ type: 'loadbook', book })`

---

## โปรโตคอล Web Worker

**ส่งเข้า:** `newgame` · `position {fen?, moves?}` · `domove {uci}` · `undo {count?}` ·
`go {movetime?, depth?, nodes?, serial?}` · `setoption {name, value}` · `loadbook {book}` ·
`eval` · `legal` · `perft {depth}` · `stop`

**ส่งกลับ:** `ready` · `state {fen, turn, ply, inCheck, counting, gameOver}` ·
`moved {uci, san}` · `info {depth, score, nodes, nps, pv, ...}` ·
`bestmove {move, san, score, depth, nodes, book}` · `eval {cp}` · `legal {moves, movesSan}` ·
`perft {depth, nodes, ms}` · `error {message}`

> หมายเหตุ: การค้นหาเป็น synchronous หยุดกลางคันไม่ได้ — คุมเวลาคิดด้วย `movetime`
> (แนะนำ 300–1500 ms) `stop` มีผลเฉพาะรอบถัดไป

---

## ประสิทธิภาพ

- perft: ~1.3 ล้าน nodes/วินาที (Node 24)
- search: ~200–250k nodes/วินาที — ลึก ~depth 8–10 ในเวลา 1 วินาที (ตำแหน่งกลางเกม)
- ยืนยันความถูกต้องของ move generation ด้วย generator อิสระคนละชุด ตรงกันทุกค่าถึง depth 4
  (start: 23 / 529 / 12012 / 273026 / 6223994)

---

## ข้อจำกัด / สิ่งที่ยังทำต่อได้

- การประเมินเป็นแบบคลาสสิก ยังไม่จูนพารามิเตอร์ละเอียด (แข็งแรงพอสำหรับเว็บฝึกซ้อม)
- กฎการนับเป็นฉบับประยุกต์ ไม่ครบทุกเงื่อนไขปลีกย่อยของกติกาสมาคม
- ยังไม่มี multi-threading (Web Worker เดียว) / ยังไม่มี pondering
- ตำราเปิดต้อง import จาก PGN เอง (ใส่มาให้เป็นโครง + ตัวช่วย)

## License

MIT
