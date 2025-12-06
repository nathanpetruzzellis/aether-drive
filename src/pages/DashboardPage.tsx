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

interface FolderInfo {
  name: string
  path: string
}

export function DashboardPage({ wayneClient, onLogout }: DashboardPageProps) {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [currentPath, setCurrentPath] = useState<string>('/')
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
  
  // États pour les statistiques
  const [userStats, setUserStats] = useState<{ total_files: number; total_size: number; files_by_type: Record<string, number> } | null>(null)
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [fileToRename, setFileToRename] = useState<FileInfo | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileInfo } | null>(null)
  const [showTrash, setShowTrash] = useState(false)
  const [trashItems, setTrashItems] = useState<Array<{ id: string; logical_path: string; encrypted_size: number; deleted_at: number }>>([])
  const [showPreview, setShowPreview] = useState(false)
  const [previewFile, setPreviewFile] = useState<FileInfo | null>(null)
  const [previewData, setPreviewData] = useState<{ data: Uint8Array; type: 'image' | 'text' | 'pdf' | 'unsupported' } | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)

  // Ferme le menu contextuel avec la touche Escape
  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [contextMenu])

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

  // Chargement automatique des fichiers au montage et lors du changement de chemin
  useEffect(() => {
    if (storjConfigured) {
      loadFiles()
    }
  }, [storjConfigured, currentPath])

  // Chargement des statistiques utilisateur
  useEffect(() => {
    async function loadStats() {
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          const statsResponse = await wayneClient.getUserStats()
          setUserStats(statsResponse.stats)
        } catch (e) {
          console.warn('⚠️ Erreur lors du chargement des statistiques:', e)
          // Ne bloque pas l'application si les statistiques ne peuvent pas être chargées
        }
      }
    }
    loadStats()
  }, [wayneClient, files]) // Recharge les stats quand les fichiers changent

  // Note: Le drag & drop HTML5 ne fonctionne pas dans Tauri car Tauri intercepte les événements natifs
  // Pour l'instant, on utilise uniquement le sélecteur de fichier
  // TODO: Implémenter le drag & drop via l'API Tauri native quand elle sera disponible

  // Chargement des fichiers et dossiers depuis Storj (synchronisation) puis affichage depuis l'index local
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
          
          // Étape 1 : Synchronise depuis Storj (cela met à jour l'index local automatiquement)
          await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
          
          // Étape 2 : Utilise la nouvelle commande pour lister les fichiers et dossiers dans le chemin actuel depuis l'index local
          const directory = await invoke<{ files: Array<{ id: string; logical_path: string; encrypted_size: number }>; folders: FolderInfo[] }>('list_files_and_folders', {
            parentPath: currentPath === '/' ? null : currentPath,
          })
          
          // Convertit les fichiers en FileInfo
          const enrichedFiles: FileInfo[] = directory.files.map((file) => ({
            uuid: file.id,
            logical_path: file.logical_path,
            encrypted_size: file.encrypted_size,
            file_id: file.id,
          }))
          
          setFiles(enrichedFiles)
          setFolders(directory.folders)
          
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
  
  // Navigation dans un dossier
  function navigateToFolder(folderPath: string) {
    setCurrentPath(folderPath)
  }
  
  // Navigation vers le dossier parent
  function navigateToParent() {
    if (currentPath === '/') return
    const pathParts = currentPath.split('/').filter(p => p)
    pathParts.pop()
    const newPath = pathParts.length === 0 ? '/' : '/' + pathParts.join('/')
    setCurrentPath(newPath)
  }
  
  // Génère le breadcrumb (chemin de navigation)
  function getBreadcrumbs(): Array<{ name: string; path: string }> {
    if (currentPath === '/') {
      return [{ name: 'Racine', path: '/' }]
    }
    const parts = currentPath.split('/').filter(p => p)
    const breadcrumbs = [{ name: 'Racine', path: '/' }]
    let current = ''
    for (const part of parts) {
      current += '/' + part
      breadcrumbs.push({ name: part, path: current })
    }
    return breadcrumbs
  }
  
  // Renomme un fichier
  async function handleRename(file: FileInfo) {
    if (!file.logical_path) {
      setStatus({ type: 'error', message: 'Chemin logique non disponible pour ce fichier.' })
      return
    }

    setFileToRename(file)
    const currentName = file.logical_path.split('/').pop() || ''
    setNewFileName(currentName)
    setShowRenameModal(true)
  }

  async function confirmRename() {
    if (!fileToRename || !fileToRename.logical_path || !newFileName.trim()) {
      setStatus({ type: 'error', message: 'Nom de fichier invalide.' })
      return
    }

    setIsLoading(true)
    setStatus({ type: 'info', message: `Renommage de "${fileToRename.logical_path.split('/').pop()}"...` })

    try {
      // Construit le nouveau chemin logique
      const oldPath = fileToRename.logical_path
      const pathParts = oldPath.split('/')
      pathParts[pathParts.length - 1] = newFileName.trim()
      const newPath = pathParts.join('/')

      // Appelle la commande Tauri pour renommer
      await invoke<string>('rename_file', {
        oldLogicalPath: oldPath,
        newLogicalPath: newPath,
      })

      setStatus({ type: 'success', message: `✅ Fichier renommé avec succès : "${newFileName.trim()}"` })
      setShowRenameModal(false)
      setFileToRename(null)
      setNewFileName('')

      // Recharge la liste des fichiers
      console.log('🔄 Rechargement des fichiers après renommage...')
      try {
        await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
        const directory = await invoke<{ files: Array<{ id: string; logical_path: string; encrypted_size: number }>; folders: FolderInfo[] }>('list_files_and_folders', {
          parentPath: currentPath === '/' ? null : currentPath,
        })
        const enrichedFiles: FileInfo[] = directory.files.map((file) => ({
          uuid: file.id,
          logical_path: file.logical_path,
          encrypted_size: file.encrypted_size,
          file_id: file.id,
        }))
        setFiles(enrichedFiles)
        setFolders(directory.folders)
        console.log('✅ Fichiers rechargés après renommage')
      } catch (e) {
        console.error('❌ Erreur lors du rechargement:', e)
        await loadFiles()
      }

      // Met à jour les métadonnées Wayne si nécessaire
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          const statsResponse = await wayneClient.getUserStats()
          setUserStats(statsResponse.stats)
        } catch (metadataError) {
          console.warn('⚠️ Erreur lors de la mise à jour des métadonnées:', metadataError)
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `❌ Erreur lors du renommage: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Charge la corbeille
  async function loadTrash() {
    setIsLoading(true)
    setStatus(null)
    
    try {
      const items = await invoke<Array<{ id: string; logical_path: string; encrypted_size: number; deleted_at: number }>>('list_trash')
      setTrashItems(items)
      console.log('✅ Corbeille chargée:', items.length, 'éléments')
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du chargement de la corbeille: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Restaure un fichier depuis la corbeille
  async function handleRestoreFromTrash(fileId: string) {
    setIsLoading(true)
    setStatus({ type: 'info', message: 'Restauration du fichier...' })
    
    try {
      await invoke<string>('restore_from_trash', { fileId })
      setStatus({ type: 'success', message: '✅ Fichier restauré avec succès' })
      await loadTrash() // Recharge la corbeille
      await loadFiles() // Recharge les fichiers
      
      // Met à jour les métadonnées Wayne si nécessaire
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          const statsResponse = await wayneClient.getUserStats()
          setUserStats(statsResponse.stats)
        } catch (metadataError) {
          console.warn('⚠️ Erreur lors de la mise à jour des métadonnées:', metadataError)
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la restauration: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Supprime définitivement un fichier de la corbeille
  async function handlePermanentlyDelete(fileId: string, fileName: string) {
    if (!confirm(`Es-tu sûr de vouloir supprimer définitivement "${fileName}" ? Cette action est irréversible.`)) {
      return
    }

    setIsLoading(true)
    setStatus({ type: 'info', message: `Suppression définitive de "${fileName}"...` })
    
    try {
      await invoke('permanently_delete_from_trash', { fileId })
      setStatus({ type: 'success', message: `✅ Fichier "${fileName}" supprimé définitivement` })
      await loadTrash() // Recharge la corbeille
      
      // Met à jour les métadonnées Wayne si nécessaire
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          await wayneClient.deleteFileMetadata(fileId)
          const statsResponse = await wayneClient.getUserStats()
          setUserStats(statsResponse.stats)
        } catch (metadataError) {
          console.warn('⚠️ Erreur lors de la mise à jour des métadonnées:', metadataError)
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la suppression définitive: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Vide complètement la corbeille
  async function handleEmptyTrash() {
    if (!confirm(`Es-tu sûr de vouloir vider complètement la corbeille ? Tous les fichiers seront supprimés définitivement. Cette action est irréversible.`)) {
      return
    }

    setIsLoading(true)
    setStatus({ type: 'info', message: 'Vidage de la corbeille...' })
    
    try {
      const count = await invoke<number>('empty_trash')
      setStatus({ type: 'success', message: `✅ Corbeille vidée : ${count} fichier(s) supprimé(s) définitivement` })
      await loadTrash() // Recharge la corbeille (devrait être vide maintenant)
      
      // Met à jour les métadonnées Wayne si nécessaire
      if (wayneClient && wayneClient.getAccessToken()) {
        try {
          // Supprime toutes les métadonnées des fichiers supprimés
          // Note: On pourrait optimiser en supprimant toutes les métadonnées d'un coup
          const statsResponse = await wayneClient.getUserStats()
          setUserStats(statsResponse.stats)
        } catch (metadataError) {
          console.warn('⚠️ Erreur lors de la mise à jour des métadonnées:', metadataError)
        }
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors du vidage de la corbeille: ${errorMsg}` })
    } finally {
      setIsLoading(false)
    }
  }

  // Ouvre l'aperçu d'un fichier
  async function handlePreview(file: FileInfo) {
    if (!file.logical_path) {
      setStatus({ type: 'error', message: 'Impossible de prévisualiser ce fichier : chemin logique manquant' })
      return
    }

    setIsLoadingPreview(true)
    setPreviewFile(file)
    setShowPreview(true)
    setStatus(null)

    try {
      // Télécharge et déchiffre le fichier
      const decryptedData = await invoke<number[]>('preview_file', {
        fileId: file.uuid || file.file_id,
      })

      // Convertit en Uint8Array
      const dataArray = new Uint8Array(decryptedData)

      // Détermine le type de fichier
      const fileName = file.logical_path.split('/').pop() || ''
      const ext = fileName.split('.').pop()?.toLowerCase() || ''
      
      let fileType: 'image' | 'text' | 'pdf' | 'unsupported' = 'unsupported'
      
      // Images
      const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp']
      if (imageExts.includes(ext)) {
        fileType = 'image'
      }
      // PDF
      else if (ext === 'pdf') {
        fileType = 'pdf'
      }
      // Texte
      else {
        const textExts = ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'hpp', 'yaml', 'yml', 'ini', 'conf', 'log', 'csv']
        if (textExts.includes(ext)) {
          // Vérifie si c'est du texte valide UTF-8
          try {
            const decoder = new TextDecoder('utf-8', { fatal: true })
            decoder.decode(dataArray)
            fileType = 'text'
          } catch {
            // Pas du texte UTF-8 valide
            fileType = 'unsupported'
          }
        }
      }

      setPreviewData({ data: dataArray, type: fileType })
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de l'aperçu: ${errorMsg}` })
      setShowPreview(false)
      setPreviewFile(null)
      setPreviewData(null)
    } finally {
      setIsLoadingPreview(false)
    }
  }

  // Formate la date de suppression
  function formatDeletedDate(timestamp: number): string {
    const date = new Date(timestamp * 1000) // Convertit les secondes en millisecondes
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    
    if (diffDays === 0) {
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60))
      if (diffHours === 0) {
        const diffMinutes = Math.floor(diffMs / (1000 * 60))
        return `Il y a ${diffMinutes} minute${diffMinutes > 1 ? 's' : ''}`
      }
      return `Il y a ${diffHours} heure${diffHours > 1 ? 's' : ''}`
    } else if (diffDays === 1) {
      return 'Hier'
    } else if (diffDays < 7) {
      return `Il y a ${diffDays} jour${diffDays > 1 ? 's' : ''}`
    } else {
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
    }
  }

  // Crée un nouveau dossier
  async function handleCreateFolder() {
    if (!newFolderName.trim()) {
      setStatus({ type: 'error', message: 'Le nom du dossier ne peut pas être vide' })
      return
    }
    
    setIsLoading(true)
    setStatus(null)
    
    try {
      const folderPath = await invoke<string>('create_folder', {
        folderName: newFolderName.trim(),
        parentPath: currentPath === '/' ? null : currentPath,
      })
      
      setStatus({ type: 'success', message: `✅ Dossier "${newFolderName.trim()}" créé avec succès` })
      setShowCreateFolderModal(false)
      setNewFolderName('')
      // Recharge directement depuis l'index local (pas besoin de synchroniser Storj pour un dossier vide)
      console.log('🔄 Rechargement des fichiers après création de dossier...')
      try {
        const directory = await invoke<{ files: Array<{ id: string; logical_path: string; encrypted_size: number }>; folders: FolderInfo[] }>('list_files_and_folders', {
          parentPath: currentPath === '/' ? null : currentPath,
        })
        const enrichedFiles: FileInfo[] = directory.files.map((file) => ({
          uuid: file.id,
          logical_path: file.logical_path,
          encrypted_size: file.encrypted_size,
          file_id: file.id,
        }))
        setFiles(enrichedFiles)
        setFolders(directory.folders)
        console.log('✅ Fichiers rechargés après création de dossier:', { files: enrichedFiles.length, folders: directory.folders.length })
      } catch (e) {
        console.error('❌ Erreur lors du rechargement:', e)
        // Si ça échoue, on fait un loadFiles complet
        await loadFiles()
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e)
      setStatus({ type: 'error', message: `Erreur lors de la création du dossier: ${errorMsg}` })
    } finally {
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

    try {
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

          // Génère automatiquement le chemin logique depuis le nom du fichier dans le dossier actuel
          const logicalPath = currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`

          setStatus({ type: 'info', message: `🔐 Chiffrement de "${file.name}"...` })

          // Chiffre le fichier
          const encrypted = await invoke<number[]>('storage_encrypt_file', {
            data: fileArray,
            logicalPath: logicalPath,
          })

          setStatus({ type: 'info', message: `☁️ Upload de "${file.name}" vers Storj...` })

          // Récupère l'UUID du fichier depuis le fichier chiffré
          const fileInfo = await invoke<{ uuid: number[]; encrypted_size: number }>('storage_get_file_info', {
            encryptedData: encrypted,
          })
          
          // Convertit l'UUID en format hexadécimal (format standard)
          const uuidHex = fileInfo.uuid.map(b => b.toString(16).padStart(2, '0')).join('')
          const uuidFormatted = `${uuidHex.slice(0, 8)}-${uuidHex.slice(8, 12)}-${uuidHex.slice(12, 16)}-${uuidHex.slice(16, 20)}-${uuidHex.slice(20, 32)}`

          // Upload vers Storj (synchronise automatiquement avec l'index local)
          await invoke<string>('storj_upload_file', {
            encryptedData: encrypted,
            logicalPath: logicalPath,
          })

          // Synchronise les métadonnées anonymisées sur Wayne
          if (wayneClient && wayneClient.getAccessToken()) {
            try {
              const fileType = getFileCategory(file.name)
              await wayneClient.saveFileMetadata({
                file_uuid: uuidFormatted,
                encrypted_size: encrypted.length,
                file_type: fileType !== 'other' ? fileType : undefined,
              })
              // Recharge les statistiques après sauvegarde des métadonnées
              const statsResponse = await wayneClient.getUserStats()
              setUserStats(statsResponse.stats)
            } catch (metadataError) {
              // Ne bloque pas l'upload si la sauvegarde des métadonnées échoue
              console.warn('⚠️ Erreur lors de la sauvegarde des métadonnées:', metadataError)
            }
          }

          setStatus({ type: 'success', message: `✅ Fichier "${file.name}" uploadé avec succès` })
          
          // Recharge la liste des fichiers (force le rechargement complet depuis Storj)
          console.log('🔄 Rechargement des fichiers après upload...')
          try {
            // Synchronise depuis Storj puis recharge depuis l'index local
            await invoke<Array<{ uuid: string; logical_path: string | null; encrypted_size: number | null }>>('storj_list_files')
            const directory = await invoke<{ files: Array<{ id: string; logical_path: string; encrypted_size: number }>; folders: FolderInfo[] }>('list_files_and_folders', {
              parentPath: currentPath === '/' ? null : currentPath,
            })
            const enrichedFiles: FileInfo[] = directory.files.map((file) => ({
              uuid: file.id,
              logical_path: file.logical_path,
              encrypted_size: file.encrypted_size,
              file_id: file.id,
            }))
            setFiles(enrichedFiles)
            setFolders(directory.folders)
            console.log('✅ Fichiers rechargés après upload:', { files: enrichedFiles.length, folders: directory.folders.length })
          } catch (e) {
            console.error('❌ Erreur lors du rechargement:', e)
            // Si ça échoue, on fait un loadFiles complet
            await loadFiles()
          }
          return
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e)
          
          if (attempts >= maxAttempts) {
            // Dernière tentative échouée
            setStatus({ 
              type: 'error', 
              message: `Erreur lors de l'upload de "${file.name}" après ${maxAttempts} tentatives.\n\n💡 Suggestions :\n• Vérifie ta connexion Internet\n• Le fichier est peut-être trop volumineux\n• Réessaie dans quelques instants\n\nErreur : ${errorMsg}` 
            })
            break
          } else {
            // Continue avec le retry
            console.warn(`Tentative ${attempts} d'upload échouée, nouvelle tentative...`, errorMsg)
          }
        }
      }
    } finally {
      // S'assure que isUploading est toujours réinitialisé
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

        // Supprime les métadonnées sur Wayne
        // Convertit l'UUID en format standard si nécessaire
        let fileUuidForMetadata = file.uuid
        if (!fileUuidForMetadata.includes('-')) {
          // Format hex sans tirets, on le formate
          const formatted = `${fileUuidForMetadata.slice(0, 8)}-${fileUuidForMetadata.slice(8, 12)}-${fileUuidForMetadata.slice(12, 16)}-${fileUuidForMetadata.slice(16, 20)}-${fileUuidForMetadata.slice(20, 32)}`
          fileUuidForMetadata = formatted
        }
        
        if (wayneClient && wayneClient.getAccessToken()) {
          try {
            await wayneClient.deleteFileMetadata(fileUuidForMetadata)
            // Recharge les statistiques après suppression des métadonnées
            const statsResponse = await wayneClient.getUserStats()
            setUserStats(statsResponse.stats)
          } catch (metadataError) {
            // Ne bloque pas la suppression si la suppression des métadonnées échoue
            console.warn('⚠️ Erreur lors de la suppression des métadonnées:', metadataError)
          }
        }

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
          {userStats && (
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary, #666)' }}>
              <span>📊 {userStats.total_files} fichier{userStats.total_files > 1 ? 's' : ''}</span>
              <span>💾 {formatSize(userStats.total_size)}</span>
            </div>
          )}
        </div>
        <div className="dashboard-header-right">
          {wayneClient && wayneClient.getAccessToken() && (
            <Button
              variant="secondary"
              onClick={() => {
                setShowTrash(!showTrash)
                if (!showTrash) {
                  loadTrash()
                }
              }}
              style={{ marginRight: '0.75rem' }}
            >
              {showTrash ? '📁 Mes fichiers' : '🗑️ Corbeille'}
            </Button>
          )}
          {wayneClient && wayneClient.getAccessToken() && !showTrash && (
            <Button
              variant="secondary"
              onClick={() => setShowCreateFolderModal(true)}
              style={{ marginRight: '0.75rem' }}
            >
              ➕ Créer un dossier
            </Button>
          )}
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
        {showTrash ? (
          <Card title="🗑️ Corbeille">
            {trashItems.length === 0 ? (
              <div className="empty-state" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary, #666)' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🗑️</div>
                <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>La corbeille est vide</p>
                <p style={{ fontSize: '0.9rem' }}>Les fichiers que tu supprimes apparaîtront ici.</p>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
                    {trashItems.length} fichier{trashItems.length > 1 ? 's' : ''} dans la corbeille
                  </div>
                  <Button
                    variant="danger"
                    onClick={handleEmptyTrash}
                    disabled={isLoading}
                    style={{ marginLeft: 'auto' }}
                  >
                    🗑️ Vider la corbeille
                  </Button>
                </div>
                <div className="files-table-container" style={{ overflowX: 'auto' }}>
                  <table className="files-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border, #ddd)' }}>
                        <th style={{ textAlign: 'left', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Type</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Nom</th>
                        <th style={{ textAlign: 'right', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Taille</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Supprimé le</th>
                        <th style={{ textAlign: 'center', padding: '0.75rem', fontWeight: '600', color: 'var(--text-secondary, #666)' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trashItems.map((item) => {
                        const fileName = item.logical_path.split('/').pop() || item.id
                        return (
                          <tr
                            key={item.id}
                            style={{ borderBottom: '1px solid var(--border, #eee)', transition: 'background 0.2s' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          >
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
                              {formatSize(item.encrypted_size || 0)}
                            </td>
                            <td style={{ padding: '0.75rem', color: 'var(--text-secondary, #666)', fontSize: '0.9rem' }}>
                              {formatDeletedDate(item.deleted_at)}
                            </td>
                            <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                              <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                <button
                                  onClick={() => handleRestoreFromTrash(item.id)}
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
                                  title="Restaurer"
                                >
                                  ♻️
                                </button>
                                <button
                                  onClick={() => handlePermanentlyDelete(item.id, fileName)}
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
                                    color: 'var(--danger, #dc3545)',
                                  }}
                                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                                  title="Supprimer définitivement"
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
              </>
            )}
          </Card>
        ) : (
          <Card title="Mes fichiers">
          {/* Bouton créer dossier */}
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="primary"
              onClick={() => setShowCreateFolderModal(true)}
            >
              ➕ Créer un dossier
            </Button>
          </div>
          
          {/* Breadcrumb de navigation */}
          <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            {getBreadcrumbs().map((crumb, index) => (
              <div key={crumb.path} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                {index > 0 && <span style={{ color: 'var(--text-secondary, #666)' }}>/</span>}
                <button
                  onClick={() => navigateToFolder(crumb.path)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: index === getBreadcrumbs().length - 1 ? 'var(--primary, #007bff)' : 'var(--text-primary, #333)',
                    fontWeight: index === getBreadcrumbs().length - 1 ? '600' : '400',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    transition: 'background 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                >
                  {crumb.name}
                </button>
              </div>
            ))}
            {currentPath !== '/' && (
              <button
                onClick={navigateToParent}
                style={{
                  marginLeft: 'auto',
                  background: 'var(--bg-secondary, #f5f5f5)',
                  border: '1px solid var(--border, #ddd)',
                  cursor: 'pointer',
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  fontSize: '0.9rem',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--primary, #007bff)'
                  e.currentTarget.style.color = 'white'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                  e.currentTarget.style.color = 'inherit'
                }}
              >
                ⬅️ Retour
              </button>
            )}
          </div>
          
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
                    background: 'var(--bg-primary, white)',
                    color: 'var(--text-primary, #333)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="name" style={{ background: 'var(--bg-primary, white)', color: 'var(--text-primary, #333)' }}>Nom</option>
                  <option value="size" style={{ background: 'var(--bg-primary, white)', color: 'var(--text-primary, #333)' }}>Taille</option>
                </select>
                <button
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '0.5rem 0.75rem',
                    fontSize: '0.85rem',
                    border: '1px solid var(--border, #ddd)',
                    borderRadius: '6px',
                    background: 'var(--bg-primary, white)',
                    color: 'var(--text-primary, #333)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
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
              {folders.length} dossier{folders.length > 1 ? 's' : ''}, {filteredAndSortedFiles.length} fichier{filteredAndSortedFiles.length > 1 ? 's' : ''} 
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
                  {/* Affiche d'abord les dossiers */}
                  {folders.map((folder) => (
                    <tr 
                      key={folder.path} 
                      style={{ borderBottom: '1px solid var(--border, #eee)', transition: 'background 0.2s', cursor: 'pointer' }} 
                      onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'} 
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                      onClick={() => navigateToFolder(folder.path)}
                    >
                      <td style={{ padding: '0.75rem', fontSize: '1.5rem' }}>📁</td>
                      <td style={{ padding: '0.75rem' }}>
                        <div>
                          <div style={{ fontWeight: '500' }}>{folder.name}</div>
                          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #666)', marginTop: '0.25rem' }}>
                            Dossier
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'right', color: 'var(--text-secondary, #666)' }}>
                        —
                      </td>
                      <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            navigateToFolder(folder.path)
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '1.2rem',
                            padding: '0.5rem',
                            borderRadius: '4px',
                            transition: 'background 0.2s',
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                          title="Ouvrir le dossier"
                        >
                          ➡️
                        </button>
                      </td>
                    </tr>
                  ))}
                  {/* Puis les fichiers */}
                  {filteredAndSortedFiles.map((file) => {
                    const fileName = file.logical_path?.split('/').pop() || file.uuid
                    return (
                      <tr 
                        key={file.uuid} 
                        style={{ borderBottom: '1px solid var(--border, #eee)', transition: 'background 0.2s' }} 
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'} 
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        onContextMenu={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setContextMenu({ x: e.clientX, y: e.clientY, file })
                        }}
                      >
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
                                handlePreview(file)
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
                              title="Aperçu"
                            >
                              👁️
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleRename(file)
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
                              title="Renommer"
                            >
                              ✏️
                            </button>
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
        )}
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
      
      {/* Menu contextuel */}
      {contextMenu && (
        <>
          {/* Overlay pour fermer le menu au clic */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 999,
            }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          {/* Menu contextuel */}
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              background: 'var(--bg-primary, white)',
              border: '1px solid var(--border, #ddd)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              zIndex: 1000,
              minWidth: '180px',
              padding: '0.5rem 0',
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <button
              onClick={() => {
                handleRename(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading || !contextMenu.file.logical_path}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading || !contextMenu.file.logical_path ? 'not-allowed' : 'pointer',
                color: isLoading || !contextMenu.file.logical_path ? 'var(--text-secondary, #999)' : 'var(--text-primary, #333)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading && contextMenu.file.logical_path) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>✏️</span>
              <span>Renommer</span>
            </button>
            <button
              onClick={() => {
                handleDownload(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading || !contextMenu.file.logical_path}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading || !contextMenu.file.logical_path ? 'not-allowed' : 'pointer',
                color: isLoading || !contextMenu.file.logical_path ? 'var(--text-secondary, #999)' : 'var(--text-primary, #333)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading && contextMenu.file.logical_path) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>📥</span>
              <span>Télécharger</span>
            </button>
            <div style={{ height: '1px', background: 'var(--border, #ddd)', margin: '0.5rem 0' }} />
            <button
              onClick={() => {
                handleDelete(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                color: isLoading ? 'var(--text-secondary, #999)' : 'var(--danger, #dc3545)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>🗑️</span>
              <span>Supprimer</span>
            </button>
          </div>
        </>
      )}

      {/* Menu contextuel */}
      {contextMenu && (
        <>
          {/* Overlay pour fermer le menu au clic */}
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 999,
            }}
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setContextMenu(null)
            }}
          />
          {/* Menu contextuel */}
          <div
            style={{
              position: 'fixed',
              top: contextMenu.y,
              left: contextMenu.x,
              background: 'var(--bg-primary, white)',
              border: '1px solid var(--border, #ddd)',
              borderRadius: '8px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              zIndex: 1000,
              minWidth: '180px',
              padding: '0.5rem 0',
            }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
          >
            <button
              onClick={() => {
                handleRename(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading || !contextMenu.file.logical_path}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading || !contextMenu.file.logical_path ? 'not-allowed' : 'pointer',
                color: isLoading || !contextMenu.file.logical_path ? 'var(--text-secondary, #999)' : 'var(--text-primary, #333)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading && contextMenu.file.logical_path) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>✏️</span>
              <span>Renommer</span>
            </button>
            <button
              onClick={() => {
                handleDownload(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading || !contextMenu.file.logical_path}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading || !contextMenu.file.logical_path ? 'not-allowed' : 'pointer',
                color: isLoading || !contextMenu.file.logical_path ? 'var(--text-secondary, #999)' : 'var(--text-primary, #333)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading && contextMenu.file.logical_path) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>📥</span>
              <span>Télécharger</span>
            </button>
            <div style={{ height: '1px', background: 'var(--border, #ddd)', margin: '0.5rem 0' }} />
            <button
              onClick={() => {
                handleDelete(contextMenu.file)
                setContextMenu(null)
              }}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                background: 'transparent',
                border: 'none',
                textAlign: 'left',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                color: isLoading ? 'var(--text-secondary, #999)' : 'var(--danger, #dc3545)',
                fontSize: '0.9rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = 'var(--bg-secondary, #f5f5f5)'
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent'
              }}
            >
              <span>🗑️</span>
              <span>Supprimer</span>
            </button>
          </div>
        </>
      )}
      
      {/* Modal de renommage de fichier */}
      {showRenameModal && fileToRename && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            setShowRenameModal(false)
            setFileToRename(null)
            setNewFileName('')
          }}
        >
          <div
            style={{
              background: 'var(--bg-primary, white)',
              padding: '2rem',
              borderRadius: '12px',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.2)',
              width: '90%',
              maxWidth: '400px',
              color: 'var(--text-primary, #333)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem', color: 'var(--text-primary, #333)' }}>
              Renommer le fichier
            </h2>
            <input
              type="text"
              placeholder="Nouveau nom du fichier"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  confirmRename()
                } else if (e.key === 'Escape') {
                  setShowRenameModal(false)
                  setFileToRename(null)
                  setNewFileName('')
                }
              }}
              autoFocus
              style={{
                width: '100%',
                padding: '0.75rem',
                fontSize: '1rem',
                border: '1px solid var(--border, #ddd)',
                borderRadius: '8px',
                marginBottom: '1rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowRenameModal(false)
                  setFileToRename(null)
                  setNewFileName('')
                }}
              >
                Annuler
              </Button>
              <Button variant="primary" onClick={confirmRename} disabled={isLoading || !newFileName.trim()}>
                Renommer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de création de dossier */}
      {showCreateFolderModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCreateFolderModal(false)}
        >
          <div
            style={{
              background: 'var(--bg-primary, white)',
              padding: '2rem',
              borderRadius: '12px',
              minWidth: '400px',
              maxWidth: '90%',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Créer un nouveau dossier</h2>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: '500' }}>
                Nom du dossier
              </label>
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder()
                  } else if (e.key === 'Escape') {
                    setShowCreateFolderModal(false)
                    setNewFolderName('')
                  }
                }}
                placeholder="Nom du dossier"
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  fontSize: '1rem',
                  border: '2px solid var(--border, #ddd)',
                  borderRadius: '8px',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <Button
                variant="secondary"
                onClick={() => {
                  setShowCreateFolderModal(false)
                  setNewFolderName('')
                }}
                disabled={isLoading}
              >
                Annuler
              </Button>
              <Button
                variant="primary"
                onClick={handleCreateFolder}
                loading={isLoading}
                disabled={isLoading || !newFolderName.trim()}
              >
                Créer
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal d'aperçu */}
      {showPreview && previewFile && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 2000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowPreview(false)
              setPreviewFile(null)
              setPreviewData(null)
            }
          }}
        >
          <div
            style={{
              background: 'var(--bg-primary, white)',
              borderRadius: '12px',
              padding: '1.5rem',
              maxWidth: '90vw',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.2rem', fontWeight: '600' }}>
                {previewFile.logical_path?.split('/').pop() || 'Aperçu'}
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {previewFile.logical_path && (
                  <button
                    onClick={() => handleDownload(previewFile)}
                    disabled={isLoading}
                    style={{
                      background: 'var(--primary, #007bff)',
                      color: 'white',
                      border: 'none',
                      padding: '0.5rem 1rem',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      opacity: isLoading ? 0.5 : 1,
                    }}
                  >
                    📥 Télécharger
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowPreview(false)
                    setPreviewFile(null)
                    setPreviewData(null)
                  }}
                  style={{
                    background: 'var(--bg-secondary, #f5f5f5)',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                  }}
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content */}
            <div style={{ overflow: 'auto', maxHeight: 'calc(90vh - 100px)' }}>
              {isLoadingPreview ? (
                <div style={{ textAlign: 'center', padding: '3rem' }}>
                  <div className="spinner" style={{ margin: '0 auto 1rem', width: '40px', height: '40px', border: '4px solid #f3f3f3', borderTop: '4px solid var(--primary, #007bff)', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                  <p>Chargement de l'aperçu...</p>
                </div>
              ) : previewData ? (
                <>
                  {previewData.type === 'image' && (
                    <img
                      src={URL.createObjectURL(new Blob([previewData.data]))}
                      alt={previewFile.logical_path?.split('/').pop() || 'Aperçu'}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '70vh',
                        objectFit: 'contain',
                      }}
                    />
                  )}
                  {previewData.type === 'text' && (
                    <pre
                      style={{
                        background: 'var(--bg-secondary, #f5f5f5)',
                        padding: '1rem',
                        borderRadius: '6px',
                        overflow: 'auto',
                        maxHeight: '70vh',
                        fontSize: '0.9rem',
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordWrap: 'break-word',
                      }}
                    >
                      {new TextDecoder('utf-8').decode(previewData.data)}
                    </pre>
                  )}
                  {previewData.type === 'pdf' && (
                    <iframe
                      src={URL.createObjectURL(new Blob([previewData.data], { type: 'application/pdf' }))}
                      style={{
                        width: '100%',
                        height: '70vh',
                        border: 'none',
                      }}
                      title={previewFile.logical_path?.split('/').pop() || 'PDF'}
                    />
                  )}
                  {previewData.type === 'unsupported' && (
                    <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary, #666)' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
                      <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Aperçu non disponible</p>
                      <p style={{ fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                        Ce type de fichier ne peut pas être prévisualisé.
                      </p>
                      {previewFile.logical_path && (
                        <button
                          onClick={() => handleDownload(previewFile)}
                          disabled={isLoading}
                          style={{
                            background: 'var(--primary, #007bff)',
                            color: 'white',
                            border: 'none',
                            padding: '0.75rem 1.5rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontSize: '1rem',
                            opacity: isLoading ? 0.5 : 1,
                          }}
                        >
                          📥 Télécharger le fichier
                        </button>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary, #666)' }}>
                  <p>Aucune donnée à afficher</p>
                </div>
              )}
            </div>
          </div>
        </div>
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
