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

  constructor(config: WayneClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '') // Enlève le slash final
    this.accessToken = config.accessToken || null
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

      return (await response.json()) as RegisterResponse
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
      // Stocke automatiquement le token après une connexion réussie
      this.setAccessToken(loginResponse.access_token)
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
}


