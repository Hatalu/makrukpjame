// ============================================================================
//  Engine MakrukThai  -  zobrist.js
//  กุญแจ Zobrist ขนาด 64 บิต (เก็บเป็นสองส่วน 32 บิต: lo / hi)
//  หมากรุกไทยไม่มี castling / en-passant จึงมีแค่ piece-square + side-to-move
// ============================================================================

function xorshift32(x) {
  x ^= x << 13; x >>>= 0;
  x ^= x >>> 17;
  x ^= x << 5;  x >>>= 0;
  return x >>> 0;
}

let _seed = 0x1a2b3c4d;
function rnd32() {
  _seed = xorshift32(_seed);
  return _seed | 0;
}

// pieceLo/pieceHi[pieceCode 0..14][sq 0..63]
export const Z_PIECE_LO = [];
export const Z_PIECE_HI = [];
for (let c = 0; c < 15; c++) {
  Z_PIECE_LO[c] = new Int32Array(64);
  Z_PIECE_HI[c] = new Int32Array(64);
  for (let s = 0; s < 64; s++) {
    Z_PIECE_LO[c][s] = rnd32();
    Z_PIECE_HI[c][s] = rnd32();
  }
}
export const Z_SIDE_LO = rnd32();
export const Z_SIDE_HI = rnd32();
