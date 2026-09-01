// Carrier operators per algorithm (editor op indices): a carrier reaches the
// output, a modulator only shapes another op. Editor op ↔ chip: op0=S1, op1=S3, op2=S2, op3=S4.
export const CARRIER_OPS: Record<number, number[]> = {
  0: [3],
  1: [3],
  2: [3],
  3: [3],
  4: [2, 3],
  5: [1, 2, 3],
  6: [1, 2, 3],
  7: [0, 1, 2, 3],
}

// editor op index → the chip S-digit drawn in the algorithm ASCII
export const OP_TO_DIGIT: Record<number, string> = {
  0: '1',
  1: '3',
  2: '2',
  3: '4',
}
