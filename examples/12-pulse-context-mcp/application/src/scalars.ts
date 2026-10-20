// Scalar helpers share ordinary pure-helper validation with the computation.
export function utf8Width(first: number): number {
  return first < 128 ? 1 : first < 224 ? 2 : first < 240 ? 3 : 4
}
export function escapedWidth(first: number, width: number): number {
  return first === 34 || first === 92 ? 2 : first < 32
    ? (first === 8 || first === 9 || first === 10 || first === 12 || first === 13 ? 2 : 6)
    : width
}

// One copy is JSON content; the other is that JSON embedded in MCP text.
export function projectedWidth(first: number, width: number): number {
  return first === 34 || first === 92 ? 6 : first < 32
    ? (first === 8 || first === 9 || first === 10 || first === 12 || first === 13 ? 5 : 13)
    : width * 2
}
export function digits(value: number): number {
  return value < 10 ? 1 : value < 100 ? 2 : value < 1000 ? 3 : value < 10000 ? 4 : 5
}
