/**
 * Utilitaire pour retry automatique avec backoff exponentiel
 */

export interface RetryOptions {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  retryableErrors?: (error: unknown) => boolean
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'retryableErrors'>> & { retryableErrors?: (error: unknown) => boolean } = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
}

/**
 * Détermine si une erreur est récupérable (peut être retentée)
 */
function isRetryableError(error: unknown): boolean {
  // Erreurs réseau (TypeError avec fetch)
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase()
    return (
      msg.includes('fetch') ||
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||
      msg.includes('network') ||
      msg.includes('timeout')
    )
  }

  // Erreurs HTTP 5xx (erreurs serveur)
  if (error instanceof Error && 'status' in error) {
    const status = (error as any).status
    return status >= 500 && status < 600
  }

  // Erreurs HTTP avec code dans le message
  if (error instanceof Error) {
    const msg = error.message
    if (msg.includes('HTTP 5')) {
      return true
    }
  }

  return false
}

/**
 * Attend un délai avec backoff exponentiel
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calcule le délai pour un retry donné avec backoff exponentiel
 */
function calculateDelay(attempt: number, options: Required<Omit<RetryOptions, 'retryableErrors'>>): number {
  const delay = options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt - 1)
  return Math.min(delay, options.maxDelayMs)
}

/**
 * Exécute une fonction avec retry automatique en cas d'erreur récupérable
 * 
 * @param fn Fonction à exécuter (peut être async)
 * @param options Options de retry
 * @returns Résultat de la fonction
 * @throws La dernière erreur si tous les retries échouent
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
    retryableErrors: options.retryableErrors || isRetryableError,
  }

  let lastError: unknown

  for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Si ce n'est pas une erreur récupérable, on arrête immédiatement
      if (!opts.retryableErrors(error)) {
        throw error
      }

      // Si c'est le dernier essai, on arrête
      if (attempt > opts.maxRetries) {
        break
      }

      // Calcule le délai avec backoff exponentiel
      const delayMs = calculateDelay(attempt, opts as Required<Omit<RetryOptions, 'retryableErrors'>>)
      
      // Attend avant de réessayer
      await delay(delayMs)
    }
  }

  // Tous les retries ont échoué
  throw lastError
}

/**
 * Crée un timeout pour une promesse
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage = `Operation timed out after ${timeoutMs}ms`
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
    ),
  ])
}

/**
 * Combine retry et timeout
 */
export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryOptions: RetryOptions = {}
): Promise<T> {
  return withRetry(
    () => withTimeout(fn(), timeoutMs),
    retryOptions
  )
}

