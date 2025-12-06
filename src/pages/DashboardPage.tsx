import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { StatusMessage } from '../components/StatusMessage'
import { SettingsModal } from '../components/SettingsModal'
import { WayneClient } from '../wayne_client'
import './DashboardPage.css'

interface FileInfo {
  uuid: string
  logical_path: string | null
  encrypted_size: number | null
  // Métadonnées supplémentaires depuis l'index local
  file_id?: string
  created_at?: string
}

interface DashboardPageProps {
  wayneClient: WayneClient | null
  onLogout: () => void
}

export function DashboardPage({ wayneClient, onLogout }: DashboardPageProps) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; message: string } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [storjConfigured, setStorjConfigured] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)

  // Configuration automatique de Storj au chargement
  useEffect(() => {
    async function loadStorjConfig() {
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
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
          console.log('✅ Storj configuré automatiquement depuis Wayne')
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          if (errorMsg.includes('Not Found') || errorMsg.includes('404')) {
            try {
              await wayneClient.createStorjBucket()
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
            } catch (createError) {
              console.warn('⚠️ Storj non disponible:', createError)
              setStorjConfigured(false)
            }
          } else {
            console.warn('⚠️ Storj non disponible:', errorMsg)
            setStorjConfigured(false)
          }
        }
      }
    }
    loadStorjConfig()
  }, [wayneClient])

  // Chargement automatique des fichiers au montage
  useEffect(() => {
    if (storjConfigured) {
      loadFiles()
    }
  }, [storjConfigured])

  // Écoute les événements de file drop natifs de Tauri
  useEffect(() => {
    let unlistenDrop: (() => void) | undefined
    let unlistenHover: (() => void) | undefined
    let unlistenCancelled: (() => void) | undefined

    async function setupFileDropListeners() {
      try {
        // Écoute l'événement de drop natif de Tauri
        // Dans Tauri 2.0, les événements sont émis avec le format: { paths: string[] }
        unlistenDrop = await listen('tauri://file-drop', async (event: any) => {
          console.log('Tauri file-drop event:', event.payload)
          // Le payload peut être un tableau de chemins ou un objet avec paths
          let filePaths: string[] = []
          if (Array.isArray(event.payload)) {
            filePaths = event.payload
          } else if (event.payload?.paths) {
            filePaths = event.payload.paths
          } else if (typeof event.payload === 'string') {
            filePaths = [event.payload]
          }
          
          if (filePaths.length > 0) {
            try {
              // Pour l'instant, on utilise le premier fichier
              const filePath = filePaths[0]
              
              // Lit le fichier depuis le système de fichiers
              const fileData = await invoke<{ path: string; name: string; data: number[]; size: number }>('select_and_read_file_from_path', {
                filePath: filePath,
              })
              
              // Utilise directement les données pour l'upload
              const logicalPath = `/${fileData.name}`
              
              // Chiffre le fichier
              const encrypted = await invoke<number[]>('storage_encrypt_file', {
                data: fileData.data,
                logicalPath: logicalPath,
              })
              
              // Upload vers Storj
              await invoke<string>('storj_upload_file', {
                encryptedData: encrypted,
                logicalPath: logicalPath,
              })
              
              setStatus({ type: 'success', message: `✅ Fichier "${fileData.name}" uploadé avec succès` })
              await loadFiles()
            } catch (e) {
              const errorMsg = e instanceof Error ? e.message : String(e)
              setStatus({ type: 'error', message: `Erreur lors de la lecture du fichier: ${errorMsg}` })
            }
          }
        })

        // Écoute l'événement de hover pour le feedback visuel
        unlistenHover = await listen('tauri://file-drop-hover', () => {
          setIsDragging(true)
        })

        // Écoute l'événement de cancellation
        unlistenCancelled = await listen('tauri://file-drop-cancelled', () => {
          setIsDragging(false)
        })
      } catch (e) {
        console.error('Failed to setup file drop listeners:', e)
      }
    }

    setupFileDropListeners()

    return () => {
      unlistenDrop?.()
      unlistenHover?.()
      unlistenCancelled?.()
    }
  }, [])

  // Chargement des fichiers depuis Storj
  async function loadFiles() {
    setIsLoading(true)
    setStatus(null)
    try {
      const storjFiles = await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
      
      // Enrichir avec les métadonnées de l'index local
      const enrichedFiles: FileInfo[] = await Promise.all(
        storjFiles.map(async (file) => {
          try {
            // Récupère les métadonnées depuis l'index local si disponibles
            const localFile = await invoke<{ id: string; logical_path: string; encrypted_size: number } | null>('index_get_file', {
              fileId: file.uuid,
            })
            
            return {
              uuid: file.uuid,
              logical_path: localFile?.logical_path || file.logical_path,
              encrypted_size: localFile?.encrypted_size || file.encrypted_size || 0,
              file_id: localFile?.id,
            } as FileInfo
          } catch {
            return {
              uuid: file.uuid,
              logical_path: file.logical_path,
              encrypted_size: file.encrypted_size || 0,
            } as FileInfo
          }
        })
      )
      
      setFiles(enrichedFiles)
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du chargement des fichiers: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Upload d'un fichier (sélection ou drag & drop)
  async function handleFileUpload(file: File) {
    if (!storjConfigured) {
      setStatus({ type: 'error', message: 'Storj n\'est pas configuré. Connecte-toi à Wayne.' })
      return
    }

    setIsUploading(true)
    setStatus(null)

    try {
      // Lit le fichier
      const fileData = await file.arrayBuffer()
      const fileArray = Array.from(new Uint8Array(fileData))

      // Génère automatiquement le chemin logique depuis le nom du fichier
      const logicalPath = `/${file.name}`

      // Chiffre le fichier
      const encrypted = await invoke<number[]>('storage_encrypt_file', {
        data: fileArray,
        logicalPath: logicalPath,
      })

      // Upload vers Storj (synchronise automatiquement avec l'index local)
      await invoke<string>('storj_upload_file', {
        encryptedData: encrypted,
        logicalPath: logicalPath,
      })

      setStatus({ type: 'success', message: `✅ Fichier "${file.name}" uploadé avec succès` })
      
      // Recharge la liste des fichiers
      await loadFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de l'upload: ${errorMsg}` })
    } finally {
      setIsUploading(false)
    }
  }

  // Gestion du drag & drop
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-moz-file')) {
      setIsDragging(true)
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
    console.log('Drag enter, types:', e.dataTransfer.types)
    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('application/x-moz-file')) {
      setIsDragging(true)
    }
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    // Ne désactive le drag que si on quitte vraiment la zone (pas juste un enfant)
    const rect = dropZoneRef.current?.getBoundingClientRect()
    if (rect) {
      const x = e.clientX
      const y = e.clientY
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        setIsDragging(false)
      }
    } else {
      setIsDragging(false)
    }
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    console.log('Drop event:', e.dataTransfer.files.length, 'files')
    
    const droppedFiles = Array.from(e.dataTransfer.files)
    console.log('Dropped files:', droppedFiles.map(f => f.name))
    
    if (droppedFiles.length > 0) {
      console.log('Processing file:', droppedFiles[0].name)
      await handleFileUpload(droppedFiles[0])
    } else {
      console.warn('No files in drop event')
      setStatus({ type: 'error', message: 'Aucun fichier détecté dans le glisser-déposer' })
    }
  }

  // Sélection de fichier via bouton
  function handleFileSelect() {
    fileInputRef.current?.click()
  }

  async function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = e.target.files
    if (selectedFiles && selectedFiles.length > 0) {
      await handleFileUpload(selectedFiles[0])
      // Reset l'input pour permettre de sélectionner le même fichier à nouveau
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Téléchargement d'un fichier
  async function handleDownload(file: FileInfo) {
    if (!file.logical_path) {
      setStatus({ type: 'error', message: 'Chemin logique non disponible pour ce fichier.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      // Télécharge depuis Storj
      const encryptedData = await invoke<number[]>('storj_download_file_by_path', {
        logicalPath: file.logical_path,
      })

      // Déchiffre le fichier
      const decrypted = await invoke<number[]>('storage_decrypt_file', {
        encryptedData: encryptedData,
        logicalPath: file.logical_path,
      })

      // Extrait le nom du fichier depuis le chemin logique
      const fileName = file.logical_path.split('/').pop() || 'fichier_dechiffre'

      // Sauvegarde le fichier
      const savedPath = await invoke<string>('save_decrypted_file', {
        data: decrypted,
        suggestedName: fileName,
      })

      setStatus({ type: 'success', message: `✅ Fichier téléchargé : ${savedPath}` })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du téléchargement: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Suppression d'un fichier
  async function handleDelete(file: FileInfo) {
    if (!confirm(`Es-tu sûr de vouloir supprimer "${file.logical_path || file.uuid}" ?`)) {
      return
    }

    setIsLoading(true)
    setStatus(null)

    try {
      // Convertit l'UUID en bytes
      const uuidNormalized = file.uuid.replace(/-/g, '').toLowerCase()
      const uuidBytes = uuidNormalized.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []
      
      if (uuidBytes.length !== 16) {
        throw new Error('UUID invalide')
      }

      // Supprime de Storj (synchronise automatiquement avec l'index local)
      await invoke('storj_delete_file', {
        fileUuid: uuidBytes,
      })

      setStatus({ type: 'success', message: `✅ Fichier supprimé avec succès` })
      
      // Recharge la liste des fichiers
      await loadFiles()
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la suppression: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Obtient l'icône du type de fichier
  function getFileIcon(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const iconMap: Record<string, string> = {
      pdf: '📄',
      doc: '📝',
      docx: '📝',
      txt: '📄',
      jpg: '🖼️',
      jpeg: '🖼️',
      png: '🖼️',
      gif: '🖼️',
      mp4: '🎬',
      avi: '🎬',
      mp3: '🎵',
      zip: '📦',
      rar: '📦',
    }
    return iconMap[ext || ''] || '📄'
  }

  // Formate la taille
  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  // Obtient le type de fichier
  function getFileType(fileName: string): string {
    const ext = fileName.split('.').pop()?.toUpperCase() || 'FICHIER'
    return ext
  }

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <h1>Aether Drive</h1>
          <p className="dashboard-subtitle">Stockage sécurisé Zero-Knowledge</p>
        </div>
        <div className="dashboard-header-right">
          {wayneClient && wayneClient.getAccessToken() && (
            <Button
              variant="secondary"
              onClick={() => setShowSettings(true)}
              style={{ marginRight: '0.75rem' }}
            >
              ⚙️ Paramètres
            </Button>
          )}
          <Button variant="secondary" onClick={onLogout}>
            🔒 Verrouiller
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
        {/* Zone d'upload avec drag & drop */}
        <Card title="Ajouter des fichiers">
          <div
            ref={dropZoneRef}
            className={`upload-zone ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={(e) => {
              // Ne déclenche le sélecteur que si on n'est pas en train de drag & drop
              if (!isDragging) {
                e.stopPropagation()
                handleFileSelect()
              }
            }}
            style={{
              border: isDragging ? '3px dashed var(--primary, #007bff)' : '2px dashed var(--border, #ddd)',
              borderRadius: '12px',
              padding: '3rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.2s',
              background: isDragging ? 'var(--bg-secondary, #f5f5f5)' : 'transparent',
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
              multiple={false}
            />
            {isUploading ? (
              <div>
                <div className="spinner" style={{ margin: '0 auto 1rem', width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid var(--primary, #007bff)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <p>Upload en cours...</p>
              </div>
            ) : (
              <div style={{ pointerEvents: 'none' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📁</div>
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem', fontWeight: '500' }}>
                  {isDragging ? 'Lâche le fichier ici' : 'Glisse-dépose un fichier ici'}
                </p>
                <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
                  ou clique pour sélectionner un fichier
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Tableau de fichiers */}
        <Card title="Mes fichiers">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
              {files.length} fichier{files.length > 1 ? 's' : ''}
            </p>
            <Button variant="secondary" onClick={loadFiles} loading={isLoading} disabled={isLoading || !storjConfigured}>
              🔄 Actualiser
            </Button>
          </div>

          {!storjConfigured ? (
            <StatusMessage
              type="info"
              message="💡 Connecte-toi à Wayne pour activer le stockage décentralisé."
            />
          ) : files.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary, #666)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📂</div>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Aucun fichier</p>
              <p style={{ fontSize: '0.9rem' }}>Commence par uploader un fichier ci-dessus</p>
            </div>
          ) : (
            <div className="files-table-container" style={{ overflowX: 'auto' }}>
              <table className="files-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border, #ddd)' }}>
                    <th style={{ textAlign: 'left', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Nom</th>
                    <th style={{ textAlign: 'right', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Taille</th>
                    <th style={{ textAlign: 'center', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((file) => {
                    const fileName = file.logical_path?.split('/').pop() || file.uuid
                    return (
                      <tr key={file.uuid} style={{ borderBottom: '1px solid var(--border, #eee)', transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <td style={{ padding: '0.75rem', fontSize: '1.5rem' }}>{getFileIcon(fileName)}</td>
                        <td style={{ padding: '0.75rem' }}>
                          <div>
                            <div style={{ fontWeight: '500' }}>{fileName}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #666)', marginTop: '0.25rem' }}>
                              {getFileType(fileName)}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary, #666)' }}>
                          {formatSize(file.encrypted_size || 0)}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDownload(file)
                              }}
                              disabled={isLoading || !file.logical_path}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                padding: '0.5rem',
                                borderRadius: '4px',
                                transition: 'background 0.2s',
                                opacity: (!file.logical_path || isLoading) ? 0.5 : 1,
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              title="Télécharger"
                            >
                              📥
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleDelete(file)
                              }}
                              disabled={isLoading}
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                fontSize: '1.2rem',
                                padding: '0.5rem',
                                borderRadius: '4px',
                                transition: 'background 0.2s',
                                opacity: isLoading ? 0.5 : 1,
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                              onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                              title="Supprimer"
                            >
                              🗑️
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}
