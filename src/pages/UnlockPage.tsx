import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { WayneClient } from '../wayne_client'
import type { KeyEnvelopeDto } from '../wayne_dto'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { StatusMessage } from '../components/StatusMessage'
import './UnlockPage.css'

type MkekBootstrapResponse = {
  password_salt: number[]
  mkek: {
    nonce: number[]
    payload: number[]
  }
}

interface UnlockPageProps {
  wayneClient: WayneClient | null
  useWayne: boolean
  onBootstrap: (data: MkekBootstrapResponse) => void
  onUnlock: () => void
  onGoToLogin?: () => void
  onDisableWayne?: () => void
  hasWayneEnvelopeId?: boolean
}

const STORAGE_KEY = 'aether_drive_bootstrap_data'

export function UnlockPage({ wayneClient, useWayne, onBootstrap, onUnlock, onGoToLogin, onDisableWayne, hasWayneEnvelopeId }: UnlockPageProps) {
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string; isKeyMismatch?: boolean } | null>(null)
  const [isBootstrapMode, setIsBootstrapMode] = useState(false)

  const handleBootstrap = async () => {
    if (!password) {
      setStatus({ type: 'error', message: 'Le mot de passe maître est requis.' })
      return
    }

    if (useWayne && (!wayneClient || !wayneClient.getAccessToken())) {
      setStatus({
        type: 'warning',
        message: 'Wayne est activé mais tu n\'es pas connecté. Connecte-toi d\'abord pour sauvegarder le MKEK sur Wayne.',
      })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      const result = await invoke<MkekBootstrapResponse>('crypto_bootstrap', { password })

      // Si Wayne est activé, sauvegarde le MKEK sur Wayne
      if (useWayne && wayneClient && wayneClient.getAccessToken()) {
        try {
          const envelope: KeyEnvelopeDto = {
            version: 1,
            password_salt: result.password_salt,
            mkek: {
              nonce: result.mkek.nonce,
              payload: result.mkek.payload,
            },
          }

          const saveResponse = await wayneClient.saveKeyEnvelope(envelope)
          localStorage.setItem('wayne_envelope_id', saveResponse.envelope_id)

          setStatus({
            type: 'success',
            message: `✅ Coffre initialisé et MKEK sauvegardé sur Wayne (ID: ${saveResponse.envelope_id}).`,
          })
        } catch (wayneError) {
          const wayneErrorMsg = wayneError instanceof Error ? wayneError.message : String(wayneError)
          setStatus({
            type: 'warning',
            message: `⚠️ Coffre initialisé localement mais échec de sauvegarde sur Wayne: ${wayneErrorMsg}. Les données sont sauvegardées localement.`,
          })
          localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
        }
      } else {
        // Mode local uniquement
        localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
        setStatus({
          type: 'success',
          message: "✅ Coffre initialisé localement (MKEK généré, rien n'a quitté Rust en clair).",
        })
      }

      onBootstrap(result)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du bootstrap cryptographique: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  const handleUnlock = async () => {
    if (!password) {
      setStatus({ type: 'error', message: 'Le mot de passe maître est requis.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      // Si Wayne est activé, récupère le MKEK depuis Wayne
      if (useWayne && wayneClient && wayneClient.getAccessToken()) {
        try {
          const wayneResponse = await wayneClient.getMyKeyEnvelope()
          const envelope = wayneResponse.envelope

          const mkekData: MkekBootstrapResponse = {
            password_salt: envelope.password_salt,
            mkek: {
              nonce: envelope.mkek.nonce,
              payload: envelope.mkek.payload,
            },
          }

          await invoke('crypto_unlock', {
            req: {
              password,
              password_salt: mkekData.password_salt,
              mkek: {
                nonce: mkekData.mkek.nonce,
                payload: mkekData.mkek.payload,
              },
            },
          })

          setStatus({
            type: 'success',
            message: '✅ Coffre déverrouillé avec succès (MKEK récupéré depuis Wayne).',
          })
        } catch (envelopeError) {
          const envelopeErrorMsg = envelopeError instanceof Error ? envelopeError.message : String(envelopeError)
          
          // Détecte le cas spécifique d'une clé qui ne correspond pas
          let errorType: 'error' | 'warning' = 'error'
          let errorMessage = envelopeErrorMsg
          
          // Détecte le cas spécifique d'une clé qui ne correspond pas
          const isKeyMismatch = envelopeErrorMsg.includes('clé de déchiffrement ne correspond pas') || 
                                envelopeErrorMsg.includes('file is not a database') ||
                                envelopeErrorMsg.includes('base de données locale ne correspond pas')
          
          if (isKeyMismatch) {
            errorType = 'warning'
            errorMessage = '⚠️ Conflit détecté : La base de données locale ne correspond pas au MKEK de Wayne. Cela arrive si tu as créé un nouveau coffre localement. Tu peux supprimer la base locale et réinitialiser avec Wayne.'
          }
          
          setStatus({
            type: errorType,
            message: `Erreur lors de la récupération du MKEK depuis Wayne: ${errorMessage}`,
            isKeyMismatch: isKeyMismatch, // Flag pour afficher le bouton
          })
          setIsLoading(false)
          return
        }
      } else {
        // Mode local : récupère depuis localStorage
        const stored = localStorage.getItem(STORAGE_KEY)
        if (!stored) {
          setStatus({
            type: 'error',
            message: 'Aucune donnée de bootstrap trouvée localement. Initialise d\'abord un coffre.',
          })
          setIsLoading(false)
          return
        }

        const mkekData = JSON.parse(stored) as MkekBootstrapResponse
        await invoke('crypto_unlock', {
          req: {
            password,
            password_salt: mkekData.password_salt,
            mkek: {
              nonce: mkekData.mkek.nonce,
              payload: mkekData.mkek.payload,
            },
          },
        })

        setStatus({
          type: 'success',
          message: '✅ Coffre déverrouillé avec succès (MKEK récupéré localement).',
        })
      }

      onUnlock()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du déverrouillage: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="unlock-page">
      <div className="unlock-container">
        <div className="unlock-header">
          <h1>Aether Drive</h1>
          <p className="unlock-subtitle">
            {isBootstrapMode ? 'Initialiser le coffre' : 'Déverrouiller le coffre'}
          </p>
        </div>

        <Card>
          <div className="unlock-mode-toggle">
            <button
              className={`toggle-btn ${!isBootstrapMode ? 'active' : ''}`}
              onClick={() => setIsBootstrapMode(false)}
              disabled={isLoading}
            >
              Déverrouiller
            </button>
            <button
              className={`toggle-btn ${isBootstrapMode ? 'active' : ''}`}
              onClick={() => setIsBootstrapMode(true)}
              disabled={isLoading}
            >
              Initialiser
            </button>
          </div>

          <Input
            label="Mot de passe maître"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choisis une passphrase robuste"
            disabled={isLoading}
            required
            helperText={
              isBootstrapMode
                ? 'Ce mot de passe sera utilisé pour chiffrer ta Master Key. Choisis une passphrase forte et unique.'
                : 'Entre le mot de passe maître pour déverrouiller le coffre.'
            }
          />

          {useWayne && wayneClient && wayneClient.getAccessToken() && (
            <StatusMessage
              type="info"
              message={`Mode Wayne activé. Le MKEK sera ${isBootstrapMode ? 'sauvegardé sur' : 'récupéré depuis'} Wayne.`}
            />
          )}

          {/* Affiche le message uniquement si Wayne est activé mais non connecté */}
          {useWayne && (!wayneClient || !wayneClient.getAccessToken()) && (
            <>
              <StatusMessage
                type="warning"
                message="Wayne est activé mais tu n'es pas connecté. Le coffre fonctionnera en mode local uniquement."
              />
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
                {onGoToLogin && (
                  <Button
                    variant="secondary"
                    onClick={onGoToLogin}
                    disabled={isLoading}
                  >
                    Se connecter à Wayne
                  </Button>
                )}
                {onDisableWayne && (
                  <Button
                    variant="secondary"
                    onClick={onDisableWayne}
                    disabled={isLoading}
                  >
                    Désactiver Wayne (mode local)
                  </Button>
                )}
              </div>
            </>
          )}
          
          {/* Affiche une info si un envelope_id existe mais Wayne n'est pas activé */}
          {!useWayne && hasWayneEnvelopeId && !wayneClient && (
            <StatusMessage
              type="info"
              message="Un coffre Wayne existe. Connecte-toi à Wayne pour le synchroniser, ou utilise le mode local."
            >
              {onGoToLogin && (
                <Button
                  variant="secondary"
                  onClick={onGoToLogin}
                  disabled={isLoading}
                  style={{ marginTop: '0.5rem' }}
                >
                  Se connecter à Wayne
                </Button>
              )}
            </StatusMessage>
          )}

          {status && (
            <StatusMessage
              type={status.type}
              message={status.message}
              onDismiss={() => setStatus(null)}
            >
              {status.type === 'warning' && status.isKeyMismatch && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await invoke('reset_local_database')
                      setStatus({
                        type: 'info',
                        message: '✅ Base de données locale supprimée. Tu peux maintenant réinitialiser le coffre avec Wayne.',
                      })
                      setIsBootstrapMode(true)
                    } catch (e) {
                      const errorMsg = e instanceof Error ? e.message : String(e)
                      setStatus({
                        type: 'error',
                        message: `Erreur lors de la suppression de la base: ${errorMsg}`,
                      })
                    }
                  }}
                  disabled={isLoading}
                  style={{ marginTop: '0.5rem' }}
                >
                  Supprimer la base locale et réinitialiser
                </Button>
              )}
            </StatusMessage>
          )}

          <div className="unlock-actions">
            {isBootstrapMode ? (
              <Button
                variant="primary"
                onClick={handleBootstrap}
                disabled={isLoading || !password || (useWayne && (!wayneClient || !wayneClient.getAccessToken()))}
                loading={isLoading}
                fullWidth
              >
                Initialiser le coffre
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={handleUnlock}
                disabled={isLoading || !password}
                loading={isLoading}
                fullWidth
              >
                Déverrouiller le coffre
              </Button>
            )}
          </div>
        </Card>

        <p className="unlock-footer">
          Le mot de passe maître ne quitte jamais ton appareil. Seul le MKEK chiffré est synchronisé avec Wayne.
        </p>
      </div>
    </div>
  )
}

