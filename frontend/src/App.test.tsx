import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import App from './App'

describe('GATE-01: Frontend Editor Skeleton', () => {
  it('renders editor title, badge, and textarea', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: /ClipSync/i })).toBeInTheDocument()
    expect(screen.getByText(/E2EE Preview/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/ClipSync Clipboard Editor/i)).toBeInTheDocument()
  })

  it('updates byte count dynamically on typing', () => {
    render(<App />)
    const textarea = screen.getByLabelText(/ClipSync Clipboard Editor/i)

    // Type "Hello World" (11 bytes UTF-8)
    fireEvent.change(textarea, { target: { value: 'Hello World' } })
    expect(screen.getByText(/11 \/ 65,536 bytes/i)).toBeInTheDocument()
  })

  it('correctly calculates multi-byte UTF-8 character length', () => {
    render(<App />)
    const textarea = screen.getByLabelText(/ClipSync Clipboard Editor/i)

    // "🔒" is 4 UTF-8 bytes
    fireEvent.change(textarea, { target: { value: '🔒' } })
    expect(screen.getByText(/4 \/ 65,536 bytes/i)).toBeInTheDocument()
  })

  it('displays warning when exceeding 64 KiB limit', () => {
    render(<App />)
    const textarea = screen.getByLabelText(/ClipSync Clipboard Editor/i)

    // Generate 65,537 bytes string
    const oversized = 'a'.repeat(65537)
    fireEvent.change(textarea, { target: { value: oversized } })

    expect(screen.getByRole('alert')).toHaveTextContent(/exceeds 64 KiB maximum limit/i)
  })

  it('allows storage mode selection between ephemeral, temporary, and history', () => {
    render(<App />)
    const select = screen.getByLabelText(/Mode:/i) as HTMLSelectElement

    expect(select.value).toBe('ephemeral')
    fireEvent.change(select, { target: { value: 'temporary' } })
    expect(select.value).toBe('temporary')
  })
})
