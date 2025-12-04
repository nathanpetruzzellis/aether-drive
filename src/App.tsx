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
  
  // États pour Storj
  const [storjAccessKey, setStorjAccessKey] = useState('')
  const [storjSecretKey, setStorjSecretKey] = useState('')
  const [storjEndpoint, setStorjEndpoint] = useState('https://gateway.storjshare.io')
  const [storjBucket, setStorjBucket] = useState('')
  const [storjConfigured, setStorjConfigured] = useState(false)
  const [storjFiles, setStorjFiles] = useState<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>([])
  const [downloadFileUuid, setDownloadFileUuid] = useState('')
  const [downloadedFileData, setDownloadedFileData] = useState<number[] | null>(null)

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
    // Utilise downloadedFileData s'il existe (fichier téléchargé depuis Storj), sinon encryptedData (fichier chiffré localement)
    const dataToDecrypt = downloadedFileData || encryptedData
    
    if (!dataToDecrypt || !decryptPath) {
      setStatus('Données chiffrées et chemin logique requis pour déchiffrement.')
      return
    }
    try {
      const decrypted = await invoke<number[]>('storage_decrypt_file', {
        encryptedData: dataToDecrypt,
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
    setStatus(null)
    try {
      const isValid = await invoke<boolean>('index_verify_integrity')
      if (isValid) {
        setStatus('✅ Intégrité de l\'index vérifiée : toutes les entrées sont valides (HMAC + Merkle Tree).')
      } else {
        setStatus('❌ Intégrité de l\'index compromise : des entrées ont été modifiées ou corrompues.')
      }
    } catch (e) {
      console.error('index_verify_integrity error:', e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`❌ Erreur lors de la vérification d'intégrité: ${errorMsg}`)
    }
  }

  async function handleStorjConfigure() {
    setStatus(null)
    if (!storjAccessKey || !storjSecretKey || !storjEndpoint || !storjBucket) {
      setStatus('Tous les champs Storj sont requis pour la configuration.')
      return
    }
    try {
      await invoke('storj_configure', {
        config: {
          accessKeyId: storjAccessKey,
          secretAccessKey: storjSecretKey,
          endpoint: storjEndpoint,
          bucketName: storjBucket,
        },
      })
      setStorjConfigured(true)
      setStatus('✅ Client Storj configuré avec succès.')
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la configuration Storj: ${errorMsg}`)
      setStorjConfigured(false)
    }
  }

  async function handleStorjUpload() {
    setStatus(null)
    if (!encryptPath) {
      setStatus('Chemin logique requis pour l\'upload (utilise celui du fichier chiffré).')
      return
    }
    if (!encryptedData) {
      setStatus('Aucun fichier chiffré disponible. Chiffre d\'abord un fichier dans la section "Test du format de fichier Aether".')
      return
    }
    try {
      const etag = await invoke<string>('storj_upload_file', {
        encryptedData: encryptedData,
        logicalPath: encryptPath, // Utilise le chemin logique du fichier chiffré
      })
      setStatus(`✅ Fichier uploadé vers Storj et synchronisé avec l'index local. ETag: ${etag}`)
      await handleStorjListFiles()
      await handleListFiles() // Rafraîchit aussi la liste de l'index local
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de l'upload Storj: ${errorMsg}`)
    }
  }

  async function handleStorjDownload() {
    setStatus(null)
    if (!downloadFileUuid) {
      setStatus('UUID du fichier requis pour le download.')
      return
    }
    try {
      // Convertit l'UUID hexadécimal en bytes
      const uuidBytes = downloadFileUuid.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      if (uuidBytes.length !== 16) {
        setStatus('UUID invalide. Format attendu: 32 caractères hexadécimaux (ex: a1b2c3d4e5f6...)')
        return
      }
      
      const data = await invoke<number[]>('storj_download_file', {
        fileUuid: uuidBytes,
      })
      setDownloadedFileData(data)
      setStatus(`✅ Fichier téléchargé depuis Storj avec succès. Taille: ${data.length} octets.`)
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors du download Storj: ${errorMsg}`)
      setDownloadedFileData(null)
    }
  }

  async function handleStorjListFiles() {
    setStatus(null)
    try {
      const files = await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
      setStorjFiles(files)
      setStatus(`✅ ${files.length} fichier(s) trouvé(s) dans Storj.`)
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la liste Storj: ${errorMsg}`)
    }
  }

  async function handleStorjDelete() {
    setStatus(null)
    if (!downloadFileUuid) {
      setStatus('UUID du fichier requis pour la suppression.')
      return
    }
    try {
      const uuidBytes = downloadFileUuid.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      if (uuidBytes.length !== 16) {
        setStatus('UUID invalide. Format attendu: 32 caractères hexadécimaux.')
        return
      }
      
      await invoke('storj_delete_file', {
        fileUuid: uuidBytes,
      })
      setStatus(`✅ Fichier supprimé de Storj et de l'index local avec succès.`)
      await handleStorjListFiles()
      await handleListFiles() // Rafraîchit aussi la liste de l'index local
    } catch (e) {
      console.error(e)
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus(`Erreur lors de la suppression Storj: ${errorMsg}`)
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
            <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              Ajoute une entrée de métadonnées dans l'index local. <strong>Note</strong> : cette fonctionnalité sert uniquement à tester l'index. Les fichiers ajoutés manuellement ne contiennent pas de données chiffrées et ne peuvent pas être déchiffrés.
            </p>
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
            <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
              Déchiffre un fichier au format Aether. <strong>Important</strong> : tu dois avoir des données chiffrées réelles (format Aether), pas juste une entrée dans l'index.
            </p>
            <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: '#999', fontStyle: 'italic' }}>
              ⚠️ Les fichiers ajoutés manuellement dans "Gestion de l'index SQLCipher" sont des métadonnées uniquement et ne peuvent pas être déchiffrés. Seuls les fichiers chiffrés via cette section ou téléchargés depuis Storj peuvent être déchiffrés.
            </p>
            <label>
              Chemin logique (doit correspondre au chemin utilisé lors du chiffrement)
              <input
                type="text"
                value={decryptPath}
                onChange={(e) => setDecryptPath(e.target.value)}
                placeholder="ex: /documents/test.txt"
              />
            </label>
            <button onClick={handleDecryptFile} disabled={(!encryptedData && !downloadedFileData) || !decryptPath}>
              Déchiffrer
            </button>
            {downloadedFileData && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#2196f3' }}>
                💡 Utilisation des données téléchargées depuis Storj ({downloadedFileData.length} octets)
              </p>
            )}
            {!encryptedData && !downloadedFileData && (
              <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#999' }}>
                💡 Chiffre d'abord un fichier dans la section "Chiffrer un fichier" ci-dessus, ou télécharge un fichier depuis Storj.
              </p>
            )}
            
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

      {phase === 'unlocked' && (
        <div className="card">
          <h2>Intégration Storj DCS</h2>

          <div className="section">
            <h3>Configuration Storj</h3>
            <label>
              Access Key ID
              <input
                type="text"
                value={storjAccessKey}
                onChange={(e) => setStorjAccessKey(e.target.value)}
                placeholder="ex: jxxxxxxxxxxxxxxxxxxxxx"
                disabled={storjConfigured}
              />
            </label>
            <label>
              Secret Access Key
              <input
                type="password"
                value={storjSecretKey}
                onChange={(e) => setStorjSecretKey(e.target.value)}
                placeholder="ex: jxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                disabled={storjConfigured}
              />
            </label>
            <label>
              Endpoint
              <input
                type="text"
                value={storjEndpoint}
                onChange={(e) => setStorjEndpoint(e.target.value)}
                placeholder="ex: https://gateway.storjshare.io"
                disabled={storjConfigured}
              />
            </label>
            <label>
              Bucket Name
              <input
                type="text"
                value={storjBucket}
                onChange={(e) => setStorjBucket(e.target.value)}
                placeholder="ex: aether-drive-bucket"
                disabled={storjConfigured}
              />
            </label>
            <button onClick={handleStorjConfigure} disabled={storjConfigured || !storjAccessKey || !storjSecretKey || !storjEndpoint || !storjBucket}>
              {storjConfigured ? '✅ Storj configuré' : 'Configurer Storj'}
            </button>
            {storjConfigured && (
              <button onClick={() => {
                setStorjConfigured(false)
                setStorjAccessKey('')
                setStorjSecretKey('')
                setStorjBucket('')
                setStorjFiles([])
              }} style={{ marginLeft: '0.5rem' }}>
                Réinitialiser
              </button>
            )}
          </div>

          {storjConfigured && (
            <>
              <div className="section">
                <h3>Upload vers Storj</h3>
                <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                  Upload un fichier chiffré (format Aether) vers Storj. Le fichier sera automatiquement ajouté à l'index local avec l'UUID comme identifiant.
                </p>
                <p style={{ marginBottom: '0.5rem', fontSize: '0.85rem', color: '#666', fontStyle: 'italic' }}>
                  Le chemin logique utilisé lors du chiffrement sera automatiquement synchronisé avec l'index.
                </p>
                <button onClick={handleStorjUpload} disabled={!encryptPath || !encryptedData}>
                  Upload vers Storj (synchronise avec index)
                </button>
                {!encryptedData && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#999' }}>
                    💡 Chiffre d'abord un fichier dans la section "Test du format de fichier Aether" pour avoir des données à uploader.
                  </p>
                )}
                {!encryptPath && encryptedData && (
                  <p style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: '#999' }}>
                    💡 Le chemin logique est requis. Utilise celui du fichier chiffré.
                  </p>
                )}
              </div>

              <div className="section">
                <h3>Liste des fichiers Storj</h3>
                <button onClick={handleStorjListFiles}>Rafraîchir la liste</button>
                {storjFiles.length > 0 ? (
                  <ul style={{ marginTop: '0.5rem', listStyle: 'none', padding: 0 }}>
                    {storjFiles.map((file, idx) => (
                      <li key={idx} style={{ marginBottom: '0.75rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: '4px' }}>
                        <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: '#666', marginBottom: '0.25rem' }}>
                          UUID: {file.uuid}
                        </div>
                        {file.logical_path ? (
                          <div style={{ marginBottom: '0.25rem' }}>
                            <strong>Chemin logique:</strong> {file.logical_path}
                            {file.encrypted_size && <span style={{ color: '#666', fontSize: '0.9rem' }}> ({file.encrypted_size} octets)</span>}
                          </div>
                        ) : (
                          <div style={{ color: '#999', fontSize: '0.85rem', fontStyle: 'italic' }}>
                            ⚠️ Non trouvé dans l'index local
                          </div>
                        )}
                        {file.logical_path && (
                          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <button
                              onClick={async () => {
                                setStatus(null)
                                setDecryptPath(file.logical_path!)
                                try {
                                  const data = await invoke<number[]>('storj_download_file_by_path', {
                                    logicalPath: file.logical_path!,
                                  })
                                  setDownloadedFileData(data)
                                  setEncryptedData(data)
                                  setStatus(`✅ Fichier téléchargé et prêt à être déchiffré. Chemin: ${file.logical_path}`)
                                } catch (e) {
                                  console.error(e)
                                  const errorMsg = e instanceof Error ? e.message : String(e)
                                  setStatus(`Erreur lors du download: ${errorMsg}`)
                                  setDownloadedFileData(null)
                                }
                              }}
                              style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem' }}
                            >
                              📥 Télécharger et préparer le déchiffrement
                            </button>
                            <button
                              onClick={async () => {
                                setStatus(null)
                                // Normalise l'UUID (enlève les tirets) pour correspondre au format attendu
                                const uuidNormalized = file.uuid.replace(/-/g, '').toLowerCase()
                                console.log('Suppression Storj - UUID original:', file.uuid, 'UUID normalisé:', uuidNormalized)
                                
                                if (uuidNormalized.length !== 32) {
                                  setStatus(`❌ UUID invalide. Format attendu: 32 caractères hexadécimaux. Reçu: ${uuidNormalized.length} caractères.`)
                                  return
                                }
                                
                                try {
                                  const uuidBytes = uuidNormalized.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
                                  console.log('Suppression Storj - UUID bytes:', uuidBytes, 'Length:', uuidBytes.length)
                                  
                                  if (uuidBytes.length !== 16) {
                                    setStatus(`❌ UUID invalide. Format attendu: 32 caractères hexadécimaux. Bytes: ${uuidBytes.length}.`)
                                    return
                                  }
                                  
                                  setStatus('⏳ Suppression en cours...')
                                  await invoke('storj_delete_file', {
                                    fileUuid: uuidBytes,
                                  })
                                  setStatus(`✅ Fichier supprimé de Storj et de l'index local avec succès.`)
                                  
                                  // Rafraîchit les listes
                                  await handleStorjListFiles()
                                  await handleListFiles() // Rafraîchit aussi la liste de l'index local
                                } catch (e) {
                                  console.error('Erreur suppression Storj:', e)
                                  const errorMsg = e instanceof Error ? e.message : String(e)
                                  setStatus(`❌ Erreur lors de la suppression Storj: ${errorMsg}`)
                                }
                              }}
                              style={{ fontSize: '0.85rem', padding: '0.25rem 0.5rem', background: '#d32f2f', color: 'white', cursor: 'pointer' }}
                            >
                              🗑️ Supprimer de Storj
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ marginTop: '0.5rem' }}>Aucun fichier dans Storj.</p>
                )}
              </div>

              <div className="section">
                <h3>Download depuis Storj</h3>
                <p style={{ marginBottom: '0.5rem', fontSize: '0.9rem', color: '#666' }}>
                  Télécharge un fichier depuis Storj. Tu peux utiliser soit l'UUID directement, soit le chemin logique (recommandé).
                </p>
                
                <div style={{ marginBottom: '1rem' }}>
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Par chemin logique (recommandé) :</h4>
                  <label>
                    Chemin logique
                    <input
                      type="text"
                      value={decryptPath}
                      onChange={(e) => setDecryptPath(e.target.value)}
                      placeholder="ex: /documents/test.txt"
                    />
                  </label>
                  <button 
                    onClick={async () => {
                      setStatus(null)
                      if (!decryptPath) {
                        setStatus('Chemin logique requis.')
                        return
                      }
                      try {
                        const data = await invoke<number[]>('storj_download_file_by_path', {
                          logicalPath: decryptPath,
                        })
                        setDownloadedFileData(data)
                        setStatus(`✅ Fichier téléchargé depuis Storj via index. Taille: ${data.length} octets.`)
                      } catch (e) {
                        console.error(e)
                        const errorMsg = e instanceof Error ? e.message : String(e)
                        setStatus(`Erreur lors du download Storj: ${errorMsg}`)
                        setDownloadedFileData(null)
                      }
                    }} 
                    disabled={!decryptPath}
                    style={{ marginTop: '0.5rem' }}
                  >
                    Download par chemin logique
                  </button>
                </div>

                <div>
                  <h4 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Par UUID (avancé) :</h4>
                  <label>
                    UUID du fichier (32 caractères hexadécimaux)
                    <input
                      type="text"
                      value={downloadFileUuid}
                      onChange={(e) => setDownloadFileUuid(e.target.value)}
                      placeholder="ex: a1b2c3d4e5f6789012345678901234ab"
                      style={{ fontFamily: 'monospace' }}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button onClick={handleStorjDownload} disabled={!downloadFileUuid}>
                      Download par UUID
                    </button>
                    <button onClick={handleStorjDelete} disabled={!downloadFileUuid} style={{ background: '#d32f2f' }}>
                      Supprimer de Storj
                    </button>
                  </div>
                </div>

                {downloadedFileData && (
                  <div style={{ marginTop: '1rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: '4px' }}>
                    <h4>Fichier téléchargé :</h4>
                    <p style={{ fontSize: '0.9rem' }}>
                      Taille: {downloadedFileData.length} octets<br />
                      Format: Aether (chiffré)
                    </p>
                    <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}>
                      💡 Tu peux maintenant déchiffrer ce fichier dans la section "Test du format de fichier Aether" en utilisant le chemin logique original.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
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
