# Guide de Test Complet - Refresh Tokens

## 🎯 Objectif
Tester l'implémentation complète des Refresh Tokens de A à Z.

---

## 📋 Étape 1 : Déploiement sur le Serveur

### Option A : Script Automatique (Recommandé)

```bash
cd /Users/nathanpetruzzellis/aether-drive
./test-refresh-tokens.sh
```

### Option B : Commandes Manuelles

#### 1.1 Transfert des fichiers

```bash
# Transfert du modèle RefreshToken
scp -i ~/.ssh/id_ed25519_wayne \
  wayne-server/src/models/RefreshToken.ts \
  root@72.62.59.152:/opt/wayne-server/src/models/

# Transfert des routes auth modifiées
scp -i ~/.ssh/id_ed25519_wayne \
  wayne-server/src/routes/auth.ts \
  root@72.62.59.152:/opt/wayne-server/src/routes/
```

#### 1.2 Compilation sur le serveur

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 << 'EOF'
cd /opt/wayne-server
npm install
npm run build
EOF
```

#### 1.3 Redémarrage du service

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 << 'EOF'
systemctl stop wayne
systemctl start wayne
sleep 2
systemctl status wayne --no-pager -l | head -15
EOF
```

#### 1.4 Vérification des logs

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 \
  "journalctl -u wayne -n 30 --no-pager"
```

---

## 📱 Étape 2 : Test dans l'Application React

### 2.1 Lancer l'application

```bash
cd /Users/nathanpetruzzellis/aether-drive
npm run tauri dev
```

### 2.2 Test de Connexion et Stockage du Refresh Token

1. **Ouvre l'application** dans la fenêtre Tauri
2. **Connecte-toi à Wayne** :
   - URL : `https://eather.io`
   - Email : Ton email
   - Mot de passe : Ton mot de passe
3. **Vérifie dans la console du navigateur** (F12) :
   ```javascript
   localStorage.getItem('wayne_refresh_token')
   ```
   → Doit retourner un token (longue chaîne hexadécimale)

### 2.3 Test de Restauration Automatique de Session

1. **Ferme complètement l'application** (Cmd+Q sur macOS)
2. **Rouvre l'application**
3. **Vérifie** :
   - L'application doit automatiquement restaurer ta session Wayne
   - Tu ne dois **PAS** avoir besoin de te reconnecter
   - Tu dois pouvoir accéder directement à la page "Unlock"

### 2.4 Test de Déconnexion et Révocation

1. **Déconnecte-toi** depuis le Dashboard
2. **Vérifie dans la console** :
   ```javascript
   localStorage.getItem('wayne_refresh_token')
   ```
   → Doit retourner `null` (token supprimé)

---

## 🧪 Étape 3 : Test des Endpoints API

### 3.1 Obtenir un Refresh Token

**Via l'application React** (voir étape 2.2) ou **via curl** :

```bash
# Connexion pour obtenir un refresh_token
curl -X POST https://eather.io/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{
    "email": "ton_email@example.com",
    "password": "ton_mot_de_passe"
  }' | jq '.refresh_token'
```

Copie le `refresh_token` retourné.

### 3.2 Test de l'Endpoint /refresh

```bash
# Remplace REFRESH_TOKEN par le token obtenu à l'étape 3.1
REFRESH_TOKEN="ton_refresh_token_ici"

curl -X POST https://eather.io/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}" | jq '.'
```

**Résultat attendu** :
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 604800
}
```

### 3.3 Test de l'Endpoint /logout

```bash
curl -X POST https://eather.io/api/v1/auth/logout \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}" | jq '.'
```

**Résultat attendu** :
```json
{
  "message": "Déconnexion réussie"
}
```

### 3.4 Vérification de la Révocation

```bash
# Tente de rafraîchir avec le token révoqué
curl -X POST https://eather.io/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}" | jq '.'
```

**Résultat attendu** :
```json
{
  "error": "Unauthorized",
  "message": "Refresh token invalide ou expiré"
}
```

### 3.5 Script de Test Automatique

```bash
# Utilise le script de test manuel
./test-refresh-manual.sh "TON_REFRESH_TOKEN_ICI"
```

---

## 🔍 Étape 4 : Vérifications Serveur

### 4.1 Vérifier les Refresh Tokens en Base de Données

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 << 'EOF'
sudo -u postgres psql -d wayne_db -c "
SELECT 
  id,
  user_id,
  expires_at,
  created_at,
  expires_at > NOW() as is_valid
FROM refresh_tokens
ORDER BY created_at DESC
LIMIT 5;
"
EOF
```

### 4.2 Vérifier les Logs du Serveur

```bash
# Logs en temps réel
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 \
  "journalctl -u wayne -f"

# Ou logs récents
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 \
  "journalctl -u wayne -n 50 --no-pager | grep -i 'refresh\|token\|login\|logout'"
```

---

## ✅ Checklist de Validation

- [ ] **Déploiement** : Serveur compilé et redémarré sans erreur
- [ ] **Connexion** : Refresh token stocké dans localStorage après login
- [ ] **Restauration** : Session restaurée automatiquement au redémarrage de l'app
- [ ] **Endpoint /refresh** : Retourne un nouvel access_token valide
- [ ] **Endpoint /logout** : Révoque le refresh token
- [ ] **Révocation** : Refresh token révoqué ne fonctionne plus
- [ ] **Base de données** : Refresh tokens stockés et hashés correctement
- [ ] **Logs serveur** : Aucune erreur dans les logs

---

## 🐛 Dépannage

### Problème : "Refresh token invalide ou expiré"

**Solutions** :
1. Vérifie que le token n'a pas été révoqué (logout)
2. Vérifie que le token n'a pas expiré (30 jours)
3. Vérifie dans la base de données que le token existe

### Problème : Session non restaurée au démarrage

**Solutions** :
1. Vérifie dans la console : `localStorage.getItem('wayne_refresh_token')`
2. Vérifie les logs de l'app (console navigateur)
3. Vérifie que `restoreSession()` est appelé dans `App.tsx`

### Problème : Erreur de compilation TypeScript

**Solutions** :
1. Vérifie que tous les fichiers sont transférés
2. Vérifie les dépendances : `npm install` sur le serveur
3. Vérifie les logs de compilation : `npm run build`

---

## 📚 Commandes Utiles

### Vérifier le statut du service

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 \
  "systemctl status wayne"
```

### Redémarrer le service

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 \
  "systemctl restart wayne"
```

### Nettoyer les tokens expirés (manuellement)

```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152 << 'EOF'
sudo -u postgres psql -d wayne_db -c "
DELETE FROM refresh_tokens WHERE expires_at <= NOW();
SELECT COUNT(*) as deleted_count FROM refresh_tokens WHERE expires_at <= NOW();
"
EOF
```

---

## 🎉 Résultat Attendu

Après tous ces tests, tu devrais avoir :
- ✅ Une session qui persiste après redémarrage de l'app
- ✅ Des refresh tokens sécurisés (hashés) en base de données
- ✅ Une déconnexion qui révoque proprement les tokens
- ✅ Un système de refresh automatique fonctionnel

