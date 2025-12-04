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

function App() {
  const [password, setPassword] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [status, setStatus] = useState<string | null>(null)
  const [bootstrapData, setBootstrapData] = useState<MkekBootstrapResponse | null>(null)

  async function handleBootstrap() {
    setStatus(null)
    try {
      const result = await invoke<MkekBootstrapResponse>('crypto_bootstrap', { password })
      setBootstrapData(result)
      setPhase('bootstrapped')
      setStatus("Coffre initialisé localement (MKEK généré, rien n'a quitté Rust en clair).")
    } catch (e) {
      console.error(e)
      setPhase('error')
      setStatus('Erreur lors du bootstrap cryptographique.')
    }
  }

  async function handleUnlock() {
    if (!bootstrapData) return
    setStatus(null)
    try {
      await invoke('crypto_unlock', {
        req: {
          password,
          password_salt: bootstrapData.password_salt,
          mkek: bootstrapData.mkek,
        },
      })
      setPhase('unlocked')
      setStatus('Coffre déverrouillé en mémoire (MasterKey disponible uniquement côté Rust).')
    } catch (e) {
      console.error(e)
      setPhase('error')
      setStatus('Échec du déverrouillage (mot de passe incorrect ou données corrompues).')
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
          <button onClick={handleUnlock} disabled={!password || !bootstrapData}>
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
