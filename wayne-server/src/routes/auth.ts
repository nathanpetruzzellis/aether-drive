import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { UserModel } from '../models/User';
import { generateAccessToken } from '../utils/jwt';
import { RefreshTokenModel } from '../models/RefreshToken';
import { KeyEnvelopeModel } from '../models/KeyEnvelope';
import { StorjService } from '../services/storj';
import { StorjBucketModel } from '../models/StorjBucket';
import crypto from 'crypto';

const storjService = new StorjService();

/**
 * Chiffre les credentials Storj avec une clé dérivée du mot de passe Wayne.
 */
function encryptStorjCredentials(accessKeyId: string, secretAccessKey: string): {
  access_key_id_encrypted: Buffer;
  secret_access_key_encrypted: Buffer;
} {
  const encryptionKey = process.env.STORJ_ENCRYPTION_KEY || 'change_this_in_production';
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);

  function encrypt(text: string): Buffer {
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(encryptionKey.slice(0, 32), 'utf8'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
  }

  return {
    access_key_id_encrypted: encrypt(accessKeyId),
    secret_access_key_encrypted: encrypt(secretAccessKey),
  };
}

const router = Router();

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, remember_me } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email et mot de passe requis',
      });
    }
    
    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Le mot de passe doit contenir au moins 8 caractères',
      });
    }
    
    // Vérifie si l'utilisateur existe déjà
    const existingUser = await UserModel.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Un utilisateur avec cet email existe déjà',
      });
    }
    
    // Crée l'utilisateur
    const user = await UserModel.create({ email, password });
    
    // Crée automatiquement un bucket Storj pour l'utilisateur
    try {
      const storjConfig = await storjService.createUserBucket(user.id);
      const encrypted = encryptStorjCredentials(
        storjConfig.access_key_id,
        storjConfig.secret_access_key
      );
      
      await StorjBucketModel.create({
        user_id: user.id,
        bucket_name: storjConfig.bucket_name,
        access_key_id_encrypted: Array.from(encrypted.access_key_id_encrypted),
        secret_access_key_encrypted: Array.from(encrypted.secret_access_key_encrypted),
        endpoint: storjConfig.endpoint,
      });
      
      console.log(`✅ Bucket Storj créé automatiquement pour l'utilisateur ${user.id}`);
    } catch (storjError) {
      // Log l'erreur mais ne bloque pas l'inscription
      console.error(`⚠️ Erreur lors de la création du bucket Storj pour ${user.id}:`, storjError);
      // L'utilisateur peut toujours utiliser l'application en mode local
    }
    
    // Génère un access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    
    // Crée un refresh token uniquement si remember_me est true
    let refreshToken: string | null = null;
    if (remember_me === true) {
      const { token } = await RefreshTokenModel.create({
        user_id: user.id,
        expires_in_days: 30,
      });
      refreshToken = token;
    }
    
    res.status(201).json({
      user_id: user.id,
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 7 * 24 * 60 * 60, // 7 jours en secondes
      message: 'Compte créé avec succès',
    });
  } catch (error) {
    console.error('Erreur lors de l\'inscription:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la création du compte',
    });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, remember_me } = req.body;
    
    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email et mot de passe requis',
      });
    }
    
    // Trouve l'utilisateur
    const user = await UserModel.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Email ou mot de passe incorrect',
      });
    }
    
    // Vérifie le mot de passe
    const isValid = await UserModel.verifyPassword(user, password);
    if (!isValid) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Email ou mot de passe incorrect',
      });
    }
    
    // Génère le token JWT
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    
    // Crée un refresh token uniquement si remember_me est true
    let refreshToken: string | null = null;
    if (remember_me === true) {
      const { token } = await RefreshTokenModel.create({
        user_id: user.id,
        expires_in_days: 30,
      });
      refreshToken = token;
    }
    
    res.json({
      access_token: accessToken,
      refresh_token: refreshToken,
      user_id: user.id,
      expires_in: 7 * 24 * 60 * 60, // 7 jours en secondes
    });
  } catch (error) {
    console.error('Erreur lors de la connexion:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la connexion',
    });
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    
    // Validation
    if (!refresh_token) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token requis',
      });
    }
    
    // Trouve et vérifie le refresh token
    const refreshTokenRecord = await RefreshTokenModel.findByToken(refresh_token);
    if (!refreshTokenRecord) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Refresh token invalide ou expiré',
      });
    }
    
    // Récupère l'utilisateur
    const user = await UserModel.findById(refreshTokenRecord.user_id);
    if (!user) {
      // Token orphelin, on le supprime
      await RefreshTokenModel.revoke(refreshTokenRecord.id);
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Utilisateur introuvable',
      });
    }
    
    // Génère un nouveau access token
    const accessToken = generateAccessToken({
      userId: user.id,
      email: user.email,
    });
    
    res.json({
      access_token: accessToken,
      expires_in: 7 * 24 * 60 * 60, // 7 jours en secondes
    });
  } catch (error) {
    console.error('Erreur lors du rafraîchissement du token:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors du rafraîchissement du token',
    });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const { refresh_token } = req.body;
    
    if (refresh_token) {
      // Révoque le refresh token spécifique
      const refreshTokenRecord = await RefreshTokenModel.findByToken(refresh_token);
      if (refreshTokenRecord) {
        await RefreshTokenModel.revoke(refreshTokenRecord.id);
      }
    }
    
    res.json({
      message: 'Déconnexion réussie',
    });
  } catch (error) {
    console.error('Erreur lors de la déconnexion:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la déconnexion',
    });
  }
});

// POST /api/v1/auth/change-password
// Nécessite une authentification
// Supporte deux modes :
// - change_wayne_password: Change uniquement le mot de passe Wayne (ne touche pas au MKEK)
// - change_master_password: Change le mot de passe maître (met à jour le MKEK)
router.post('/change-password', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { old_password, new_password, new_password_salt, new_mkek, password_type } = req.body;
    
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }
    
    // Récupère l'utilisateur
    const user = await UserModel.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Utilisateur introuvable',
      });
    }
    
    // Mode 1 : Changement du mot de passe Wayne uniquement (ne touche pas au MKEK)
    if (password_type === 'wayne' || (!password_type && !new_password_salt && !new_mkek)) {
      // Validation pour le mode Wayne
      if (!old_password || !new_password) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Ancien et nouveau mot de passe requis',
        });
      }
      
      if (new_password.length < 8) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Le nouveau mot de passe doit contenir au moins 8 caractères',
        });
      }
      
      // Vérifie l'ancien mot de passe Wayne
      const isValid = await UserModel.verifyPassword(user, old_password);
      if (!isValid) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Ancien mot de passe incorrect',
        });
      }
      // Met à jour uniquement le mot de passe Wayne
      await UserModel.updatePassword(user.id, new_password);
      
      // Révoque tous les refresh tokens pour forcer une nouvelle connexion
      await RefreshTokenModel.revokeAllForUser(user.id);
      
      res.json({
        message: 'Mot de passe Wayne changé avec succès. Tu devras te reconnecter.',
      });
      return;
    }
    
    // Mode 2 : Changement du mot de passe maître (met à jour le MKEK)
    // Note: La vérification de l'ancien mot de passe maître se fait côté client
    // en déchiffrant le MKEK. L'API fait confiance au client pour cette vérification.
    if (password_type === 'master') {
      // Validation du nouveau MKEK
      if (!new_password_salt || !new_mkek || !new_mkek.nonce || !new_mkek.payload) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Nouveau MKEK requis pour changer le mot de passe maître (password_salt, mkek.nonce, mkek.payload)',
        });
      }
      
      // Vérifie que l'utilisateur est authentifié (via le token)
      // La vérification de l'ancien mot de passe maître se fait côté client
      // en déchiffrant le MKEK avec l'ancien mot de passe maître
      
      // Met à jour uniquement l'enveloppe MKEK (ne change PAS le mot de passe Wayne)
      await KeyEnvelopeModel.upsert({
        user_id: user.id,
        version: 1,
        password_salt: new_password_salt,
        mkek_nonce: new_mkek.nonce,
        mkek_payload: new_mkek.payload,
      });
      
      res.json({
        message: 'Mot de passe maître changé avec succès. Le MKEK a été mis à jour.',
      });
      return;
    }
    
    // Cas par défaut : erreur
    return res.status(400).json({
      error: 'Bad Request',
      message: 'Type de changement de mot de passe non spécifié (password_type: "wayne" ou "master")',
    });
  } catch (error) {
    console.error('Erreur lors du changement de mot de passe:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors du changement de mot de passe',
    });
  }
});

export default router;

