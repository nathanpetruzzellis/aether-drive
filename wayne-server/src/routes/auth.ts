import { Router, Request, Response } from 'express';
import { UserModel } from '../models/User';
import { generateAccessToken } from '../utils/jwt';

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

