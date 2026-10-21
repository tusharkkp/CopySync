import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import './ConfirmDialog.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'warning'
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  onConfirm,
  onCancel,
}) => {
  const safeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      // Focus safe button first per ChaiUI accessibility rules
      safeButtonRef.current?.focus()

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onCancel()
        }
      }
      window.addEventListener('keydown', handleKeyDown)
      return () => window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onCancel])

  if (!open) return null

  const content = (
    <div
      className="chai-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      role="presentation"
    >
      <div
        className="chai-dialog-card card-chai"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="chai-dialog-title"
        aria-describedby="chai-dialog-desc"
      >
        <button
          type="button"
          className="chai-dialog-close"
          onClick={onCancel}
          aria-label="Close dialog"
        >
          <X size={16} />
        </button>

        <div className="chai-dialog-header">
          <div className={`chai-dialog-icon-circle ${tone}`}>
            <AlertTriangle size={20} aria-hidden="true" />
          </div>
          <div className="chai-dialog-titles">
            <h3 id="chai-dialog-title">{title}</h3>
            <p id="chai-dialog-desc">{description}</p>
          </div>
        </div>

        <div className="chai-dialog-actions">
          <button
            type="button"
            ref={safeButtonRef}
            className="btn btn-secondary"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}

export default ConfirmDialog
