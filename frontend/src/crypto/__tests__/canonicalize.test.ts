import { describe, it, expect } from 'vitest'
import { canonicalize } from '../canonicalize'

describe('CRYPTO-JCS: RFC 8785 JSON Canonicalization Scheme', () => {
  it('sorts keys lexicographically by UTF-16 code units', () => {
    const input = { z: 1, a: 2, m: 3, B: 4 }
    // B comes before a in ASCII/UTF-16 code units (66 vs 97)
    expect(canonicalize(input)).toBe('{"B":4,"a":2,"m":3,"z":1}')
  })

  it('removes all whitespace between keys and values', () => {
    const input = {
      sessionId: 'ses-123',
      messageId: 'msg-456',
      logicalClock: 10,
    }
    expect(canonicalize(input)).toBe(
      '{"logicalClock":10,"messageId":"msg-456","sessionId":"ses-123"}'
    )
  })

  it('handles nested objects recursively with sorted keys', () => {
    const input = {
      header: {
        b: 'second',
        a: 'first',
      },
      action: 'clipboard.update',
    }
    expect(canonicalize(input)).toBe(
      '{"action":"clipboard.update","header":{"a":"first","b":"second"}}'
    )
  })

  it('preserves array order while canonicalizing contents', () => {
    const input = {
      items: [
        { z: 1, a: 2 },
        { y: 3, b: 4 },
      ],
    }
    expect(canonicalize(input)).toBe('{"items":[{"a":2,"z":1},{"b":4,"y":3}]}')
  })

  it('correctly handles unicode characters and escaping', () => {
    const input = { text: 'Hello 世界 🔒 \n \t' }
    expect(canonicalize(input)).toBe('{"text":"Hello 世界 🔒 \\n \\t"}')
  })

  it('throws on non-finite numbers', () => {
    expect(() => canonicalize({ bad: NaN })).toThrow(TypeError)
    expect(() => canonicalize({ bad: Infinity })).toThrow(TypeError)
  })
})
