import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { WayneClient } from '../wayne_client'
import { Card } from './Card'
import { Button } from './Button'
import { Input } from './Input'
import { StatusMessage } from './StatusMessage'
import './SettingsModal.css'

interface SettingsModalProps {
  wayneClient: WayneClient | null
  onClose: () => void
  onPasswordChanged: () => void
}

type ChangePasswordResponse = {
  new_password_salt: number[]
  new_mkek: {
    nonce: number[]
    payload: number[]
  }
}

export function SettingsModal({ wayneClient, onClose, onPasswordChanged }: SettingsModalProps) {
  const [passwordType, setPasswordType] = useState<'wayne' | 'master'>('wayne')
  
  // États pour changement mot de passe Wayne
  const [oldWaynePassword, setOldWaynePassword] = useState('')
  const [newWaynePassword, setNewWaynePassword] = useState('')
  const [confirmWaynePassword, setConfirmWaynePassword] = useState('')
  
  // États pour changement mot de passe maître
  const [oldMasterPassword, setOldMasterPassword] = useState('')
  const [newMasterPassword, setNewMasterPassword] = useState('')
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('')
  
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null)

  const handleChangeWaynePassword = async () => {
    // Validation
    if (!oldWaynePassword || !newWaynePassword || !confirmWaynePassword) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis.' })
      return
    }

    if (newWaynePassword.length < 8) {
      setStatus({ type: 'error', message: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' })
      return
    }

    if (newWaynePassword !== confirmWaynePassword) {
      setStatus({ type: 'error', message: 'Le nouveau mot de passe et la confirmation ne correspondent pas.' })
      return
    }

    if (!wayneClient || !wayneClient.getAccessToken()) {
      setStatus({ type: 'error', message: 'Tu dois être connecté à Wayne pour changer le mot de passe Wayne.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      // Change uniquement le mot de passe Wayne (ne touche pas au MKEK)
      await wayneClient.changePassword({
        old_password: oldWaynePassword,
        new_password: newWaynePassword,
        password_type: 'wayne',
      })

      setStatus({
        type: 'success',
        message: '✅ Mot de passe Wayne changé avec succès ! Tu seras déconnecté pour te reconnecter avec le nouveau mot de passe.',
      })

      // Attendre un peu avant de fermer et déconnecter
      setTimeout(() => {
        onPasswordChanged()
      }, 2000)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du changement de mot de passe Wayne: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  const handleChangeMasterPassword = async () => {
    // Validation
    if (!oldMasterPassword || !newMasterPassword || !confirmMasterPassword) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis.' })
      return
    }

    if (newMasterPassword.length < 8) {
      setStatus({ type: 'error', message: 'Le nouveau mot de passe maître doit contenir au moins 8 caractères.' })
      return
    }

    if (newMasterPassword !== confirmMasterPassword) {
      setStatus({ type: 'error', message: 'Le nouveau mot de passe maître et la confirmation ne correspondent pas.' })
      return
    }

    if (!wayneClient || !wayneClient.getAccessToken()) {
      setStatus({ type: 'error', message: 'Tu dois être connecté à Wayne pour changer le mot de passe maître.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      // Récupère l'enveloppe MKEK actuelle depuis Wayne
      const wayneResponse = await wayneClient.getMyKeyEnvelope()
      const currentEnvelope = wayneResponse.envelope

      // Appelle la commande Tauri pour changer le mot de passe maître (change le MKEK)
      const result = await invoke<ChangePasswordResponse>('crypto_change_password', {
        req: {
          old_password: oldMasterPassword,
          new_password: newMasterPassword,
          old_password_salt: currentEnvelope.password_salt,
          old_mkek: {
            nonce: currentEnvelope.mkek.nonce,
            payload: currentEnvelope.mkek.payload,
          },
        },
      })

      // Envoie le nouveau MKEK à Wayne (ne change pas le mot de passe Wayne)
      // Note: old_password et new_password ne sont pas requis pour 'master'
      // La vérification de l'ancien mot de passe maître se fait côté client (déchiffrement du MKEK)
      await wayneClient.changePassword({
        password_type: 'master',
        new_password_salt: result.new_password_salt,
        new_mkek: {
          nonce: result.new_mkek.nonce,
          payload: result.new_mkek.payload,
        },
      })

      setStatus({
        type: 'success',
        message: '✅ Mot de passe maître changé avec succès ! Le MKEK a été mis à jour. Tu devras utiliser le nouveau mot de passe maître pour déverrouiller le coffre.',
      })

      // Ne déconnecte pas, l'utilisateur peut continuer à utiliser l'app
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du changement de mot de passe maître: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>Paramètres</h2>
          <button className="settings-modal-close" onClick={onClose} disabled={isLoading}>
            ×
          </button>
        </div>

        <div className="settings-modal-content">
          {/* Sélecteur de type de mot de passe */}
          <div className="password-type-selector">
            <button
              className={`password-type-btn ${passwordType === 'wayne' ? 'active' : ''}`}
              onClick={() => setPasswordType('wayne')}
              disabled={isLoading}
            >
              Mot de passe Wayne
            </button>
            <button
              className={`password-type-btn ${passwordType === 'master' ? 'active' : ''}`}
              onClick={() => setPasswordType('master')}
              disabled={isLoading}
            >
              Mot de passe maître
            </button>
          </div>

          {passwordType === 'wayne' ? (
            <Card title="Changer le mot de passe Wayne">
              <p className="settings-description">
                Change ton mot de passe Wayne (pour te connecter au serveur). 
                Cette opération ne modifie pas le mot de passe maître ni le MKEK.
                Tu devras te reconnecter avec le nouveau mot de passe Wayne.
              </p>

              <Input
                label="Ancien mot de passe Wayne"
                type="password"
                value={oldWaynePassword}
                onChange={(e) => setOldWaynePassword(e.target.value)}
                placeholder="Entre ton mot de passe Wayne actuel"
                disabled={isLoading}
                required
              />

              <Input
                label="Nouveau mot de passe Wayne"
                type="password"
                value={newWaynePassword}
                onChange={(e) => setNewWaynePassword(e.target.value)}
                placeholder="Choisis un nouveau mot de passe (min. 8 caractères)"
                disabled={isLoading}
                required
                helperText="Le mot de passe doit contenir au moins 8 caractères"
              />

              <Input
                label="Confirmer le nouveau mot de passe Wayne"
                type="password"
                value={confirmWaynePassword}
                onChange={(e) => setConfirmWaynePassword(e.target.value)}
                placeholder="Confirme ton nouveau mot de passe"
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

              <div className="settings-modal-actions">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  disabled={isLoading}
                >
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  onClick={handleChangeWaynePassword}
                  disabled={isLoading || !oldWaynePassword || !newWaynePassword || !confirmWaynePassword}
                  loading={isLoading}
                >
                  Changer le mot de passe Wayne
                </Button>
              </div>
            </Card>
          ) : (
            <Card title="Changer le mot de passe maître">
              <p className="settings-description">
                Change ton mot de passe maître (pour déverrouiller le coffre local). 
                Cette opération met à jour le MKEK sans re-chiffrer tes données.
                La MasterKey reste identique, seule la façon de la chiffrer change.
                <strong>⚠️ Important :</strong> Tu devras utiliser le nouveau mot de passe maître pour déverrouiller le coffre.
              </p>

              <Input
                label="Ancien mot de passe maître"
                type="password"
                value={oldMasterPassword}
                onChange={(e) => setOldMasterPassword(e.target.value)}
                placeholder="Entre ton mot de passe maître actuel"
                disabled={isLoading}
                required
              />

              <Input
                label="Nouveau mot de passe maître"
                type="password"
                value={newMasterPassword}
                onChange={(e) => setNewMasterPassword(e.target.value)}
                placeholder="Choisis un nouveau mot de passe maître (min. 8 caractères)"
                disabled={isLoading}
                required
                helperText="Le mot de passe doit contenir au moins 8 caractères"
              />

              <Input
                label="Confirmer le nouveau mot de passe maître"
                type="password"
                value={confirmMasterPassword}
                onChange={(e) => setConfirmMasterPassword(e.target.value)}
                placeholder="Confirme ton nouveau mot de passe maître"
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

              <div className="settings-modal-actions">
                <Button
                  variant="secondary"
                  onClick={onClose}
                  disabled={isLoading}
                >
                  Annuler
                </Button>
                <Button
                  variant="primary"
                  onClick={handleChangeMasterPassword}
                  disabled={isLoading || !oldMasterPassword || !newMasterPassword || !confirmMasterPassword}
                  loading={isLoading}
                >
                  Changer le mot de passe maître
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

