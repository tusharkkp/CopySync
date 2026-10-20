/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) Implementation.
 * Ensures deterministic serialization of JSON data for cryptographic signatures and AAD bindings.
 * Reference: https://www.rfc-editor.org/rfc/rfc8785
 */

export function canonicalize(data: unknown): string {
  if (data === null || data === undefined) {
    return 'null'
  }

  const type = typeof data

  if (type === 'number') {
    if (!Number.isFinite(data)) {
      throw new TypeError('Cannot canonicalize non-finite numbers (NaN, Infinity)')
    }
    // ECMAScript standard JSON number serialization matches RFC 8785 Section 3.2.2.3
    return JSON.stringify(data)
  }

  if (type === 'boolean' || type === 'string') {
    return JSON.stringify(data)
  }

  if (Array.isArray(data)) {
    const elements = data.map((item) => (item === undefined ? 'null' : canonicalize(item)))
    return `[${elements.join(',')}]`
  }

  if (type === 'object') {
    const obj = data as Record<string, unknown>
    // Sort keys strictly by UTF-16 code units per RFC 8785 Section 3.2.3
    const sortedKeys = Object.keys(obj).sort((a, b) => {
      if (a < b) return -1
      if (a > b) return 1
      return 0
    })

    const properties: string[] = []
    for (const key of sortedKeys) {
      const val = obj[key]
      if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
        properties.push(`${JSON.stringify(key)}:${canonicalize(val)}`)
      }
    }
    return `{${properties.join(',')}}`
  }

  throw new TypeError(`Cannot canonicalize unsupported type: ${type}`)
}

/**
 * Returns canonical UTF-8 bytes for cryptographic hashing and AAD.
 */
export function canonicalizeToBytes(data: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(data))
}
