import './Button.css'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success'
  loading?: boolean
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  loading = false,
  fullWidth = false,
  children,
  disabled,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${fullWidth ? 'btn-full-width' : ''} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="btn-spinner"></span>}
      {children}
    </button>
  )
}

