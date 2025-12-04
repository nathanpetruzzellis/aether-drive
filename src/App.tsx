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
  
  // États pour le chiffrement/déchiffrement
  const [plaintextData, setPlaintextData] = useState('')
  const [encryptPath, setEncryptPath] = useState('')
  const [encryptedData, setEncryptedData] = useState<number[] | null>(null)
  const [fileInfo, setFileInfo] = useState<{ uuid: string, version: number, cipher_id: number, encrypted_size: number } | null>(null)
  const [decryptPath, setDecryptPath] = useState('')
  const [decryptedData, setDecryptedData] = useState<string | null>(null)

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

  async function handleEncryptFile() {
    if (!plaintextData || !encryptPath) {
      setStatus('Données et chemin logique requis pour chiffrement.')
      return
    }
    try {
      // Convertit le texte en bytes (UTF-8)
      const dataBytes = new TextEncoder().encode(plaintextData)
      const dataArray = Array.from(dataBytes)
      
      const encrypted = await invoke<number[]>('storage_encrypt_file', {
        data: dataArray,
        logicalPath: encryptPath,
      })
      
      setEncryptedData(encrypted)
      
      // Récupère les métadonnées
      const info = await invoke<{ uuid: number[], version: number, cipher_id: number, encrypted_size: number }>('storage_get_file_info', {
        encryptedData: encrypted,
      })
      
      // Convertit l'UUID en hexadécimal pour affichage
      const uuidHex = info.uuid.map(b => b.toString(16).padStart(2, '0')).join('')
      setFileInfo({
        uuid: uuidHex,
        version: info.version,
        cipher_id: info.cipher_id,
        encrypted_size: info.encrypted_size,
      })
      
      setStatus(`Fichier chiffré avec succès. Taille chiffrée: ${encrypted.length} octets.`)
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors du chiffrement: ${errorMsg}`)
    }
  }

  async function handleDecryptFile() {
    if (!encryptedData || !decryptPath) {
      setStatus('Données chiffrées et chemin logique requis pour déchiffrement.')
      return
    }
    try {
      const decrypted = await invoke<number[]>('storage_decrypt_file', {
        encryptedData: encryptedData,
        logicalPath: decryptPath,
      })
      
      // Convertit les bytes en texte (UTF-8)
      const decoder = new TextDecoder('utf-8')
      const decryptedText = decoder.decode(new Uint8Array(decrypted))
      setDecryptedData(decryptedText)
      
      setStatus(`Fichier déchiffré avec succès. Taille: ${decrypted.length} octets.`)
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors du déchiffrement: ${errorMsg}`)
      setDecryptedData(null)
    }
  }

  async function handleVerifyIntegrity() {
    try {
      const isValid = await invoke<boolean>('index_verify_integrity')
      if (isValid) {
        setStatus('✅ Intégrité de l\'index vérifiée : toutes les entrées sont valides.')
      } else {
        setStatus('❌ Intégrité de l\'index compromise : certaines entrées sont corrompues ou modifiées.')
      }
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la vérification d'intégrité: ${errorMsg}`)
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

          <div className="section">
            <h3>Vérification d'intégrité</h3>
            <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              Vérifie l'intégrité globale de l'index en utilisant le Merkle Tree et les HMAC de chaque entrée.
            </p>
            <button onClick={handleVerifyIntegrity}>Vérifier l'intégrité de l'index</button>
          </div>
        </div>
      )}

      {phase === 'unlocked' && (
        <div className="card">
          <h2>Test du format de fichier Aether</h2>

          <div className="section">
            <h3>Chiffrer un fichier</h3>
            <label>
              Données à chiffrer (texte)
              <textarea
                value={plaintextData}
                onChange={(e) => setPlaintextData(e.target.value)}
                placeholder="Saisis du texte à chiffrer..."
                rows={4}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
            </label>
            <label>
              Chemin logique
              <input
                type="text"
                value={encryptPath}
                onChange={(e) => setEncryptPath(e.target.value)}
                placeholder="ex: /documents/test.txt"
              />
            </label>
            <button onClick={handleEncryptFile} disabled={!plaintextData || !encryptPath}>
              Chiffrer
            </button>
            
            {fileInfo && (
              <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#f0f0f0', borderRadius: '4px' }}>
                <h4>Métadonnées du fichier chiffré :</h4>
                <ul style={{ margin: '0.5rem 0', paddingLeft: '1.5rem' }}>
                  <li><strong>UUID :</strong> {fileInfo.uuid}</li>
                  <li><strong>Version :</strong> 0x{fileInfo.version.toString(16).padStart(2, '0')}</li>
                  <li><strong>Cipher ID :</strong> 0x{fileInfo.cipher_id.toString(16).padStart(2, '0')}</li>
                  <li><strong>Taille chiffrée :</strong> {fileInfo.encrypted_size} octets</li>
                </ul>
              </div>
            )}
          </div>

          <div className="section">
            <h3>Déchiffrer un fichier</h3>
            <label>
              Chemin logique (doit correspondre au chemin utilisé lors du chiffrement)
              <input
                type="text"
                value={decryptPath}
                onChange={(e) => setDecryptPath(e.target.value)}
                placeholder="ex: /documents/test.txt"
              />
            </label>
            <button onClick={handleDecryptFile} disabled={!encryptedData || !decryptPath}>
              Déchiffrer
            </button>
            
            {decryptedData !== null && (
              <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#e8f5e9', borderRadius: '4px' }}>
                <h4>Données déchiffrées :</h4>
                <pre style={{ margin: '0.5rem 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {decryptedData}
                </pre>
              </div>
            )}
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
