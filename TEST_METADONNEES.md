# Guide de Test : Métadonnées Anonymisées sur Wayne

## Prérequis
- Application Aether Drive lancée (`npm run tauri dev`)
- Compte Wayne créé et connecté
- Storj configuré automatiquement

## Tests à Effectuer

### 1. Test de l'Upload avec Synchronisation des Métadonnées

**Actions :**
1. Lance l'application
2. Connecte-toi à Wayne
3. Upload un fichier (image, document, etc.)
4. Observe les messages de progression
5. Vérifie que les statistiques s'affichent dans le header

**Résultats attendus :**
- ✅ Message "📤 Préparation de [fichier]..."
- ✅ Message "🔐 Chiffrement de [fichier]..."
- ✅ Message "☁️ Upload de [fichier] vers Storj..."
- ✅ Message "✅ Fichier [fichier] uploadé avec succès"
- ✅ Statistiques mises à jour dans le header (nombre de fichiers, espace utilisé)

### 2. Test des Statistiques

**Actions :**
1. Upload plusieurs fichiers de types différents (image, document, vidéo)
2. Observe les statistiques dans le header du Dashboard

**Résultats attendus :**
- ✅ Nombre total de fichiers affiché
- ✅ Espace total utilisé affiché
- ✅ Statistiques mises à jour après chaque upload

### 3. Test de la Suppression avec Synchronisation des Métadonnées

**Actions :**
1. Supprime un fichier via l'icône 🗑️
2. Confirme la suppression
3. Observe les messages
4. Vérifie que les statistiques sont mises à jour

**Résultats attendus :**
- ✅ Message "🗑️ Suppression de [fichier]..."
- ✅ Message "✅ Fichier [fichier] supprimé avec succès"
- ✅ Statistiques mises à jour (nombre de fichiers et espace réduits)

### 4. Test de la Récupération des Métadonnées (Vérification Serveur)

**Actions :**
1. Upload quelques fichiers
2. Vérifie sur le serveur que les métadonnées sont bien stockées

**Commande serveur :**
```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152
sudo -u postgres psql -d wayne_db -c "SELECT file_uuid, encrypted_size, file_type, created_at FROM file_metadata ORDER BY created_at DESC LIMIT 5;"
```

**Résultats attendus :**
- ✅ Métadonnées présentes dans la base de données
- ✅ `file_uuid` au format UUID standard (avec tirets)
- ✅ `encrypted_size` correspondant à la taille chiffrée
- ✅ `file_type` correspondant au type de fichier (images, documents, etc.)

### 5. Test des Statistiques via API

**Actions :**
1. Vérifie que l'API retourne les bonnes statistiques

**Commande serveur :**
```bash
# Récupère l'access token depuis l'application (dans la console du navigateur)
# Puis teste l'API :
curl -H "Authorization: Bearer [TON_TOKEN]" https://eather.io/api/v1/file-metadata/stats
```

**Résultats attendus :**
- ✅ Réponse JSON avec `total_files`, `total_size`, `files_by_type`
- ✅ Valeurs cohérentes avec les fichiers uploadés

### 6. Test de Non-Régression

**Actions :**
1. Vérifie que toutes les fonctionnalités précédentes fonctionnent toujours :
   - Recherche de fichiers
   - Tri des fichiers
   - Filtrage par type
   - Téléchargement de fichiers
   - Chiffrement/déchiffrement

**Résultats attendus :**
- ✅ Toutes les fonctionnalités fonctionnent normalement
- ✅ Pas de régression introduite

## Points de Vérification

### Console Navigateur (F12)
- ✅ Pas d'erreurs JavaScript
- ✅ Messages de warning acceptables (métadonnées non bloquantes)

### Console Serveur
```bash
ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152
journalctl -u wayne -f
```
- ✅ Pas d'erreurs critiques
- ✅ Requêtes API réussies (200, 201)

### Base de Données
- ✅ Métadonnées synchronisées après upload
- ✅ Métadonnées supprimées après suppression
- ✅ Statistiques calculées correctement

## En Cas de Problème

### Métadonnées non sauvegardées
- Vérifie que tu es bien connecté à Wayne
- Vérifie la console navigateur pour les erreurs
- Vérifie les logs serveur

### Statistiques incorrectes
- Vérifie que les métadonnées sont bien dans la base de données
- Recharge la page pour forcer le rechargement des statistiques

### Erreurs serveur
- Vérifie que la migration a bien été appliquée
- Vérifie que le serveur est bien redémarré
- Vérifie les logs : `journalctl -u wayne -n 50`

