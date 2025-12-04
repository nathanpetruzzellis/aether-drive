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

type FileEntry = {
  id: string
  logical_path: string
  encrypted_size: number
}

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
  const [files, setFiles] = useState<FileEntry[]>([])
  const [newFileId, setNewFileId] = useState('')
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileSize, setNewFileSize] = useState('')
  const [removeFileId, setRemoveFileId] = useState('')

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
      // Charge la liste des fichiers après déverrouillage.
      await handleListFiles()
    } catch (e) {
      console.error(e)
      setPhase('error')
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Échec du déverrouillage: ${errorMsg}`)
    }
  }

  async function handleAddFile() {
    console.log('handleAddFile called', { newFileId, newFilePath, newFileSize })
    if (!newFileId || !newFilePath || !newFileSize) {
      setStatus('Tous les champs sont requis pour ajouter un fichier.')
      return
    }
    const size = parseInt(newFileSize, 10)
    if (isNaN(size) || size < 0) {
      setStatus('La taille doit être un nombre positif.')
      return
    }
    try {
      console.log('Calling index_add_file with:', {
        fileId: newFileId,
        logicalPath: newFilePath,
        encryptedSize: size,
      })
      await invoke('index_add_file', {
        req: {
          fileId: newFileId,
          logicalPath: newFilePath,
          encryptedSize: size,
        },
      })
      console.log('index_add_file succeeded')
      setStatus(`Fichier "${newFilePath}" ajouté à l'index.`)
      setNewFileId('')
      setNewFilePath('')
      setNewFileSize('')
      await handleListFiles()
    } catch (e) {
      console.error('index_add_file error:', e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de l'ajout: ${errorMsg}`)
    }
  }

  async function handleListFiles() {
    try {
      const result = await invoke<FileEntry[]>('index_list_files')
      setFiles(result)
      setStatus(`${result.length} fichier(s) dans l'index.`)
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la liste: ${errorMsg}`)
    }
  }

  async function handleRemoveFile() {
    if (!removeFileId) {
      setStatus('ID du fichier requis pour suppression.')
      return
    }
    try {
      await invoke('index_remove_file', { fileId: removeFileId })
      setStatus(`Fichier "${removeFileId}" supprimé de l'index.`)
      setRemoveFileId('')
      await handleListFiles()
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la suppression: ${errorMsg}`)
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

      {phase === 'unlocked' && (
        <div className="card">
          <h2>Gestion de l'index SQLCipher</h2>

          <div className="section">
            <h3>Ajouter un fichier</h3>
            <label>
              ID du fichier
              <input
                type="text"
                value={newFileId}
                onChange={(e) => setNewFileId(e.target.value)}
                placeholder="ex: file-001"
              />
            </label>
            <label>
              Chemin logique
              <input
                type="text"
                value={newFilePath}
                onChange={(e) => setNewFilePath(e.target.value)}
                placeholder="ex: /documents/rapport.pdf"
              />
            </label>
            <label>
              Taille chiffrée (octets)
              <input
                type="number"
                value={newFileSize}
                onChange={(e) => setNewFileSize(e.target.value)}
                placeholder="ex: 1024"
              />
            </label>
            <button onClick={handleAddFile}>Ajouter à l'index</button>
          </div>

          <div className="section">
            <h3>Liste des fichiers</h3>
            <button onClick={handleListFiles}>Rafraîchir la liste</button>
            {files.length > 0 ? (
              <ul>
                {files.map((file) => (
                  <li key={file.id}>
                    <strong>{file.id}</strong>: {file.logical_path} ({file.encrypted_size} octets)
                  </li>
                ))}
              </ul>
            ) : (
              <p>Aucun fichier dans l'index.</p>
            )}
          </div>

          <div className="section">
            <h3>Supprimer un fichier</h3>
            <label>
              ID du fichier à supprimer
              <input
                type="text"
                value={removeFileId}
                onChange={(e) => setRemoveFileId(e.target.value)}
                placeholder="ex: file-001"
              />
            </label>
            <button onClick={handleRemoveFile}>Supprimer de l'index</button>
          </div>
        </div>
      )}

      <p className="read-the-docs">
        Ce panneau pilote uniquement le moteur Rust local : aucune clé en clair ne quitte Rust, seul
        le sel et le ciphertext MKEK sont visibles côté UI, conformément à la blueprint.
      </p>
    </div>
  )
}

export default App
