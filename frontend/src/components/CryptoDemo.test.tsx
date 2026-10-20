import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CryptoDemo from './CryptoDemo'

describe('GATE-02: CryptoDemo Two-Context Test Bench', () => {
  it('renders both Device A and Device B panels with initial state', async () => {
    render(<CryptoDemo />)
    expect(
      screen.getByRole('heading', { name: /Cryptographic Proof of Concept/i })
    ).toBeInTheDocument()
    expect(screen.getByText(/Device A \(Sender\)/i)).toBeInTheDocument()
    expect(screen.getByText(/Device B \(Receiver\)/i)).toBeInTheDocument()

    // Wait for keys and SAS to generate
    await waitFor(() => {
      expect(screen.getByText(/Short Authentication String/i)).toBeInTheDocument()
    })
  })

  it('encrypts on Device A and decrypts successfully on Device B', async () => {
    render(<CryptoDemo />)

    // Wait for keys to be generated and button to become enabled
    const encryptBtn = await screen.findByRole('button', {
      name: /Encrypt & Wrap for Device B/i,
    })
    await waitFor(() => {
      expect(encryptBtn).not.toBeDisabled()
    })

    // Click Encrypt
    fireEvent.click(encryptBtn)

    // Verify inbound decrypt button is enabled
    const decryptBtn = await screen.findByRole('button', {
      name: /Verify & Decrypt Inbound Envelope/i,
    })
    await waitFor(() => {
      expect(decryptBtn).not.toBeDisabled()
    })

    // Click Decrypt
    fireEvent.click(decryptBtn)

    // Verify authenticated result
    await waitFor(() => {
      const resultHeader = screen.getByText(
        /Authenticated & Decrypted Successfully:/i
      )
      expect(resultHeader).toBeInTheDocument()
      const box = resultHeader.closest('.result-box')
      expect(box).toHaveTextContent(
        'Top secret text from Device A to Device B 🔒'
      )
    })
  })

  it('rejects tampered ciphertext and suppresses plaintext', async () => {
    render(<CryptoDemo />)

    const encryptBtn = await screen.findByRole('button', {
      name: /Encrypt & Wrap for Device B/i,
    })
    await waitFor(() => {
      expect(encryptBtn).not.toBeDisabled()
    })
    fireEvent.click(encryptBtn)

    // Click Tamper Ciphertext
    const tamperBtn = await screen.findByRole('button', {
      name: /Corrupt Ciphertext/i,
    })
    fireEvent.click(tamperBtn)

    // Click Decrypt on Device B
    const decryptBtn = screen.getByRole('button', {
      name: /Verify & Decrypt Inbound Envelope/i,
    })
    fireEvent.click(decryptBtn)

    // Verify rejection
    await waitFor(() => {
      expect(
        screen.getByText(/Security Invariant Triggered:/i)
      ).toBeInTheDocument()
      expect(
        screen.getByText(/Plaintext suppressed \(zero content rendered\)\./i)
      ).toBeInTheDocument()
    })
  })
})
