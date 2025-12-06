import { Router, Request, Response } from 'express'
import { authenticateToken } from '../middleware/auth'
import { FileMetadataModel } from '../models/FileMetadata'

const router = Router()
const fileMetadataModel = new FileMetadataModel()

// Toutes les routes nécessitent une authentification
router.use(authenticateToken)

// POST /api/v1/file-metadata
// Crée ou met à jour une métadonnée de fichier
router.post('/', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      })
    }

    const { file_uuid, encrypted_size, file_type } = req.body

    // Validation
    if (!file_uuid || encrypted_size === undefined) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'file_uuid et encrypted_size sont requis',
      })
    }

    if (typeof encrypted_size !== 'number' || encrypted_size < 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'encrypted_size doit être un nombre positif',
      })
    }

    // Crée ou met à jour la métadonnée
    const metadata = await fileMetadataModel.upsert({
      user_id: req.user.userId,
      file_uuid: String(file_uuid),
      encrypted_size: encrypted_size,
      file_type: file_type || null,
    })

    res.status(201).json({
      metadata: {
        id: metadata.id,
        file_uuid: metadata.file_uuid,
        encrypted_size: metadata.encrypted_size,
        file_type: metadata.file_type,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
      },
    })
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de la métadonnée:', error)
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la sauvegarde de la métadonnée',
    })
  }
})

// GET /api/v1/file-metadata
// Récupère toutes les métadonnées de l'utilisateur
router.get('/', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      })
    }

    const metadataList = await fileMetadataModel.findByUserId(req.user.userId)

    res.json({
      metadata: metadataList.map(m => ({
        id: m.id,
        file_uuid: m.file_uuid,
        encrypted_size: m.encrypted_size,
        file_type: m.file_type,
        created_at: m.created_at,
        updated_at: m.updated_at,
      })),
    })
  } catch (error) {
    console.error('Erreur lors de la récupération des métadonnées:', error)
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération des métadonnées',
    })
  }
})

// GET /api/v1/file-metadata/stats
// Récupère les statistiques de l'utilisateur
router.get('/stats', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      })
    }

    const stats = await fileMetadataModel.getUserStats(req.user.userId)

    res.json({
      stats: {
        total_files: stats.total_files,
        total_size: stats.total_size,
        files_by_type: stats.files_by_type,
      },
    })
  } catch (error) {
    console.error('Erreur lors de la récupération des statistiques:', error)
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération des statistiques',
    })
  }
})

// GET /api/v1/file-metadata/:file_uuid
// Récupère une métadonnée spécifique par UUID
router.get('/:file_uuid', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      })
    }

    const { file_uuid } = req.params
    const metadata = await fileMetadataModel.findByFileUuid(req.user.userId, file_uuid)

    if (!metadata) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Métadonnée non trouvée',
      })
    }

    res.json({
      metadata: {
        id: metadata.id,
        file_uuid: metadata.file_uuid,
        encrypted_size: metadata.encrypted_size,
        file_type: metadata.file_type,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
      },
    })
  } catch (error) {
    console.error('Erreur lors de la récupération de la métadonnée:', error)
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération de la métadonnée',
    })
  }
})

// DELETE /api/v1/file-metadata/:file_uuid
// Supprime une métadonnée de fichier
router.delete('/:file_uuid', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      })
    }

    const { file_uuid } = req.params
    const deleted = await fileMetadataModel.delete(req.user.userId, file_uuid)

    if (!deleted) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Métadonnée non trouvée',
      })
    }

    res.json({
      message: 'Métadonnée supprimée avec succès',
    })
  } catch (error) {
    console.error('Erreur lors de la suppression de la métadonnée:', error)
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la suppression de la métadonnée',
    })
  }
})

export default router

