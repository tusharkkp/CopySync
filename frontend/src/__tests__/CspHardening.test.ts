import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('SEC-07: Content Security Policy & Frontend Security Hardening', () => {
  it('enforces a strict restrictive Content Security Policy meta tag in index.html', () => {
    const indexPath = path.resolve(__dirname, '../../index.html')
    const html = fs.readFileSync(indexPath, 'utf-8')

    // 1. Verify CSP meta tag exists
    expect(html).toContain('http-equiv="Content-Security-Policy"')

    // Extract the content attribute
    const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)
    expect(match).not.toBeNull()
    const csp = match![1]

    // 2. Directive: default-src 'self'
    expect(csp).toMatch(/default-src\s+'self'/)

    // 3. Directive: connect-src 'self' wss: https: (allows WebSocket and HTTPS relay only)
    expect(csp).toMatch(/connect-src\s+'self'\s+wss:\s+https:/)

    // 4. Directive: script-src 'self' (strictly disallows 'unsafe-eval' and remote arbitrary scripts)
    expect(csp).toMatch(/script-src\s+'self'/)
    expect(csp).not.toContain("'unsafe-eval'")

    // 5. Directive: object-src 'none' (blocks flash/plugins)
    expect(csp).toMatch(/object-src\s+'none'/)

    // 6. Directive: base-uri 'self' (prevents base tag hijacking)
    expect(csp).toMatch(/base-uri\s+'self'/)

    // 7. Directive: form-action 'self'
    expect(csp).toMatch(/form-action\s+'self'/)
  })

  it('contains no external script tags from third-party CDNs', () => {
    const indexPath = path.resolve(__dirname, '../../index.html')
    const html = fs.readFileSync(indexPath, 'utf-8')

    // Find all <script> tags
    const scriptTags = html.match(/<script[^>]*src="([^"]+)"[^>]*>/g) || []
    for (const tag of scriptTags) {
      const srcMatch = tag.match(/src="([^"]+)"/)
      if (srcMatch) {
        const src = srcMatch[1]
        // All scripts must be local bundle paths starting with / or ./
        expect(src.startsWith('http://') || src.startsWith('https://') || src.startsWith('//')).toBe(false)
      }
    }
  })
})
