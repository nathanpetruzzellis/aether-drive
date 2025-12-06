import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
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

type SortField = 'name' | 'size'
type SortOrder = 'asc' | 'desc'
type FileTypeFilter = 'all' | 'images' | 'documents' | 'videos' | 'audio' | 'archives' | 'other'

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
  
  // États pour recherche, tri et filtrage
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all')

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

  // Note: Le drag & drop HTML5 ne fonctionne pas dans Tauri car Tauri intercepte les événements natifs
  // Pour l'instant, on utilise uniquement le sélecteur de fichier
  // TODO: Implémenter le drag & drop via l'API Tauri native quand elle sera disponible

  // Chargement des fichiers depuis Storj avec retry
  async function loadFiles() {
    setIsLoading(true)
    setStatus(null)
    
    try {
      let attempts = 0
      const maxAttempts = 3
      
      while (attempts < maxAttempts) {
        try {
          attempts++
          
          if (attempts > 1) {
            setStatus({ type: 'info', message: `Tentative ${attempts}/${maxAttempts} de chargement des fichiers...` })
            // Attendre avant de réessayer (backoff exponentiel)
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
          }
          
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
          if (attempts > 1) {
            setStatus({ type: 'success', message: `✅ Fichiers chargés avec succès (tentative ${attempts})` })
          } else {
            // Réinitialise le statut après un chargement réussi silencieux
            setTimeout(() => setStatus(null), 2000)
          }
          return
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          
          if (attempts >= maxAttempts) {
            // Dernière tentative échouée
            setStatus({ 
              type: 'error', 
              message: `Erreur lors du chargement des fichiers après ${maxAttempts} tentatives.\n\n💡 Suggestions :\n• Vérifie ta connexion Internet\n• Vérifie que Storj est configuré\n• Réessaie dans quelques instants\n\nErreur : ${errorMsg}` 
            })
            break
          } else {
            // Continue avec le retry
            console.warn(`Tentative ${attempts} échouée, nouvelle tentative...`, errorMsg)
          }
        }
      }
    } finally {
      // S'assure que isLoading est toujours réinitialisé
      setIsLoading(false)
    }
  }

  // Upload d'un fichier (sélection ou drag & drop) avec retry
  async function handleFileUpload(file: File) {
    if (!storjConfigured) {
      setStatus({ type: 'error', message: 'Storj n\'est pas configuré. Connecte-toi à Wayne.' })
      return
    }

    setIsUploading(true)
    setStatus({ type: 'info', message: `📤 Préparation de "${file.name}"...` })

    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        attempts++
        
        if (attempts > 1) {
          setStatus({ type: 'info', message: `🔄 Nouvelle tentative d'upload (${attempts}/${maxAttempts})...` })
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
        } else {
          setStatus({ type: 'info', message: `📤 Lecture du fichier "${file.name}"...` })
        }

        // Lit le fichier
        const fileData = await file.arrayBuffer()
        const fileArray = Array.from(new Uint8Array(fileData))

        // Génère automatiquement le chemin logique depuis le nom du fichier
        const logicalPath = `/${file.name}`

        setStatus({ type: 'info', message: `🔐 Chiffrement de "${file.name}"...` })

        // Chiffre le fichier
        const encrypted = await invoke<number[]>('storage_encrypt_file', {
          data: fileArray,
          logicalPath: logicalPath,
        })

        setStatus({ type: 'info', message: `☁️ Upload de "${file.name}" vers Storj...` })

        // Upload vers Storj (synchronise automatiquement avec l'index local)
        await invoke<string>('storj_upload_file', {
          encryptedData: encrypted,
          logicalPath: logicalPath,
        })

        setStatus({ type: 'success', message: `✅ Fichier "${file.name}" uploadé avec succès` })
        
        // Recharge la liste des fichiers
        await loadFiles()
        return
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        
        if (attempts >= maxAttempts) {
          // Dernière tentative échouée
          setStatus({ 
            type: 'error', 
            message: `Erreur lors de l'upload de "${file.name}" après ${maxAttempts} tentatives.\n\n💡 Suggestions :\n• Vérifie ta connexion Internet\n• Le fichier est peut-être trop volumineux\n• Réessaie dans quelques instants\n\nErreur : ${errorMsg}` 
          })
        } else {
          // Continue avec le retry
          console.warn(`Tentative ${attempts} d'upload échouée, nouvelle tentative...`, errorMsg)
        }
      }
    }
    
    setIsUploading(false)
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

  // Téléchargement d'un fichier avec retry
  async function handleDownload(file: FileInfo) {
    if (!file.logical_path) {
      setStatus({ type: 'error', message: 'Chemin logique non disponible pour ce fichier.' })
      return
    }

    setIsLoading(true)
    setStatus(null)

    const fileName = file.logical_path.split('/').pop() || 'fichier'
    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        attempts++
        
        if (attempts > 1) {
          setStatus({ type: 'info', message: `🔄 Nouvelle tentative de téléchargement (${attempts}/${maxAttempts})...` })
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
        } else {
          setStatus({ type: 'info', message: `📥 Téléchargement de "${fileName}" depuis Storj...` })
        }

        // Télécharge depuis Storj
        const encryptedData = await invoke<number[]>('storj_download_file_by_path', {
          logicalPath: file.logical_path,
        })

        setStatus({ type: 'info', message: `🔓 Déchiffrement de "${fileName}"...` })

        // Déchiffre le fichier
        const decrypted = await invoke<number[]>('storage_decrypt_file', {
          encryptedData: encryptedData,
          logicalPath: file.logical_path,
        })

        setStatus({ type: 'info', message: `💾 Sauvegarde de "${fileName}"...` })

        // Sauvegarde le fichier
        const savedPath = await invoke<string>('save_decrypted_file', {
          data: decrypted,
          suggestedName: fileName,
        })

        setStatus({ type: 'success', message: `✅ Fichier téléchargé : ${savedPath}` })
        return
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        
        if (attempts >= maxAttempts) {
          // Dernière tentative échouée
          setStatus({ 
            type: 'error', 
            message: `Erreur lors du téléchargement de "${fileName}" après ${maxAttempts} tentatives.\n\n💡 Suggestions :\n• Vérifie ta connexion Internet\n• Le fichier peut être corrompu\n• Réessaie dans quelques instants\n\nErreur : ${errorMsg}` 
          })
        } else {
          // Continue avec le retry
          console.warn(`Tentative ${attempts} de téléchargement échouée, nouvelle tentative...`, errorMsg)
        }
      }
    }
    
    setIsLoading(false)
  }

  // Suppression d'un fichier avec retry
  async function handleDelete(file: FileInfo) {
    const fileName = file.logical_path?.split('/').pop() || file.uuid
    if (!confirm(`Es-tu sûr de vouloir supprimer "${fileName}" ?`)) {
      return
    }

    setIsLoading(true)
    setStatus(null)

    let attempts = 0
    const maxAttempts = 3

    while (attempts < maxAttempts) {
      try {
        attempts++
        
        if (attempts > 1) {
          setStatus({ type: 'info', message: `🔄 Nouvelle tentative de suppression (${attempts}/${maxAttempts})...` })
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts))
        } else {
          setStatus({ type: 'info', message: `🗑️ Suppression de "${fileName}"...` })
        }

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

        setStatus({ type: 'success', message: `✅ Fichier "${fileName}" supprimé avec succès` })
        
        // Recharge la liste des fichiers
        await loadFiles()
        return
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e)
        
        if (attempts >= maxAttempts) {
          // Dernière tentative échouée
          setStatus({ 
            type: 'error', 
            message: `Erreur lors de la suppression de "${fileName}" après ${maxAttempts} tentatives.\n\n💡 Suggestions :\n• Vérifie ta connexion Internet\n• Réessaie dans quelques instants\n\nErreur : ${errorMsg}` 
          })
        } else {
          // Continue avec le retry
          console.warn(`Tentative ${attempts} de suppression échouée, nouvelle tentative...`, errorMsg)
        }
      }
    }
    
    setIsLoading(false)
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

  // Obtient la catégorie de fichier pour le filtrage
  function getFileCategory(fileName: string): FileTypeFilter {
    const ext = fileName.split('.').pop()?.toLowerCase() || ''
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico']
    const docExts = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx']
    const videoExts = ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv', 'm4v']
    const audioExts = ['mp3', 'wav', 'flac', 'aac', 'ogg', 'wma', 'm4a']
    const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz']
    
    if (imageExts.includes(ext)) return 'images'
    if (docExts.includes(ext)) return 'documents'
    if (videoExts.includes(ext)) return 'videos'
    if (audioExts.includes(ext)) return 'audio'
    if (archiveExts.includes(ext)) return 'archives'
    return 'other'
  }

  // Filtre et trie les fichiers
  const filteredAndSortedFiles = (() => {
    let result = [...files]

    // Filtrage par recherche
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      result = result.filter(file => {
        const fileName = file.logical_path?.split('/').pop() || file.uuid
        return fileName.toLowerCase().includes(query)
      })
    }

    // Filtrage par type
    if (fileTypeFilter !== 'all') {
      result = result.filter(file => {
        const fileName = file.logical_path?.split('/').pop() || file.uuid
        return getFileCategory(fileName) === fileTypeFilter
      })
    }

    // Tri
    result.sort((a, b) => {
      let comparison = 0
      
      if (sortBy === 'name') {
        const nameA = (a.logical_path?.split('/').pop() || a.uuid).toLowerCase()
        const nameB = (b.logical_path?.split('/').pop() || b.uuid).toLowerCase()
        comparison = nameA.localeCompare(nameB)
      } else if (sortBy === 'size') {
        const sizeA = a.encrypted_size || 0
        const sizeB = b.encrypted_size || 0
        comparison = sizeA - sizeB
      }
      
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  })()

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
            onDragStart={(e) => {
              // Empêche le drag & drop de fichiers depuis l'app
              e.preventDefault()
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
                  Clique pour sélectionner un fichier
                </p>
                <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
                  Le drag & drop sera disponible dans une prochaine version
                </p>
              </div>
            )}
          </div>
        </Card>

        {/* Tableau de fichiers */}
        <Card title="Mes fichiers">
          {/* Contrôles de recherche, tri et filtrage */}
          <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Barre de recherche */}
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  type="text"
                  placeholder="🔍 Rechercher un fichier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.75rem 1rem',
                    paddingLeft: '2.5rem',
                    fontSize: '0.95rem',
                    border: '2px solid var(--border, #ddd)',
                    borderRadius: '8px',
                    transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--primary, #007bff)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border, #ddd)'}
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: '0.5rem',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '1.2rem',
                      padding: '0.25rem',
                    }}
                    title="Effacer la recherche"
                  >
                    ✕
                  </button>
                )}
              </div>
              <Button variant="secondary" onClick={loadFiles} loading={isLoading} disabled={isLoading || !storjConfigured}>
                🔄 Actualiser
              </Button>
            </div>

            {/* Filtres par type et tri */}
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* Filtres par type */}
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem', marginRight: '0.25rem' }}>Type:</span>
                {(['all', 'images', 'documents', 'videos', 'audio', 'archives', 'other'] as FileTypeFilter[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setFileTypeFilter(type)}
                    style={{
                      padding: '0.5rem 0.75rem',
                      fontSize: '0.85rem',
                      border: '1px solid var(--border, #ddd)',
                      borderRadius: '6px',
                      background: fileTypeFilter === type ? 'var(--primary, #007bff)' : 'transparent',
                      color: fileTypeFilter === type ? 'white' : 'var(--text-primary, #333)',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      if (fileTypeFilter !== type) {
                        e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (fileTypeFilter !== type) {
                        e.currentTarget.style.background = 'transparent'
                      }
                    }}
                  >
                    {type === 'all' ? 'Tous' : type === 'images' ? '🖼️ Images' : type === 'documents' ? '📄 Documents' : type === 'videos' ? '🎬 Vidéos' : type === 'audio' ? '🎵 Audio' : type === 'archives' ? '📦 Archives' : '📁 Autres'}
                  </button>
                ))}
              </div>

              {/* Tri */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginLeft: 'auto' }}>
                <span style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>Trier par:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortField)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.85rem',
                    border: '1px solid var(--border, #ddd)',
                    borderRadius: '6px',
                    background: 'white',
                    cursor: 'pointer',
                  }}
                >
                  <option value="name">Nom</option>
                  <option value="size">Taille</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.85rem',
                    border: '1px solid var(--border, #ddd)',
                    borderRadius: '6px',
                    background: 'white',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                  title={sortOrder === 'asc' ? 'Tri croissant' : 'Tri décroissant'}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {/* Compteur de résultats */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <p style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
              {filteredAndSortedFiles.length} fichier{filteredAndSortedFiles.length > 1 ? 's' : ''} 
              {searchQuery || fileTypeFilter !== 'all' ? ` (sur ${files.length} au total)` : ''}
            </p>
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
          ) : filteredAndSortedFiles.length === 0 ? (
            <div className="empty-state" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary, #666)' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</div>
              <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Aucun fichier trouvé</p>
              <p style={{ fontSize: '0.9rem' }}>
                {searchQuery ? `Aucun fichier ne correspond à "${searchQuery}"` : `Aucun fichier de type "${fileTypeFilter}"`}
              </p>
              <Button
                variant="secondary"
                onClick={() => {
                  setSearchQuery('')
                  setFileTypeFilter('all')
                }}
                style={{ marginTop: '1rem' }}
              >
                Réinitialiser les filtres
              </Button>
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
                  {filteredAndSortedFiles.map((file) => {
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
