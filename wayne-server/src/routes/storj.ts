import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middleware/auth';
import { StorjBucketModel } from '../models/StorjBucket';
import { StorjService } from '../services/storj';
import crypto from 'crypto';

const router = Router();
const storjService = new StorjService();

// Middleware d'authentification pour toutes les routes
router.use(authenticateToken);

/**
 * Chiffre les credentials Storj avec une clé dérivée du mot de passe Wayne.
 * Pour V1, on utilise un chiffrement simple avec une clé maître (à améliorer en production).
 */
function encryptStorjCredentials(accessKeyId: string, secretAccessKey: string): {
  access_key_id_encrypted: Buffer;
  secret_access_key_encrypted: Buffer;
} {
  // TODO: Utiliser une clé dérivée du mot de passe Wayne pour chiffrer
  // Pour V1, on utilise une clé maître depuis les variables d'environnement
  const encryptionKey = process.env.STORJ_ENCRYPTION_KEY || 'change_this_in_production';
  const algorithm = 'aes-256-gcm';
  const iv = crypto.randomBytes(16);

  function encrypt(text: string): Buffer {
    const cipher = crypto.createCipheriv(algorithm, Buffer.from(encryptionKey.slice(0, 32), 'utf8'), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    // Combine IV + authTag + encrypted data
    return Buffer.concat([iv, authTag, Buffer.from(encrypted, 'hex')]);
  }

  return {
    access_key_id_encrypted: encrypt(accessKeyId),
    secret_access_key_encrypted: encrypt(secretAccessKey),
  };
}

/**
 * Déchiffre les credentials Storj.
 */
function decryptStorjCredentials(
  access_key_id_encrypted: Buffer,
  secret_access_key_encrypted: Buffer
): {
  access_key_id: string;
  secret_access_key: string;
} {
  const encryptionKey = process.env.STORJ_ENCRYPTION_KEY || 'change_this_in_production';
  const algorithm = 'aes-256-gcm';

  function decrypt(encrypted: Buffer): string {
    const iv = encrypted.slice(0, 16);
    const authTag = encrypted.slice(16, 32);
    const ciphertext = encrypted.slice(32);
    
    const decipher = crypto.createDecipheriv(algorithm, Buffer.from(encryptionKey.slice(0, 32), 'utf8'), iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  return {
    access_key_id: decrypt(access_key_id_encrypted),
    secret_access_key: decrypt(secret_access_key_encrypted),
  };
}

// POST /api/v1/storj-config/create
// Crée automatiquement un bucket Storj pour l'utilisateur connecté
router.post('/create', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }

    const userId = req.user.userId;

    // Vérifie si un bucket existe déjà
    const existingBucket = await StorjBucketModel.findByUserId(userId);
    if (existingBucket) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Un bucket Storj existe déjà pour cet utilisateur',
      });
    }

    // Crée le bucket Storj
    const storjConfig = await storjService.createUserBucket(userId);

    // Chiffre les credentials
    const encrypted = encryptStorjCredentials(
      storjConfig.access_key_id,
      storjConfig.secret_access_key
    );

    // Sauvegarde dans la base de données
    const bucket = await StorjBucketModel.create({
      user_id: userId,
      bucket_name: storjConfig.bucket_name,
      access_key_id_encrypted: Array.from(encrypted.access_key_id_encrypted),
      secret_access_key_encrypted: Array.from(encrypted.secret_access_key_encrypted),
      endpoint: storjConfig.endpoint,
    });

    res.status(201).json({
      bucket_id: bucket.id,
      bucket_name: bucket.bucket_name,
      endpoint: bucket.endpoint,
      message: 'Bucket Storj créé avec succès',
    });
  } catch (error) {
    console.error('Erreur lors de la création du bucket Storj:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la création du bucket Storj',
    });
  }
});

// GET /api/v1/storj-config/me
// Récupère la configuration Storj de l'utilisateur connecté (credentials déchiffrés)
router.get('/me', async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentification requise',
      });
    }

    const userId = req.user.userId;

    // Récupère le bucket Storj
    const bucket = await StorjBucketModel.findByUserId(userId);
    if (!bucket) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Aucun bucket Storj trouvé pour cet utilisateur',
      });
    }

    // Déchiffre les credentials
    const decrypted = decryptStorjCredentials(
      bucket.access_key_id_encrypted,
      bucket.secret_access_key_encrypted
    );

    res.json({
      bucket_id: bucket.id,
      bucket_name: bucket.bucket_name,
      access_key_id: decrypted.access_key_id,
      secret_access_key: decrypted.secret_access_key,
      endpoint: bucket.endpoint,
    });
  } catch (error) {
    console.error('Erreur lors de la récupération de la config Storj:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Erreur lors de la récupération de la configuration Storj',
    });
  }
});

export default router;

