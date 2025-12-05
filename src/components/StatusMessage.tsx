import './StatusMessage.css'

type StatusType = 'success' | 'error' | 'warning' | 'info'

interface StatusMessageProps {
  type: StatusType
  message: string
  onDismiss?: () => void
  children?: React.ReactNode
}

export function StatusMessage({ type, message, onDismiss, children }: StatusMessageProps) {
  const icons = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
  }

  return (
    <div className={`status-message status-message-${type}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', width: '100%' }}>
        <span className="status-message-icon">{icons[type]}</span>
        <div style={{ flex: 1 }}>
          <span className="status-message-text">{message}</span>
          {children && <div style={{ marginTop: '0.5rem' }}>{children}</div>}
        </div>
        {onDismiss && (
          <button className="status-message-dismiss" onClick={onDismiss} aria-label="Fermer">
            ×
          </button>
        )}
      </div>
    </div>
  )
}

