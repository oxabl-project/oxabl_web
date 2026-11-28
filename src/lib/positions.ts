/**
 * UTF-8 byte offset <-> Monaco 1-based UTF-16 position conversion.
 *
 * `oxabl_wasm` wire positions carry `{ byte, line, column }` where `column` is
 * a 1-based UTF-8 byte column. Monaco uses 1-based `{ lineNumber, column }`
 * measured in UTF-16 code units. Always convert from `byte`, never pass the
 * wire `column` directly to Monaco.
 *
 * Zero dependencies and type-stripping compatible so it can be tested directly
 * with `node --test`.
 */

export type LineIndex = {
  /** UTF-8 byte offset where each 0-based line starts. Length = lineCount. */
  lineStartBytes: Uint32Array
  /** UTF-16 character index where each 0-based line starts. Length = lineCount. */
  lineStartUtf16: Uint32Array
  /** Total UTF-8 byte length of the text. */
  totalBytes: number
}

export type MonacoPosition = {
  /** 1-based line number. */
  lineNumber: number
  /** 1-based UTF-16 column. */
  column: number
}

/**
 * Returns `[utf8Bytes, utf16Units]` for the code point starting at `text[i]`.
 */
function charStep(text: string, i: number): [number, number] {
  const c = text.charCodeAt(i)
  if (c < 0x80) return [1, 1]
  if (c < 0x800) return [2, 1]
  if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
    const next = text.charCodeAt(i + 1)
    if (next >= 0xdc00 && next <= 0xdfff) {
      return [4, 2]
    }
  }
  return [3, 1]
}

export function buildLineIndex(text: string): LineIndex {
  const startBytes: number[] = [0]
  const startUtf16: number[] = [0]
  let byteOffset = 0
  let i = 0

  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c === 0x0a) {
      byteOffset += 1
      i += 1
      startBytes.push(byteOffset)
      startUtf16.push(i)
      continue
    }
    const [b, u] = charStep(text, i)
    byteOffset += b
    i += u
  }

  return {
    lineStartBytes: Uint32Array.from(startBytes),
    lineStartUtf16: Uint32Array.from(startUtf16),
    totalBytes: byteOffset,
  }
}

function findLineForByte(
  lineStartBytes: Uint32Array,
  byteOffset: number
): number {
  let low = 0
  let high = lineStartBytes.length - 1
  while (low < high) {
    const mid = (low + high + 1) >>> 1
    if (lineStartBytes[mid] <= byteOffset) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}

export function byteOffsetToMonacoPosition(
  text: string,
  index: LineIndex,
  byteOffset: number
): MonacoPosition {
  const clamped =
    byteOffset <= 0
      ? 0
      : byteOffset >= index.totalBytes
        ? index.totalBytes
        : Math.trunc(byteOffset)

  const lineIdx = findLineForByte(index.lineStartBytes, clamped)
  let curByte = index.lineStartBytes[lineIdx]
  let i = index.lineStartUtf16[lineIdx]
  const lineStart = i
  const lineEndUtf16 =
    lineIdx + 1 < index.lineStartUtf16.length
      ? index.lineStartUtf16[lineIdx + 1]
      : text.length

  while (i < lineEndUtf16 && curByte < clamped) {
    const [b, u] = charStep(text, i)
    if (curByte + b > clamped) {
      break
    }
    curByte += b
    i += u
  }

  return {
    lineNumber: lineIdx + 1,
    column: i - lineStart + 1,
  }
}

export function monacoPositionToByteOffset(
  text: string,
  index: LineIndex,
  position: MonacoPosition
): number {
  const lineCount = index.lineStartBytes.length
  const lineIdx =
    position.lineNumber <= 1
      ? 0
      : position.lineNumber >= lineCount
        ? lineCount - 1
        : Math.trunc(position.lineNumber) - 1

  const lineStart = index.lineStartUtf16[lineIdx]
  let lineEnd =
    lineIdx + 1 < lineCount
      ? index.lineStartUtf16[lineIdx + 1] - 1
      : text.length
  // Exclude trailing '\r' in CRLF line endings so clamping at end-of-line lands
  // before the line terminator rather than past '\r'.
  if (
    lineIdx + 1 < lineCount &&
    lineEnd > lineStart &&
    text.charCodeAt(lineEnd - 1) === 0x0d
  ) {
    lineEnd -= 1
  }

  const requestedOffset =
    position.column <= 1 ? 0 : Math.trunc(position.column) - 1
  const targetUtf16 = Math.min(lineStart + requestedOffset, lineEnd)

  let byteOffset = index.lineStartBytes[lineIdx]
  let i = lineStart
  while (i < targetUtf16) {
    const [b, u] = charStep(text, i)
    if (i + u > targetUtf16) {
      break
    }
    byteOffset += b
    i += u
  }

  return byteOffset
}
