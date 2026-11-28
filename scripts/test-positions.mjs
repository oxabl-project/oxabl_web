import assert from "node:assert/strict"
import test from "node:test"
import {
  buildLineIndex,
  byteOffsetToMonacoPosition,
  monacoPositionToByteOffset,
} from "../src/lib/positions.ts"

test("ASCII single-line and multi-line round-trips", () => {
  const text = "DEFINE VARIABLE x AS INTEGER.\nMESSAGE x.\n"
  const index = buildLineIndex(text)

  assert.equal(index.totalBytes, Buffer.byteLength(text, "utf8"))
  assert.deepEqual(Array.from(index.lineStartBytes), [0, 30, 41])
  assert.deepEqual(Array.from(index.lineStartUtf16), [0, 30, 41])

  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 0), {
    lineNumber: 1,
    column: 1,
  })
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 16), {
    lineNumber: 1,
    column: 17,
  })
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 30), {
    lineNumber: 2,
    column: 1,
  })
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 41), {
    lineNumber: 3,
    column: 1,
  })

  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 1, column: 17 }),
    16
  )
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 2, column: 9 }),
    38
  )
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 3, column: 1 }),
    41
  )
})

test("2-byte, 3-byte, and 4-byte UTF-8 characters round-trip accurately", () => {
  // 'é' = 2 bytes / 1 UTF-16 unit
  // '—' = 3 bytes / 1 UTF-16 unit
  // '😀' = 4 bytes / 2 UTF-16 units (surrogate pair)
  const text = "/* café — 😀 */ x"
  const index = buildLineIndex(text)

  assert.equal(index.totalBytes, Buffer.byteLength(text, "utf8"))

  // Verify every character boundary against Buffer.byteLength.
  let i = 0
  while (i <= text.length) {
    const expectedByte = Buffer.byteLength(text.slice(0, i), "utf8")
    const pos = { lineNumber: 1, column: i + 1 }
    assert.deepEqual(byteOffsetToMonacoPosition(text, index, expectedByte), pos)
    assert.equal(monacoPositionToByteOffset(text, index, pos), expectedByte)

    if (i === text.length) break
    const cp = text.codePointAt(i)
    i += cp !== undefined && cp > 0xffff ? 2 : 1
  }

  // Specifically verify the 'x' after the 4-byte emoji:
  // "/* café — 😀 */ " is 16 UTF-16 code units, 21 UTF-8 bytes.
  const xUtf16 = text.indexOf("x")
  const xByte = Buffer.byteLength(text.slice(0, xUtf16), "utf8")
  assert.equal(xUtf16, 16)
  assert.equal(xByte, 21)
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, xByte), {
    lineNumber: 1,
    column: 17,
  })
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 1, column: 17 }),
    xByte
  )
})

test("CRLF line endings and multi-line UTF-8 offsets", () => {
  const text = "café\r\n—😀\r\nend"
  const index = buildLineIndex(text)

  assert.equal(index.totalBytes, Buffer.byteLength(text, "utf8"))
  // Line 1: "café\r\n" -> 5 + 2 = 7 bytes, 6 UTF-16 units
  // Line 2: "—😀\r\n" -> 3 + 4 + 2 = 9 bytes, 5 UTF-16 units (total 16 bytes, 11 UTF-16)
  assert.deepEqual(Array.from(index.lineStartBytes), [0, 7, 16])
  assert.deepEqual(Array.from(index.lineStartUtf16), [0, 6, 11])

  // Start of line 2 ('—')
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 7), {
    lineNumber: 2,
    column: 1,
  })
  // '😀' on line 2 (after 3-byte '—')
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 10), {
    lineNumber: 2,
    column: 2,
  })
  // End of line 2 content (before '\r\n', after 4-byte '😀' = +2 UTF-16 units)
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 14), {
    lineNumber: 2,
    column: 4,
  })
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 2, column: 4 }),
    14
  )
  // Clamping past end of line 2 stays before '\r\n'
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 2, column: 99 }),
    14
  )
  // Start of line 3 ('end')
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 16), {
    lineNumber: 3,
    column: 1,
  })
  // EOF
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 19), {
    lineNumber: 3,
    column: 4,
  })
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 3, column: 4 }),
    19
  )
})

test("empty document, empty lines, mid-character offsets, and clamping", () => {
  const emptyIndex = buildLineIndex("")
  assert.equal(emptyIndex.totalBytes, 0)
  assert.deepEqual(byteOffsetToMonacoPosition("", emptyIndex, 0), {
    lineNumber: 1,
    column: 1,
  })
  assert.equal(
    monacoPositionToByteOffset("", emptyIndex, { lineNumber: 5, column: 10 }),
    0
  )

  const text = "a\n\n😀b"
  const index = buildLineIndex(text)
  // Out-of-range negative and > EOF byte offsets clamp cleanly
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, -10), {
    lineNumber: 1,
    column: 1,
  })
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 999), {
    lineNumber: 3,
    column: 4,
  })
  // Mid-character byte offset inside '😀' (starts at byte 3, spans bytes 3..7)
  assert.deepEqual(byteOffsetToMonacoPosition(text, index, 5), {
    lineNumber: 3,
    column: 1,
  })
  // Out-of-range line/column clamp cleanly
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 0, column: 0 }),
    0
  )
  assert.equal(
    monacoPositionToByteOffset(text, index, { lineNumber: 99, column: 99 }),
    index.totalBytes
  )
})
