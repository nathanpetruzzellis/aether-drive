import { Router, Request, Response } from 'express';
import { UserModel } from '../models/User';
import { generateAccessToken } from '../utils/jwt';
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
    const { email, password } = req.body;
    
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
    
    res.status(201).json({
      user_id: user.id,
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
    const { email, password } = req.body;
    
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
    
    // TODO: Implémenter refresh token si nécessaire
    const refreshToken = 'not_implemented_yet';
    
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

export default router;

