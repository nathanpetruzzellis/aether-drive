import './Input.css'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

export function Input({ label, error, helperText, className = '', ...props }: InputProps) {
  return (
    <div className="input-group">
      {label && (
        <label className="input-label">
          {label}
          {props.required && <span className="input-required"> *</span>}
        </label>
      )}
      <input
        className={`input ${error ? 'input-error' : ''} ${className}`}
        {...props}
      />
      {error && <span className="input-error-text">{error}</span>}
      {helperText && !error && <span className="input-helper-text">{helperText}</span>}
    </div>
  )
}

