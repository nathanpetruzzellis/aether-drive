import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { KeyEnvelopeModel } from '../models/KeyEnvelope';

const router = Router();

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);

// POST /api/v1/key-envelopes
router.post('/', async (req: Request, res: Response) => {
  try {
    const { envelope } = req.body;
    
    // Validation
    if (!envelope) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Enveloppe de clés requise',
      });
    }
    
    if (!envelope.version || !envelope.password_salt || !envelope.mkek) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Format d\'enveloppe invalide',
      });
    }
    
    if (!envelope.mkek.nonce || !envelope.mkek.payload) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Format MKEK invalide',
      });
    }
    
    // Vérifie que l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }
    
    // Crée ou met à jour l'enveloppe de clés
    const keyEnvelope = await KeyEnvelopeModel.upsert({
      user_id: req.user.userId,
      version: envelope.version,
      password_salt: envelope.password_salt,
      mkek_nonce: envelope.mkek.nonce,
      mkek_payload: envelope.mkek.payload,
    });
    
    res.status(201).json({
      envelope_id: keyEnvelope.id,
    });
  } catch (error) {
    console.error('Erreur lors de la sauvegarde de l\'enveloppe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la sauvegarde de l\'enveloppe de clés',
    });
  }
});

// GET /api/v1/key-envelopes/me
router.get('/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }
    
    // Récupère l'enveloppe de clés de l'utilisateur
    const keyEnvelope = await KeyEnvelopeModel.findByUserId(req.user.userId);
    
    if (!keyEnvelope) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Aucune enveloppe de clés trouvée pour cet utilisateur',
      });
    }
    
    // Convertit les Buffer en tableaux de nombres pour la réponse JSON
    res.json({
      envelope: {
        version: keyEnvelope.version,
        password_salt: Array.from(keyEnvelope.password_salt),
        mkek: {
          nonce: Array.from(keyEnvelope.mkek_nonce),
          payload: Array.from(keyEnvelope.mkek_payload),
        },
      },
      envelope_id: keyEnvelope.id,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'enveloppe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération de l\'enveloppe de clés',
    });
  }
});

// GET /api/v1/key-envelopes/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }
    
    // Récupère l'enveloppe de clés par ID
    const keyEnvelope = await KeyEnvelopeModel.findById(id);
    
    if (!keyEnvelope) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Enveloppe de clés non trouvée',
      });
    }
    
    // Vérifie que l'enveloppe appartient à l'utilisateur
    if (keyEnvelope.user_id !== req.user.userId) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Accès refusé à cette enveloppe de clés',
      });
    }
    
    // Convertit les Buffer en tableaux de nombres pour la réponse JSON
    res.json({
      envelope: {
        version: keyEnvelope.version,
        password_salt: Array.from(keyEnvelope.password_salt),
        mkek: {
          nonce: Array.from(keyEnvelope.mkek_nonce),
          payload: Array.from(keyEnvelope.mkek_payload),
        },
      },
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de l\'enveloppe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération de l\'enveloppe de clés',
    });
  }
});

export default router;

