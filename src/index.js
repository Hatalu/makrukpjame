// ============================================================================
//  Engine MakrukThai  -  index.js  (จุดเข้าใช้งานหลัก)
// ============================================================================
export { MakrukEngine } from './engine.js';
export { Board } from './board.js';
export { Search } from './search.js';
export { OpeningBook } from './book.js';
export {
  generateMoves, legalMoves, moveIsLegal, moveGivesCheck, perft, perftDivide,
} from './movegen.js';
export { evaluate, insufficientMaterial } from './evaluate.js';
export {
  newCounting, updateCounting, countingResult, describeCounting,
} from './counting.js';
export {
  moveToUci, uciToMove, moveToSan, sanToMove,
} from './notation.js';
export * from './constants.js';
