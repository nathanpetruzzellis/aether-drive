import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './App.css'

type MkekCiphertext = {
  nonce: number[]
  payload: number[]
}

type MkekBootstrapResponse = {
  password_salt: number[]
  mkek: MkekCiphertext
}

type Phase = 'idle' | 'bootstrapped' | 'unlocked' | 'error'

const STORAGE_KEY = 'aether_drive_bootstrap_data'

// Charge les données du bootstrap depuis localStorage au démarrage.
function loadBootstrapData(): MkekBootstrapResponse | null {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return JSON.parse(stored) as MkekBootstrapResponse
    } catch (e) {
      console.error('Failed to parse stored bootstrap data:', e)
      localStorage.removeItem(STORAGE_KEY)
    }
  }
  return null
}

function App() {
  const [password, setPassword] = useState('')
  const initialBootstrapData = loadBootstrapData()
  const [phase, setPhase] = useState<Phase>(initialBootstrapData ? 'bootstrapped' : 'idle')
  const [status, setStatus] = useState<string | null>(
    initialBootstrapData ? 'Données du coffre chargées. Tu peux déverrouiller avec ton mot de passe.' : null
  )
  const [bootstrapData, setBootstrapData] = useState<MkekBootstrapResponse | null>(initialBootstrapData)

  async function handleBootstrap() {
    setStatus(null)
    try {
      const result = await invoke<MkekBootstrapResponse>('crypto_bootstrap', { password })
      setBootstrapData(result)
      // Sauvegarde les données du bootstrap dans localStorage pour la persistance.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(result))
      setPhase('bootstrapped')
      setStatus("Coffre initialisé localement (MKEK généré, rien n'a quitté Rust en clair).")
    } catch (e) {
      console.error(e)
      setPhase('error')
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors du bootstrap cryptographique: ${errorMsg}`)
    }
  }

  async function handleUnlock() {
    // Utilise bootstrapData du state ou charge depuis localStorage.
    const dataToUse = bootstrapData || (() => {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        try {
          return JSON.parse(stored) as MkekBootstrapResponse
        } catch {
          return null
        }
      }
      return null
    })()

    if (!dataToUse) {
      setPhase('error')
      setStatus('Aucune donnée de bootstrap trouvée. Initialise d\'abord le coffre.')
      return
    }

    setStatus(null)
    try {
      await invoke('crypto_unlock', {
        req: {
          password,
          password_salt: dataToUse.password_salt,
          mkek: dataToUse.mkek,
        },
      })
      setPhase('unlocked')
      setStatus('Coffre déverrouillé en mémoire (MasterKey disponible uniquement côté Rust).')
    } catch (e) {
      console.error(e)
      setPhase('error')
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Échec du déverrouillage: ${errorMsg}`)
    }
  }

  return (
    <div className="app">
      <h1>Aether Drive – Crypto Core (Local)</h1>

      <div className="card">
        <label>
          Mot de passe maître
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Choisis une passphrase robuste"
          />
        </label>

        <div className="actions">
          <button onClick={handleBootstrap} disabled={!password}>
            Initialiser le coffre (bootstrap)
          </button>
          <button onClick={handleUnlock} disabled={!password}>
            Déverrouiller le coffre (unlock)
          </button>
        </div>

        <div className="status">
          <strong>État :</strong> {phase}
        </div>
        {status && <p className="message">{status}</p>}
      </div>

      <p className="read-the-docs">
        Ce panneau pilote uniquement le moteur Rust local : aucune clé en clair ne quitte Rust, seul
        le sel et le ciphertext MKEK sont visibles côté UI, conformément à la blueprint.
      </p>
    </div>
  )
}

export default App
