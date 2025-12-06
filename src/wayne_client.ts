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
  ChangePasswordRequest,
  ChangePasswordResponse,
  SaveFileMetadataRequest,
  SaveFileMetadataResponse,
  GetFileMetadataResponse,
  UserStatsResponse,
} from './wayne_dto'
import { withRetry, withTimeout } from './utils/retry'

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
  private readonly requestTimeoutMs: number = 30000 // 30 secondes par défaut
  private readonly maxRetries: number = 3

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

  // Gère les erreurs HTTP et retourne un message d'erreur lisible avec suggestions.
  private async handleError(response: Response, operation: string): Promise<never> {
    let errorMessage = `Erreur ${operation}: HTTP ${response.status}`
    let suggestions: string[] = []

    try {
      const errorData = (await response.json()) as WayneErrorResponse
      errorMessage = errorData.message || errorData.error || errorMessage
    } catch {
      // Si la réponse n'est pas du JSON, on utilise le message par défaut
    }

    // Ajoute des suggestions selon le code d'erreur
    if (response.status === 401) {
      suggestions.push('Vérifie que tu es bien connecté')
      suggestions.push('Réessaie de te connecter')
    } else if (response.status === 403) {
      suggestions.push('Tu n\'as pas les permissions nécessaires')
      suggestions.push('Contacte l\'administrateur si le problème persiste')
    } else if (response.status === 404) {
      suggestions.push('La ressource demandée n\'existe pas')
      suggestions.push('Vérifie que l\'URL est correcte')
    } else if (response.status >= 500) {
      suggestions.push('Le serveur rencontre un problème temporaire')
      suggestions.push('Réessaie dans quelques instants')
      suggestions.push('Si le problème persiste, contacte le support')
    }

    const fullMessage = suggestions.length > 0
      ? `${errorMessage}\n\n💡 Suggestions :\n${suggestions.map(s => `• ${s}`).join('\n')}`
      : errorMessage

    const error = new Error(fullMessage) as Error & { status?: number }
    error.status = response.status
    throw error
  }

  // Gère les erreurs réseau (DNS, SSL, timeout, etc.) avec suggestions.
  private handleNetworkError(error: unknown, operation: string): never {
    if (error instanceof TypeError) {
      // Erreur réseau (DNS, SSL, connexion refusée, etc.)
      if (error.message.includes('fetch') || error.message.includes('Failed to fetch') || error.message.includes('Load failed')) {
        throw new Error(
          `Impossible de se connecter au serveur Wayne (${this.baseUrl}).\n\n` +
          `💡 Vérifie que :\n` +
          `• L'URL est correcte (${this.baseUrl})\n` +
          `• Le serveur est accessible et en ligne\n` +
          `• Le DNS est propagé (peut prendre jusqu'à 48h)\n` +
          `• Le certificat SSL est valide\n` +
          `• Tu es connecté à Internet\n\n` +
          `Si le problème persiste, réessaie dans quelques instants.`
        )
      }
    }

    // Erreur de timeout
    if (error instanceof Error && error.message.includes('timed out')) {
      throw new Error(
        `L'opération "${operation}" a pris trop de temps.\n\n` +
        `💡 Suggestions :\n` +
        `• Vérifie ta connexion Internet\n` +
        `• Le serveur peut être surchargé, réessaie plus tard\n` +
        `• Si le problème persiste, contacte le support`
      )
    }

    // Réutilise l'erreur originale si ce n'est pas une erreur réseau connue
    throw error
  }

  // Exécute une requête fetch avec retry et timeout
  private async fetchWithRetry(
    url: string,
    options: RequestInit,
    operation: string
  ): Promise<Response> {
    return withRetry(
      async () => {
        const response = await withTimeout(
          fetch(url, options),
          this.requestTimeoutMs,
          `Timeout lors de l'opération "${operation}"`
        )
        return response
      },
      {
        maxRetries: this.maxRetries,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      }
    )
  }

  // Inscription d'un nouvel utilisateur.
  async register(request: RegisterRequest): Promise<RegisterResponse> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/auth/register`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request),
        },
        'inscription'
      )

      if (!response.ok) {
        await this.handleError(response, 'inscription')
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
      this.handleNetworkError(error, 'inscription')
    }
  }

  // Connexion d'un utilisateur existant.
  async login(request: LoginRequest): Promise<LoginResponse> {
    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request),
        },
        'connexion'
      )

      if (!response.ok) {
        await this.handleError(response, 'connexion')
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
      this.handleNetworkError(error, 'connexion')
    }
  }

  // Sauvegarde une enveloppe de clés (MKEK) sur Wayne.
  async saveKeyEnvelope(envelope: KeyEnvelopeDto): Promise<CreateKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const body: CreateKeyEnvelopeRequest = { envelope }

      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/key-envelopes`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
        },
        'sauvegarde de l\'enveloppe de clés'
      )

      if (!response.ok) {
        await this.handleError(response, 'sauvegarde de l\'enveloppe de clés')
      }

      return (await response.json()) as CreateKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'sauvegarde de l\'enveloppe de clés')
    }
  }

  // Récupère une enveloppe de clés (MKEK) depuis Wayne.
  async getKeyEnvelope(envelopeId: string): Promise<GetKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/key-envelopes/${envelopeId}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        'récupération de l\'enveloppe de clés'
      )

      if (!response.ok) {
        await this.handleError(response, 'récupération de l\'enveloppe de clés')
      }

      return (await response.json()) as GetKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'récupération de l\'enveloppe de clés')
    }
  }

  // Récupère l'enveloppe de clés de l'utilisateur actuellement connecté.
  async getMyKeyEnvelope(): Promise<GetKeyEnvelopeResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/key-envelopes/me`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        'récupération de l\'enveloppe de clés'
      )

      if (!response.ok) {
        await this.handleError(response, 'récupération de l\'enveloppe de clés')
      }

      return (await response.json()) as GetKeyEnvelopeResponse
    } catch (error) {
      this.handleNetworkError(error, 'récupération de l\'enveloppe de clés')
    }
  }

  // Récupère la configuration Storj de l'utilisateur actuellement connecté.
  async getMyStorjConfig(): Promise<StorjConfigDto> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/storj-config/me`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        'récupération de la configuration Storj'
      )

      if (!response.ok) {
        await this.handleError(response, 'récupération de la configuration Storj')
      }

      return (await response.json()) as StorjConfigDto
    } catch (error) {
      this.handleNetworkError(error, 'récupération de la configuration Storj')
    }
  }

  // Crée un bucket Storj pour l'utilisateur actuellement connecté (généralement appelé automatiquement lors de l'inscription).
  async createStorjBucket(): Promise<CreateStorjBucketResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/storj-config/create`,
        {
          method: 'POST',
          headers: this.getHeaders(),
        },
        'création du bucket Storj'
      )

      if (!response.ok) {
        await this.handleError(response, 'création du bucket Storj')
      }

      return (await response.json()) as CreateStorjBucketResponse
    } catch (error) {
      this.handleNetworkError(error, 'création du bucket Storj')
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

      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/auth/refresh`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
        },
        'rafraîchissement du token'
      )

      if (!response.ok) {
        // Si le refresh token est invalide, on nettoie tout
        if (response.status === 401) {
          this.clearAccessToken()
          this.clearRefreshToken()
        }
        await this.handleError(response, 'rafraîchissement du token')
      }

      const refreshResponse = (await response.json()) as RefreshTokenResponse
      this.setAccessToken(refreshResponse.access_token)
      return refreshResponse.access_token
    } catch (error) {
      this.handleNetworkError(error, 'rafraîchissement du token')
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

  // Change le mot de passe Wayne et met à jour le MKEK.
  async changePassword(request: ChangePasswordRequest): Promise<ChangePasswordResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/auth/change-password`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request),
        },
        'changement de mot de passe'
      )

      if (!response.ok) {
        await this.handleError(response, 'changement de mot de passe')
      }

      const changePasswordResponse = (await response.json()) as ChangePasswordResponse
      
      // Nettoie les tokens locaux uniquement si c'est un changement de mot de passe Wayne
      // (les refresh tokens sont révoqués côté serveur)
      if (request.password_type === 'wayne') {
        this.clearAccessToken()
        this.clearRefreshToken()
      }
      // Pour 'master', on ne déconnecte pas car le mot de passe Wayne n'a pas changé
      
      return changePasswordResponse
    } catch (error) {
      this.handleNetworkError(error, 'changement de mot de passe')
    }
  }

  // Sauvegarde les métadonnées anonymisées d'un fichier.
  async saveFileMetadata(request: SaveFileMetadataRequest): Promise<SaveFileMetadataResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/file-metadata`,
        {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request),
        },
        'sauvegarde des métadonnées'
      )

      if (!response.ok) {
        await this.handleError(response, 'sauvegarde des métadonnées')
      }

      return (await response.json()) as SaveFileMetadataResponse
    } catch (error) {
      this.handleNetworkError(error, 'sauvegarde des métadonnées')
    }
  }

  // Récupère toutes les métadonnées de l'utilisateur.
  async getFileMetadata(): Promise<GetFileMetadataResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/file-metadata`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        'récupération des métadonnées'
      )

      if (!response.ok) {
        await this.handleError(response, 'récupération des métadonnées')
      }

      return (await response.json()) as GetFileMetadataResponse
    } catch (error) {
      this.handleNetworkError(error, 'récupération des métadonnées')
    }
  }

  // Récupère les statistiques de l'utilisateur.
  async getUserStats(): Promise<UserStatsResponse> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/file-metadata/stats`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        },
        'récupération des statistiques'
      )

      if (!response.ok) {
        await this.handleError(response, 'récupération des statistiques')
      }

      return (await response.json()) as UserStatsResponse
    } catch (error) {
      this.handleNetworkError(error, 'récupération des statistiques')
    }
  }

  // Supprime les métadonnées d'un fichier.
  async deleteFileMetadata(fileUuid: string): Promise<void> {
    if (!this.accessToken) {
      throw new Error('Authentication required. Please login first.')
    }

    try {
      const response = await this.fetchWithRetry(
        `${this.baseUrl}/api/v1/file-metadata/${fileUuid}`,
        {
          method: 'DELETE',
          headers: this.getHeaders(),
        },
        'suppression des métadonnées'
      )

      if (!response.ok) {
        await this.handleError(response, 'suppression des métadonnées')
      }
    } catch (error) {
      this.handleNetworkError(error, 'suppression des métadonnées')
    }
  }
}


