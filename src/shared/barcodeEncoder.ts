/**
 * Deterministic ISO/IEC 15417 Code 128B barcode encoder.
 * Encodes all printable ASCII characters (32..126), making it ideal for
 * alphanumeric SKUs (e.g., PAP-PON-001, MAT-PAP-A4) and numeric EAN/UPC codes.
 */

const CODE128_PATTERNS: readonly string[] = [
  '212222', // 0: space
  '222122', // 1: !
  '222221', // 2: "
  '121223', // 3: #
  '121322', // 4: $
  '131222', // 5: %
  '122213', // 6: &
  '122312', // 7: '
  '132212', // 8: (
  '221213', // 9: )
  '221312', // 10: *
  '231212', // 11: +
  '112232', // 12: ,
  '122132', // 13: -
  '122231', // 14: .
  '113222', // 15: /
  '123122', // 16: 0
  '123221', // 17: 1
  '223211', // 18: 2
  '221132', // 19: 3
  '221231', // 20: 4
  '213212', // 21: 5
  '223112', // 22: 6
  '312131', // 23: 7
  '311222', // 24: 8
  '321122', // 25: 9
  '321221', // 26: :
  '312212', // 27: ;
  '322112', // 28: <
  '322211', // 29: =
  '212123', // 30: >
  '212321', // 31: ?
  '232121', // 32: @
  '111323', // 33: A
  '131123', // 34: B
  '131321', // 35: C
  '112313', // 36: D
  '132113', // 37: E
  '132311', // 38: F
  '211313', // 39: G
  '231113', // 40: H
  '231311', // 41: I
  '112133', // 42: J
  '112331', // 43: K
  '132131', // 44: L
  '113123', // 45: M
  '113321', // 46: N
  '133121', // 47: O
  '313121', // 48: P
  '211331', // 49: Q
  '231131', // 50: R
  '213113', // 51: S
  '213311', // 52: T
  '213131', // 53: U
  '311123', // 54: V
  '311321', // 55: W
  '331121', // 56: X
  '312113', // 57: Y
  '312311', // 58: Z
  '332111', // 59: [
  '314111', // 60: \
  '221411', // 61: ]
  '431111', // 62: ^
  '111224', // 63: _
  '111422', // 64: `
  '121124', // 65: a
  '121421', // 66: b
  '141122', // 67: c
  '141221', // 68: d
  '112214', // 69: e
  '112412', // 70: f
  '122114', // 71: g
  '122411', // 72: h
  '142112', // 73: i
  '142211', // 74: j
  '241211', // 75: k
  '221114', // 76: l
  '413111', // 77: m
  '241112', // 78: n
  '134111', // 79: o
  '111242', // 80: p
  '121142', // 81: q
  '121241', // 82: r
  '114212', // 83: s
  '124112', // 84: t
  '124211', // 85: u
  '411212', // 86: v
  '421112', // 87: w
  '421211', // 88: x
  '212141', // 89: y
  '214121', // 90: z
  '412121', // 91: {
  '111143', // 92: |
  '111341', // 93: }
  '131141', // 94: ~
  '114113', // 95: DEL
  '114311', // 96: FNC3
  '411113', // 97: FNC2
  '411311', // 98: SHIFT
  '113141', // 99: CODE C
  '114131', // 100: CODE B
  '311141', // 101: CODE A
  '411131', // 102: FNC1
  '211412', // 103: START A
  '211214', // 104: START B
  '211232', // 105: START C
  '2331112', // 106: STOP
];

const START_CODE_B = 104;
const STOP_CODE = 106;
const QUIET_ZONE_MODULES = 10;

export interface EncodedBarcodeBar {
  x: number;
  width: number;
}

export interface EncodedCode128Result {
  encodedText: string;
  bars: EncodedBarcodeBar[];
  totalModules: number;
}

export function sanitizeCode128Input(raw: string): string {
  const cleaned = (raw || '')
    .trim()
    .replace(/[^\x20-\x7e]/g, '-');
  return cleaned || 'ITEM';
}

export function encodeCode128B(rawValue: string): EncodedCode128Result {
  const encodedText = sanitizeCode128Input(rawValue);
  const symbolCodes: number[] = [START_CODE_B];
  let checksum = START_CODE_B;

  for (let idx = 0; idx < encodedText.length; idx += 1) {
    const code = encodedText.charCodeAt(idx) - 32;
    const safeCode = code >= 0 && code <= 94 ? code : 13; // fallback '-'
    symbolCodes.push(safeCode);
    checksum += safeCode * (idx + 1);
  }

  symbolCodes.push(checksum % 103);
  symbolCodes.push(STOP_CODE);

  const bars: EncodedBarcodeBar[] = [];
  let cursor = QUIET_ZONE_MODULES;

  for (const sym of symbolCodes) {
    const pattern = CODE128_PATTERNS[sym] || CODE128_PATTERNS[13];
    for (let i = 0; i < pattern.length; i += 1) {
      const width = Number(pattern[i]);
      // Even indices in each symbol pattern are dark bars; odd indices are spaces
      if (i % 2 === 0) {
        bars.push({ x: cursor, width });
      }
      cursor += width;
    }
  }

  const totalModules = cursor + QUIET_ZONE_MODULES;
  return {
    encodedText,
    bars,
    totalModules,
  };
}
