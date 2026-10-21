/**
 * Client-Side Recovery Secret Construction (DEC-015)
 *
 * STATUS: PREVIEW / UNAUDITED (Feature Flag: FEATURE_RECOVERY_ENABLED = false)
 *
 * Generates 256-bit cryptographically secure entropy formatted as human-verifiable
 * hex chunks with a checksum, enabling offline recovery secret generation.
 * This capability is disabled by default per DEC-015 and marked preview.
 */

import { SYNC_CONFIG } from '../config/syncConfig'

export interface RecoverySecret {
  /** Formatted 256-bit secret string grouped into 4-character blocks */
  formatted: string
  /** Raw 32-byte entropy as Uint8Array */
  rawBytes: Uint8Array
  /** Checksum hex (first 4 bytes of SHA-256 over raw entropy) */
  checksum: string
  /** Status notice */
  notice: string
}

/**
 * Generates a 256-bit client-side recovery secret.
 * Throws if FEATURE_RECOVERY_ENABLED is false unless explicitly bypassed for testing.
 */
export async function generateRecoverySecret(allowPreview = false): Promise<RecoverySecret> {
  if (!SYNC_CONFIG.FEATURE_RECOVERY_ENABLED && !allowPreview) {
    throw new Error(
      'Recovery secret generation is currently disabled (DEC-015: FEATURE_RECOVERY_ENABLED = false)'
    )
  }

  const rawBytes = new Uint8Array(32)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(rawBytes)
  } else {
    throw new Error('WebCrypto getRandomValues unavailable')
  }

  // Calculate 4-byte checksum via SHA-256
  const digestBuffer = await crypto.subtle.digest('SHA-256', rawBytes)
  const checksumBytes = new Uint8Array(digestBuffer).slice(0, 4)
  const checksum = Array.from(checksumBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Convert raw entropy to hex
  const hex = Array.from(rawBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  // Group into blocks of 4 chars
  const chunks: string[] = []
  for (let i = 0; i < hex.length; i += 4) {
    chunks.push(hex.slice(i, i + 4))
  }
  const formatted = chunks.join('-') + '-' + checksum.toUpperCase()

  return {
    formatted,
    rawBytes,
    checksum: checksum.toUpperCase(),
    notice: 'PREVIEW / UNAUDITED: Do not use for high-value production storage.',
  }
}

/**
 * Validates a formatted recovery secret against its embedded checksum.
 */
export async function validateRecoverySecret(formattedSecret: string): Promise<boolean> {
  const parts = formattedSecret.trim().toUpperCase().split('-')
  if (parts.length !== 17) {
    // 16 blocks of 4 hex chars + 1 checksum block of 4 hex chars = 17 blocks
    return false
  }

  const checksumPart = parts[16]
  const hexPart = parts.slice(0, 16).join('').toLowerCase()

  if (hexPart.length !== 64 || !/^[0-9a-f]{64}$/.test(hexPart)) {
    return false
  }

  const bytes = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(hexPart.slice(i * 2, i * 2 + 2), 16)
  }

  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes)
  const expectedChecksum = Array.from(new Uint8Array(digestBuffer).slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

  return checksumPart === expectedChecksum
}
