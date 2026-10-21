import { describe, it, expect } from 'vitest'
import { generateRecoverySecret, validateRecoverySecret } from '../recoverySecret'
import { SYNC_CONFIG } from '../../config/syncConfig'

describe('CRYPTO: Recovery Secret Construction (DEC-015)', () => {
  it('throws by default when FEATURE_RECOVERY_ENABLED is false', async () => {
    expect(SYNC_CONFIG.FEATURE_RECOVERY_ENABLED).toBe(false)
    await expect(generateRecoverySecret()).rejects.toThrow(/disabled/)
  })

  it('generates 256-bit entropy formatted with checksum when allowPreview is true', async () => {
    const secret = await generateRecoverySecret(true)
    expect(secret.rawBytes.length).toBe(32)
    expect(secret.checksum).toHaveLength(8)
    expect(secret.notice).toContain('PREVIEW / UNAUDITED')

    // 16 blocks of 4 hex chars + 1 block of checksum (8 chars = 2 blocks if 4, or 1 block of 8)
    // In our implementation: 16 blocks of 4 hex chars + 1 checksum (8 chars) -> 17 blocks joined by '-'
    const valid = await validateRecoverySecret(secret.formatted)
    expect(valid).toBe(true)
  })

  it('rejects tampered recovery secret', async () => {
    const secret = await generateRecoverySecret(true)
    // Tamper with one character
    const tampered = secret.formatted.slice(0, -1) + (secret.formatted.endsWith('0') ? '1' : '0')
    const valid = await validateRecoverySecret(tampered)
    expect(valid).toBe(false)
  })

  it('rejects malformed recovery secret', async () => {
    expect(await validateRecoverySecret('invalid-secret')).toBe(false)
    expect(await validateRecoverySecret('')).toBe(false)
  })
})
