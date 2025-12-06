import type {
  CreateKeyEnvelopeRequest,
  CreateKeyEnvelopeResponse,
  GetKeyEnvelopeResponse,
  KeyEnvelopeDto,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  RegisterResponse,
  WayneErrorResponse,
  StorjConfigDto,
  CreateStorjBucketResponse,
  RefreshTokenRequest,
  RefreshTokenResponse,
  LogoutRequest,
  LogoutResponse,
} from './wayne_dto'

// Client HTTP pour communiquer avec le Control Plane "Wayne".
// Gère l'authentification et la gestion des enveloppes de clés (MKEK).

export interface WayneClientConfig {
  // URL de base du serveur Wayne, ex: https://wayne.example.com
  baseUrl: string
  // Token d'authentification (optionnel, requis pour les opérations authentifiées)
  accessToken?: string
}

export class WayneClient {
  private readonly baseUrl: string
  private accessToken: string | null = null
  private refreshToken: string | null = null
  private readonly storageKey = 'wayne_refresh_token'

  constructor(config: WayneClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '') // Enlève le slash final
    this.accessToken = config.accessToken || null
    // Charge le refresh token depuis localStorage si disponible
    this.refreshToken = this.loadRefreshToken()
  }

  // Définit le token d'authentification après une connexion réussie.
  setAccessToken(token: string) {
    this.accessToken = token
  }

  // Récupère le token d'authentification actuel.
  getAccessToken(): string | null {
    return this.accessToken
  }

  // Enlève le token d'authentification (déconnexion).
  clearAccessToken() {
    this.accessToken = null
  }

  // Définit le refresh token et le sauvegarde dans localStorage.
  setRefreshToken(token: string) {
    this.refreshToken = token
    localStorage.setItem(this.storageKey, token)
  }

  // Récupère le refresh token actuel.
  getRefreshToken(): string | null {
    return this.refreshToken
  }

  // Enlève le refresh token (déconnexion).
  clearRefreshToken() {
    this.refreshToken = null
    localStorage.removeItem(this.storageKey)
  }

  // Charge le refresh token depuis localStorage.
  private loadRefreshToken(): string | null {
    try {
      return localStorage.getItem(this.storageKey)
    } catch {
      return null
    }
  }

  // Construit les headers HTTP avec authentification si disponible.
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }
    return headers
  }

  // Gère les erreurs HTTP et retourne un message d'erreur lisible.
  private async handleError(response: Response): Promise<never> {
    let errorMessage = `Wayne error: HTTP ${response.status}`
    try {
      const errorData = (await response.json()) as WayneErrorResponse
      errorMessage = errorData.message || errorData.error || errorMessage
    } catch {
      // Si la réponse n'est pas du JSON, on utilise le message par défaut
    }
    throw new Error(errorMessage)
  }

  // Gère les erreurs réseau (DNS, SSL, timeout, etc.)
  private handleNetworkError(error: unknown, operation: string): never {
    if (error instanceof TypeError) {
      // Erreur réseau (DNS, SSL, connexion refusée, etc.)
      if (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('Load failed')) {
        throw new Error(
          `Impossible de se connecter au serveur Wayne (${this.baseUrl}). ` +
          `Vérifie que :\n` +
          `1. L'URL est correcte\n` +
          `2. Le serveur est accessible\n` +
          `3. Le DNS est propagé (peut prendre jusqu'à 48h)\n` +
          `4. Le certificat SSL est valide`
        )
      }
    }
    // Réutilise l'erreur originale si ce n'est pas une erreur réseau connue
    throw error
  }

  // Inscription d'un nouvel utilisateur.
  async register(request: RegisterRequest): Promise<RegisterResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      const registerResponse = (await response.json()) as RegisterResponse
      // Stocke automatiquement les tokens après une inscription réussie
      this.setAccessToken(registerResponse.access_token)
      // Ne stocke le refresh token que s'il est présent (remember_me=true)
      if (registerResponse.refresh_token) {
        this.setRefreshToken(registerResponse.refresh_token)
      } else {
        // Si pas de refresh token, on nettoie l'ancien s'il existe
        this.clearRefreshToken()
      }
      return registerResponse
    } catch (error) {
      this.handleNetworkError(error, 'register')
    }
  }

  // Connexion d'un utilisateur existant.
  async login(request: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      const loginResponse = (await response.json()) as LoginResponse
      // Stocke automatiquement les tokens après une connexion réussie
      this.setAccessToken(loginResponse.access_token)
      // Ne stocke le refresh token que s'il est présent (remember_me=true)
      if (loginResponse.refresh_token) {
        this.setRefreshToken(loginResponse.refresh_token)
      } else {
        // Si pas de refresh token, on nettoie l'ancien s'il existe
        this.clearRefreshToken()
      }
      return loginResponse
    } catch (error) {
      this.handleNetworkError(error, 'login')
    }
  }

  // Sauvegarde une enveloppe de clés (MKEK) sur Wayne.
  async saveKeyEnvelope(envelope: KeyEnvelopeDto): Promise<CreateKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const body: CreateKeyEnvelopeRequest = { envelope }

      const response = await fetch(`${this.baseUrl}/api/v1/key-envelopes`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      return (await response.json()) as CreateKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'saveKeyEnvelope')
    }
  }

  // Récupère une enveloppe de clés (MKEK) depuis Wayne.
  async getKeyEnvelope(envelopeId: string): Promise<GetKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/key-envelopes/${envelopeId}`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      return (await response.json()) as GetKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'getKeyEnvelope')
    }
  }

  // Récupère l'enveloppe de clés de l'utilisateur actuellement connecté.
  async getMyKeyEnvelope(): Promise<GetKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/key-envelopes/me`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      return (await response.json()) as GetKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'getMyKeyEnvelope')
    }
  }

  // Récupère la configuration Storj de l'utilisateur actuellement connecté.
  async getMyStorjConfig(): Promise<StorjConfigDto> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/storj-config/me`, {
        method: 'GET',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      return (await response.json()) as StorjConfigDto
    } catch (error) {
      this.handleNetworkError(error, 'getMyStorjConfig')
    }
  }

  // Crée un bucket Storj pour l'utilisateur actuellement connecté (généralement appelé automatiquement lors de l'inscription).
  async createStorjBucket(): Promise<CreateStorjBucketResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/v1/storj-config/create`, {
        method: 'POST',
        headers: this.getHeaders(),
      })

      if (!response.ok) {
        await this.handleError(response)
      }

      return (await response.json()) as CreateStorjBucketResponse
    } catch (error) {
      this.handleNetworkError(error, 'createStorjBucket')
    }
  }

  // Rafraîchit l'access token en utilisant le refresh token.
  async refreshAccessToken(): Promise<string> {
    if (!this.refreshToken) {
      throw new Error('Aucun refresh token disponible. Veuillez vous reconnecter.')
    }

    try {
      const request: RefreshTokenRequest = {
        refresh_token: this.refreshToken,
      }

      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      })

      if (!response.ok) {
        // Si le refresh token est invalide, on nettoie tout
        if (response.status === 401) {
          this.clearAccessToken()
          this.clearRefreshToken()
        }
        await this.handleError(response)
      }

      const refreshResponse = (await response.json()) as RefreshTokenResponse
      this.setAccessToken(refreshResponse.access_token)
      return refreshResponse.access_token
    } catch (error) {
      this.handleNetworkError(error, 'refreshAccessToken')
    }
  }

  // Déconnexion (révoque le refresh token).
  async logout(): Promise<void> {
    if (this.refreshToken) {
      try {
        const request: LogoutRequest = {
          refresh_token: this.refreshToken,
        }

        await fetch(`${this.baseUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        })
      } catch (error) {
        // On continue même si la requête échoue (déconnexion locale)
        console.warn('Erreur lors de la déconnexion côté serveur:', error)
      }
    }

    // Nettoie toujours les tokens locaux
    this.clearAccessToken()
    this.clearRefreshToken()
  }

  // Tente de restaurer la session en utilisant le refresh token.
  async restoreSession(): Promise<boolean> {
    if (!this.refreshToken) {
      return false
    }

    try {
      await this.refreshAccessToken()
      return true
    } catch (error) {
      // Refresh token invalide ou expiré
      this.clearAccessToken()
      this.clearRefreshToken()
      return false
    }
  }
}


