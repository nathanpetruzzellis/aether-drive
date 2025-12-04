import {
  CreateKeyEnvelopeRequest,
  CreateKeyEnvelopeResponse,
  KeyEnvelopeDto,
} from './wayne_dto'

// Client HTTP minimal pour parler à Wayne.
// Remarque : l'URL exacte (domaine, chemin) sera définie au moment
// où le backend Wayne existera ; ici on utilise simplement un endpoint
// passé par configuration pour éviter d'« inventer » la route.

export interface WayneClientConfig {
  // Endpoint complet vers la ressource d'enveloppes de clés, par ex.:
  // https://wayne.example.com/api/v1/key-envelopes
  keyEnvelopeEndpoint: string
}

export class WayneClient {
  constructor(private readonly config: WayneClientConfig) {}

  async saveKeyEnvelope(envelope: KeyEnvelopeDto): Promise<CreateKeyEnvelopeResponse> {
    const body: CreateKeyEnvelopeRequest = { envelope }

    const response = await fetch(this.config.keyEnvelopeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`Wayne error: HTTP ${response.status}`)
    }

    const data = (await response.json()) as CreateKeyEnvelopeResponse
    return data
  }
}


