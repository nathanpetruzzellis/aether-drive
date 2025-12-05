import { useState } from 'react'
import { WayneClient } from '../wayne_client'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { StatusMessage } from '../components/StatusMessage'
import { LoadingSpinner } from '../components/LoadingSpinner'
import './LoginPage.css'

interface LoginPageProps {
  wayneBaseUrl: string
  onWayneBaseUrlChange: (url: string) => void
  onLoginSuccess: (client: WayneClient, envelopeId: string | null) => void
}

export function LoginPage({
  wayneBaseUrl,
  onWayneBaseUrlChange,
  onLoginSuccess,
}: LoginPageProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null)

  const handleRegister = async () => {
    if (!email || !password || !wayneBaseUrl) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis.' })
      return
    }

    setIsRegistering(true)
    setIsLoading(true)
    setStatus(null)

    try {
      const client = new WayneClient({ baseUrl: wayneBaseUrl })
      const response = await client.register({
        email,
        password,
      })

      setStatus({
        type: 'success',
        message: `Compte créé avec succès (User ID: ${response.user_id}). Tu peux maintenant te connecter.`,
      })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de l'inscription: ${errorMsg}` })
    } finally {
      setIsRegistering(false)
      setIsLoading(false)
    }
  }

  const handleLogin = async () => {
    if (!email || !password || !wayneBaseUrl) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis.' })
      return
    }

    setIsRegistering(false)
    setIsLoading(true)
    setStatus(null)

    try {
      const client = new WayneClient({ baseUrl: wayneBaseUrl })
      const response = await client.login({
        email,
        password,
      })

      client.setAccessToken(response.access_token)

      // Vérifie si une enveloppe existe déjà
      let envelopeId: string | null = null
      try {
        const envelopeResponse = await client.getMyKeyEnvelope()
        envelopeId = envelopeResponse.envelope_id || null
        setStatus({
          type: 'info',
          message: `Connexion réussie. Enveloppe de clés trouvée.`,
        })
      } catch (envelopeError) {
        // Pas d'enveloppe existante, c'est normal pour un nouveau compte
        setStatus({
          type: 'info',
          message: `Connexion réussie (User ID: ${response.user_id}). Aucune enveloppe de clés trouvée - initialise un nouveau coffre.`,
        })
      }

      onLoginSuccess(client, envelopeId)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la connexion: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>Aether Drive</h1>
          <p className="login-subtitle">Connexion à Wayne (Control Plane)</p>
        </div>

        <Card>
          <Input
            label="URL du serveur Wayne"
            type="text"
            value={wayneBaseUrl}
            onChange={(e) => onWayneBaseUrlChange(e.target.value)}
            placeholder="https://eather.io"
            disabled={isLoading}
            helperText="URL du serveur Wayne pour la synchronisation du coffre"
          />

          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="ex: user@example.com"
            disabled={isLoading}
            required
          />

          <Input
            label="Mot de passe"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mot de passe pour Wayne"
            disabled={isLoading}
            required
          />

          {status && (
            <StatusMessage
              type={status.type}
              message={status.message}
              onDismiss={() => setStatus(null)}
            />
          )}

          <div className="login-actions">
            <Button
              variant="secondary"
              onClick={handleRegister}
              disabled={isLoading || !email || !password || !wayneBaseUrl}
              loading={isLoading && isRegistering}
              fullWidth
            >
              S'inscrire
            </Button>
            <Button
              variant="primary"
              onClick={handleLogin}
              disabled={isLoading || !email || !password || !wayneBaseUrl}
              loading={isLoading && !isRegistering}
              fullWidth
            >
              Se connecter
            </Button>
          </div>
        </Card>

        <p className="login-footer">
          Wayne est le serveur central qui gère l'authentification et stocke le MKEK (Master Key Encryption Key).
        </p>
      </div>
    </div>
  )
}

