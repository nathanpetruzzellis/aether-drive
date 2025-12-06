import { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { StatusMessage } from '../components/StatusMessage'
import { SettingsModal } from '../components/SettingsModal'
import { WayneClient } from '../wayne_client'
import './DashboardPage.css'

type FileEntry = {
  id: string
  logical_path: string
  encrypted_size: number
}

interface DashboardPageProps {
  wayneClient: WayneClient | null
  onLogout: () => void
}

export function DashboardPage({ wayneClient, onLogout }: DashboardPageProps) {
  // États pour l'index SQLCipher
  const [files, setFiles] = useState<FileEntry[]>([])
  const [newFileId, setNewFileId] = useState('')
  const [newFilePath, setNewFilePath] = useState('')
  const [newFileSize, setNewFileSize] = useState('')
  const [removeFileId, setRemoveFileId] = useState('')
  const [isLoadingIndex, setIsLoadingIndex] = useState(false)

  // États pour le chiffrement/déchiffrement
  const [plaintextData, setPlaintextData] = useState('')
  const [encryptPath, setEncryptPath] = useState('')
  const [encryptedData, setEncryptedData] = useState<number[] | null>(null)
  const [fileInfo, setFileInfo] = useState<{ uuid: string; version: number; cipher_id: number; encrypted_size: number } | null>(null)
  const [decryptPath, setDecryptPath] = useState('')
  const [decryptedData, setDecryptedData] = useState<string | null>(null)
  const [isLoadingCrypto, setIsLoadingCrypto] = useState(false)

  // États pour Storj (géré automatiquement par Wayne)
  const [storjConfigured, setStorjConfigured] = useState(false)
  
  // Récupère automatiquement la configuration Storj depuis Wayne au chargement
  useEffect(() => {
    async function loadStorjConfig() {
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          const storjConfig = await wayneClient.getMyStorjConfig()
          // Configure automatiquement Storj avec les credentials récupérés
          await invoke('storj_configure', {
            config: {
              accessKeyId: storjConfig.access_key_id,
              secretAccessKey: storjConfig.secret_access_key,
              endpoint: storjConfig.endpoint,
              bucketName: storjConfig.bucket_name,
            },
          })
          setStorjConfigured(true)
          setStatus({ type: 'success', message: '✅ Storj configuré automatiquement depuis Wayne' })
          console.log('✅ Storj configuré automatiquement depuis Wayne')
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          console.warn('Impossible de récupérer la config Storj depuis Wayne:', e)
          // Si le bucket n'existe pas, on essaie de le créer
          if (errorMsg.includes('Not Found') || errorMsg.includes('404')) {
            try {
              await wayneClient.createStorjBucket()
              // Réessayer de récupérer la config
              const storjConfig = await wayneClient.getMyStorjConfig()
              await invoke('storj_configure', {
                config: {
                  accessKeyId: storjConfig.access_key_id,
                  secretAccessKey: storjConfig.secret_access_key,
                  endpoint: storjConfig.endpoint,
                  bucketName: storjConfig.bucket_name,
                },
              })
              setStorjConfigured(true)
              setStatus({ type: 'success', message: '✅ Bucket Storj créé et configuré automatiquement' })
            } catch (createError) {
              const createErrorMsg = createError instanceof Error ? createError.message : String(createError)
              setStatus({ type: 'warning', message: `⚠️ Storj non disponible: ${createErrorMsg}` })
              setStorjConfigured(false)
            }
          } else {
            setStatus({ type: 'warning', message: `⚠️ Storj non disponible: ${errorMsg}` })
            setStorjConfigured(false)
          }
        }
      } else {
        // Mode local : pas de Storj
        setStorjConfigured(false)
      }
    }
    loadStorjConfig()
  }, [wayneClient])
  const [storjFiles, setStorjFiles] = useState<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>([])
  const [downloadFileUuid, setDownloadFileUuid] = useState('')
  const [downloadedFileData, setDownloadedFileData] = useState<number[] | null>(null)
  const [isLoadingStorj, setIsLoadingStorj] = useState(false)

  // État global pour les messages
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null)
  
  // État pour le modal Settings
  const [showSettings, setShowSettings] = useState(false)

  // Charge la liste des fichiers au montage
  useEffect(() => {
    handleListFiles()
  }, [])

  // Index SQLCipher
  async function handleAddFile() {
    if (!newFileId || !newFilePath || !newFileSize) {
      setStatus({ type: 'error', message: 'Tous les champs sont requis pour ajouter un fichier.' })
      return
    }
    const size = parseInt(newFileSize, 10)
    if (isNaN(size) || size < 0) {
      setStatus({ type: 'error', message: 'La taille doit être un nombre positif.' })
      return
    }
    setIsLoadingIndex(true)
    setStatus(null)
    try {
      await invoke('index_add_file', {
        req: {
          fileId: newFileId,
          logicalPath: newFilePath,
          encryptedSize: size,
        },
      })
      setStatus({ type: 'success', message: `Fichier "${newFilePath}" ajouté à l'index.` })
      setNewFileId('')
      setNewFilePath('')
      setNewFileSize('')
      await handleListFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de l'ajout: ${errorMsg}` })
    } finally {
      setIsLoadingIndex(false)
    }
  }

  async function handleListFiles() {
    setIsLoadingIndex(true)
    try {
      const result = await invoke<FileEntry[]>('index_list_files')
      setFiles(result)
      if (result.length > 0) {
        setStatus({ type: 'info', message: `${result.length} fichier(s) dans l'index.` })
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la liste: ${errorMsg}` })
    } finally {
      setIsLoadingIndex(false)
    }
  }

  async function handleRemoveFile() {
    if (!removeFileId) {
      setStatus({ type: 'error', message: 'ID du fichier requis pour suppression.' })
      return
    }
    setIsLoadingIndex(true)
    setStatus(null)
    try {
      await invoke('index_remove_file', { fileId: removeFileId })
      setStatus({ type: 'success', message: `Fichier "${removeFileId}" supprimé de l'index.` })
      setRemoveFileId('')
      await handleListFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la suppression: ${errorMsg}` })
    } finally {
      setIsLoadingIndex(false)
    }
  }

  async function handleVerifyIntegrity() {
    setIsLoadingIndex(true)
    setStatus(null)
    try {
      const isValid = await invoke<boolean>('index_verify_integrity')
      if (isValid) {
        setStatus({ type: 'success', message: '✅ Intégrité de l\'index vérifiée : toutes les entrées sont valides (HMAC + Merkle Tree).' })
      } else {
        setStatus({ type: 'error', message: '❌ Intégrité de l\'index compromise : des entrées ont été modifiées ou corrompues.' })
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `❌ Erreur lors de la vérification d'intégrité: ${errorMsg}` })
    } finally {
      setIsLoadingIndex(false)
    }
  }

  // Format Aether - Chiffrement/Déchiffrement
  async function handleEncryptFile() {
    if (!plaintextData || !encryptPath) {
      setStatus({ type: 'error', message: 'Données et chemin logique requis pour chiffrement.' })
      return
    }
    setIsLoadingCrypto(true)
    setStatus(null)
    try {
      const dataBytes = new TextEncoder().encode(plaintextData)
      const dataArray = Array.from(dataBytes)

      const encrypted = await invoke<number[]>('storage_encrypt_file', {
        data: dataArray,
        logicalPath: encryptPath,
      })

      setEncryptedData(encrypted)

      const info = await invoke<{ uuid: number[]; version: number; cipher_id: number; encrypted_size: number }>('storage_get_file_info', {
        encryptedData: encrypted,
      })

      const uuidHex = info.uuid.map(b => b.toString(16).padStart(2, '0')).join('')
      setFileInfo({
        uuid: uuidHex,
        version: info.version,
        cipher_id: info.cipher_id,
        encrypted_size: info.encrypted_size,
      })

      setStatus({ type: 'success', message: `Fichier chiffré avec succès. Taille chiffrée: ${encrypted.length} octets.` })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du chiffrement: ${errorMsg}` })
    } finally {
      setIsLoadingCrypto(false)
    }
  }

  async function handleDecryptFile() {
    const dataToDecrypt = downloadedFileData || encryptedData

    if (!dataToDecrypt || !decryptPath) {
      setStatus({ type: 'error', message: 'Données chiffrées et chemin logique requis pour déchiffrement.' })
      return
    }
    setIsLoadingCrypto(true)
    setStatus(null)
    try {
      const decrypted = await invoke<number[]>('storage_decrypt_file', {
        encryptedData: dataToDecrypt,
        logicalPath: decryptPath,
      })

      const decoder = new TextDecoder('utf-8')
      const decryptedText = decoder.decode(new Uint8Array(decrypted))
      setDecryptedData(decryptedText)

      setStatus({ type: 'success', message: `Fichier déchiffré avec succès. Taille: ${decrypted.length} octets.` })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du déchiffrement: ${errorMsg}` })
      setDecryptedData(null)
    } finally {
      setIsLoadingCrypto(false)
    }
  }

  // Storj (géré automatiquement par Wayne, pas de configuration manuelle nécessaire)

  async function handleStorjUpload() {
    if (!encryptPath) {
      setStatus({ type: 'error', message: 'Chemin logique requis pour l\'upload (utilise celui du fichier chiffré).' })
      return
    }
    if (!encryptedData) {
      setStatus({ type: 'error', message: 'Aucun fichier chiffré disponible. Chiffre d\'abord un fichier dans la section "Format Aether".' })
      return
    }
    setIsLoadingStorj(true)
    setStatus(null)
    try {
      const etag = await invoke<string>('storj_upload_file', {
        encryptedData: encryptedData,
        logicalPath: encryptPath,
      })
      setStatus({ type: 'success', message: `✅ Fichier uploadé vers Storj et synchronisé avec l'index local. ETag: ${etag}` })
      await handleStorjListFiles()
      await handleListFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de l'upload Storj: ${errorMsg}` })
    } finally {
      setIsLoadingStorj(false)
    }
  }

  async function handleStorjDownload() {
    if (!downloadFileUuid) {
      setStatus({ type: 'error', message: 'UUID du fichier requis pour le download.' })
      return
    }
    setIsLoadingStorj(true)
    setStatus(null)
    try {
      const uuidBytes = downloadFileUuid.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      if (uuidBytes.length !== 16) {
        setStatus({ type: 'error', message: 'UUID invalide. Format attendu: 32 caractères hexadécimaux (ex: a1b2c3d4e5f6...)' })
        setIsLoadingStorj(false)
        return
      }

      const data = await invoke<number[]>('storj_download_file', {
        fileUuid: uuidBytes,
      })
      setDownloadedFileData(data)
      setStatus({ type: 'success', message: `✅ Fichier téléchargé depuis Storj avec succès. Taille: ${data.length} octets.` })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du download Storj: ${errorMsg}` })
      setDownloadedFileData(null)
    } finally {
      setIsLoadingStorj(false)
    }
  }

  async function handleStorjListFiles() {
    setIsLoadingStorj(true)
    setStatus(null)
    try {
      const files = await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
      setStorjFiles(files)
      if (files.length > 0) {
        setStatus({ type: 'success', message: `✅ ${files.length} fichier(s) trouvé(s) dans Storj.` })
      } else {
        setStatus({ type: 'info', message: 'Aucun fichier dans Storj.' })
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la liste Storj: ${errorMsg}` })
    } finally {
      setIsLoadingStorj(false)
    }
  }

  async function handleStorjDelete(uuid: string) {
    setIsLoadingStorj(true)
    setStatus(null)
    try {
      const uuidNormalized = uuid.replace(/-/g, '').toLowerCase()
      if (uuidNormalized.length !== 32) {
        setStatus({ type: 'error', message: `❌ UUID invalide. Format attendu: 32 caractères hexadécimaux. Reçu: ${uuidNormalized.length} caractères.` })
        setIsLoadingStorj(false)
        return
      }

      const uuidBytes = uuidNormalized.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      if (uuidBytes.length !== 16) {
        setStatus({ type: 'error', message: `❌ UUID invalide. Format attendu: 32 caractères hexadécimaux. Bytes: ${uuidBytes.length}.` })
        setIsLoadingStorj(false)
        return
      }

      await invoke('storj_delete_file', {
        fileUuid: uuidBytes,
      })
      setStatus({ type: 'success', message: `✅ Fichier supprimé de Storj et de l'index local avec succès.` })
      await handleStorjListFiles()
      await handleListFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `❌ Erreur lors de la suppression Storj: ${errorMsg}` })
    } finally {
      setIsLoadingStorj(false)
    }
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <h1>Aether Drive</h1>
          <p className="dashboard-subtitle">Dashboard</p>
        </div>
        <div className="dashboard-header-right">
          {wayneClient && wayneClient.getAccessToken() && (
            <Button
              variant="secondary"
              onClick={() => setShowSettings(true)}
              style={{ marginRight: '0.75rem' }}
            >
              ⚙️ Settings
            </Button>
          )}
          <Button variant="secondary" onClick={onLogout}>
            Verrouiller le coffre
          </Button>
        </div>
      </div>

      {status && (
        <StatusMessage
          type={status.type}
          message={status.message}
          onDismiss={() => setStatus(null)}
        />
      )}

      <div className="dashboard-content">
        {/* Index SQLCipher */}
        <Card title="Gestion de l'index SQLCipher">
          <div className="dashboard-section">
            <h3>Ajouter un fichier</h3>
            <p className="section-description">
              Ajoute une entrée de métadonnées dans l'index local. <strong>Note</strong> : cette fonctionnalité sert uniquement à tester l'index. Les fichiers ajoutés manuellement ne contiennent pas de données chiffrées et ne peuvent pas être déchiffrés.
            </p>
            <Input
              label="ID du fichier"
              value={newFileId}
              onChange={(e) => setNewFileId(e.target.value)}
              placeholder="ex: file-001"
              disabled={isLoadingIndex}
            />
            <Input
              label="Chemin logique"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              placeholder="ex: /documents/rapport.pdf"
              disabled={isLoadingIndex}
            />
            <Input
              label="Taille chiffrée (octets)"
              type="number"
              value={newFileSize}
              onChange={(e) => setNewFileSize(e.target.value)}
              placeholder="ex: 1024"
              disabled={isLoadingIndex}
            />
            <Button
              variant="primary"
              onClick={handleAddFile}
              disabled={isLoadingIndex || !newFileId || !newFilePath || !newFileSize}
              loading={isLoadingIndex}
            >
              Ajouter à l'index
            </Button>
          </div>

          <div className="dashboard-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3>Liste des fichiers</h3>
              <Button variant="secondary" onClick={handleListFiles} loading={isLoadingIndex} disabled={isLoadingIndex}>
                Rafraîchir
              </Button>
            </div>
            {files.length > 0 ? (
              <ul className="file-list">
                {files.map((file) => (
                  <li key={file.id}>
                    <strong>{file.id}</strong>: {file.logical_path} ({file.encrypted_size} octets)
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Aucun fichier dans l'index.</p>
            )}
          </div>

          <div className="dashboard-section">
            <h3>Supprimer un fichier</h3>
            <Input
              label="ID du fichier à supprimer"
              value={removeFileId}
              onChange={(e) => setRemoveFileId(e.target.value)}
              placeholder="ex: file-001"
              disabled={isLoadingIndex}
            />
            <Button
              variant="danger"
              onClick={handleRemoveFile}
              disabled={isLoadingIndex || !removeFileId}
              loading={isLoadingIndex}
            >
              Supprimer de l'index
            </Button>
          </div>

          <div className="dashboard-section">
            <h3>Vérification d'intégrité</h3>
            <p className="section-description">
              Vérifie l'intégrité globale de l'index en utilisant le Merkle Tree et les HMAC de chaque entrée.
            </p>
            <Button
              variant="primary"
              onClick={handleVerifyIntegrity}
              disabled={isLoadingIndex}
              loading={isLoadingIndex}
            >
              Vérifier l'intégrité de l'index
            </Button>
          </div>
        </Card>

        {/* Format Aether */}
        <Card title="Format de fichier Aether">
          <div className="dashboard-section">
            <h3>Chiffrer un fichier</h3>
            <div className="input-group">
              <label className="input-label">
                Données à chiffrer (texte)
              </label>
              <textarea
                className="textarea"
                value={plaintextData}
                onChange={(e) => setPlaintextData(e.target.value)}
                placeholder="Saisis du texte à chiffrer..."
                rows={4}
                disabled={isLoadingCrypto}
              />
            </div>
            <Input
              label="Chemin logique"
              value={encryptPath}
              onChange={(e) => setEncryptPath(e.target.value)}
              placeholder="ex: /documents/test.txt"
              disabled={isLoadingCrypto}
            />
            <Button
              variant="primary"
              onClick={handleEncryptFile}
              disabled={isLoadingCrypto || !plaintextData || !encryptPath}
              loading={isLoadingCrypto}
            >
              Chiffrer
            </Button>

            {fileInfo && (
              <div className="info-box">
                <h4>Métadonnées du fichier chiffré :</h4>
                <ul>
                  <li><strong>UUID :</strong> {fileInfo.uuid}</li>
                  <li><strong>Version :</strong> 0x{fileInfo.version.toString(16).padStart(2, '0')}</li>
                  <li><strong>Cipher ID :</strong> 0x{fileInfo.cipher_id.toString(16).padStart(2, '0')}</li>
                  <li><strong>Taille chiffrée :</strong> {fileInfo.encrypted_size} octets</li>
                </ul>
              </div>
            )}
          </div>

          <div className="dashboard-section">
            <h3>Déchiffrer un fichier</h3>
            <p className="section-description">
              Déchiffre un fichier au format Aether. <strong>Important</strong> : tu dois avoir des données chiffrées réelles (format Aether), pas juste une entrée dans l'index.
            </p>
            <Input
              label="Chemin logique (doit correspondre au chemin utilisé lors du chiffrement)"
              value={decryptPath}
              onChange={(e) => setDecryptPath(e.target.value)}
              placeholder="ex: /documents/test.txt"
              disabled={isLoadingCrypto}
            />
            {downloadedFileData && (
              <StatusMessage
                type="info"
                message={`💡 Utilisation des données téléchargées depuis Storj (${downloadedFileData.length} octets)`}
              />
            )}
            {!encryptedData && !downloadedFileData && (
              <StatusMessage
                type="info"
                message="💡 Chiffre d'abord un fichier dans la section ci-dessus, ou télécharge un fichier depuis Storj."
              />
            )}
            <Button
              variant="primary"
              onClick={handleDecryptFile}
              disabled={isLoadingCrypto || (!encryptedData && !downloadedFileData) || !decryptPath}
              loading={isLoadingCrypto}
            >
              Déchiffrer
            </Button>

            {decryptedData !== null && (
              <div className="success-box">
                <h4>Données déchiffrées :</h4>
                <pre className="decrypted-data">{decryptedData}</pre>
              </div>
            )}
          </div>
        </Card>

        {/* Storj DCS - Géré automatiquement par Wayne */}
        <Card title="Stockage Storj DCS">
          {!storjConfigured && wayneClient && (
            <StatusMessage
              type="info"
              message="💡 Storj est géré automatiquement par Wayne. Connecte-toi à Wayne pour activer le stockage décentralisé."
            />
          )}
          {!storjConfigured && !wayneClient && (
            <StatusMessage
              type="info"
              message="💡 Storj est géré automatiquement par Wayne. Utilise le mode Wayne pour activer le stockage décentralisé."
            />
          )}
          {storjConfigured && (
            <>
              <div className="dashboard-section">
                <h3>Upload vers Storj</h3>
                <p className="section-description">
                  Upload un fichier chiffré (format Aether) vers Storj. Le fichier sera automatiquement ajouté à l'index local avec l'UUID comme identifiant.
                </p>
                <Button
                  variant="primary"
                  onClick={handleStorjUpload}
                  disabled={isLoadingStorj || !encryptPath || !encryptedData}
                  loading={isLoadingStorj}
                >
                  Upload vers Storj (synchronise avec index)
                </Button>
                {!encryptedData && (
                  <StatusMessage
                    type="info"
                    message="💡 Chiffre d'abord un fichier dans la section 'Format Aether' pour avoir des données à uploader."
                  />
                )}
              </div>

              <div className="dashboard-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3>Liste des fichiers Storj</h3>
                  <Button variant="secondary" onClick={handleStorjListFiles} loading={isLoadingStorj} disabled={isLoadingStorj}>
                    Rafraîchir
                  </Button>
                </div>
                {storjFiles.length > 0 ? (
                  <ul className="storj-file-list">
                    {storjFiles.map((file, idx) => (
                      <li key={idx} className="storj-file-item">
                        <div className="storj-file-uuid">UUID: {file.uuid}</div>
                        {file.logical_path ? (
                          <>
                            <div className="storj-file-path">
                              <strong>Chemin logique:</strong> {file.logical_path}
                              {file.encrypted_size && <span> ({file.encrypted_size} octets)</span>}
                            </div>
                            <div className="storj-file-actions">
                              <Button
                                variant="secondary"
                                onClick={async () => {
                                  setDecryptPath(file.logical_path!)
                                  try {
                                    const data = await invoke<number[]>('storj_download_file_by_path', {
                                      logicalPath: file.logical_path!,
                                    })
                                    setDownloadedFileData(data)
                                    setEncryptedData(data)
                                    setStatus({ type: 'success', message: `✅ Fichier téléchargé et prêt à être déchiffré. Chemin: ${file.logical_path}` })
                                  } catch (e) {
                                    const errorMsg = e instanceof Error ? e.message : String(e)
                                    setStatus({ type: 'error', message: `Erreur lors du download: ${errorMsg}` })
                                    setDownloadedFileData(null)
                                  }
                                }}
                                disabled={isLoadingStorj}
                              >
                                📥 Télécharger
                              </Button>
                              <Button
                                variant="danger"
                                onClick={() => handleStorjDelete(file.uuid)}
                                disabled={isLoadingStorj}
                              >
                                🗑️ Supprimer
                              </Button>
                            </div>
                          </>
                        ) : (
                          <div className="storj-file-warning">⚠️ Non trouvé dans l'index local</div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-state">Aucun fichier dans Storj.</p>
                )}
              </div>

              <div className="dashboard-section">
                <h3>Download depuis Storj</h3>
                <p className="section-description">
                  Télécharge un fichier depuis Storj. Tu peux utiliser soit l'UUID directement, soit le chemin logique (recommandé).
                </p>
                <div style={{ marginBottom: '1rem' }}>
                  <h4>Par chemin logique (recommandé) :</h4>
                  <Input
                    label="Chemin logique"
                    value={decryptPath}
                    onChange={(e) => setDecryptPath(e.target.value)}
                    placeholder="ex: /documents/test.txt"
                    disabled={isLoadingStorj}
                  />
                  <Button
                    variant="primary"
                    onClick={async () => {
                      if (!decryptPath) {
                        setStatus({ type: 'error', message: 'Chemin logique requis.' })
                        return
                      }
                      setIsLoadingStorj(true)
                      setStatus(null)
                      try {
                        const data = await invoke<number[]>('storj_download_file_by_path', {
                          logicalPath: decryptPath,
                        })
                        setDownloadedFileData(data)
                        setStatus({ type: 'success', message: `✅ Fichier téléchargé depuis Storj via index. Taille: ${data.length} octets.` })
                      } catch (e) {
                        const errorMsg = e instanceof Error ? e.message : String(e)
                        setStatus({ type: 'error', message: `Erreur lors du download Storj: ${errorMsg}` })
                        setDownloadedFileData(null)
                      } finally {
                        setIsLoadingStorj(false)
                      }
                    }}
                    disabled={isLoadingStorj || !decryptPath}
                    loading={isLoadingStorj}
                  >
                    Download par chemin logique
                  </Button>
                </div>
                <div>
                  <h4>Par UUID (avancé) :</h4>
                  <Input
                    label="UUID du fichier (32 caractères hexadécimaux)"
                    value={downloadFileUuid}
                    onChange={(e) => setDownloadFileUuid(e.target.value)}
                    placeholder="ex: a1b2c3d4e5f6789012345678901234ab"
                    disabled={isLoadingStorj}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button
                      variant="primary"
                      onClick={handleStorjDownload}
                      disabled={isLoadingStorj || !downloadFileUuid}
                      loading={isLoadingStorj}
                    >
                      Download par UUID
                    </Button>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!downloadFileUuid) {
                          setStatus({ type: 'error', message: 'UUID du fichier requis pour la suppression.' })
                          return
                        }
                        await handleStorjDelete(downloadFileUuid)
                      }}
                      disabled={isLoadingStorj || !downloadFileUuid}
                      loading={isLoadingStorj}
                    >
                      Supprimer de Storj
                    </Button>
                  </div>
                </div>
                {downloadedFileData && (
                  <div className="info-box" style={{ marginTop: '1rem' }}>
                    <h4>Fichier téléchargé :</h4>
                    <p>Taille: {downloadedFileData.length} octets<br />Format: Aether (chiffré)</p>
                    <p style={{ fontSize: '0.85rem', color: '#666', marginTop: '0.5rem' }}>
                      💡 Tu peux maintenant déchiffrer ce fichier dans la section "Format Aether" en utilisant le chemin logique original.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </Card>
      </div>

      {showSettings && wayneClient && (
        <SettingsModal
          wayneClient={wayneClient}
          onClose={() => setShowSettings(false)}
          onPasswordChanged={() => {
            setShowSettings(false)
            onLogout()
          }}
        />
      )}
    </div>
  )
}
