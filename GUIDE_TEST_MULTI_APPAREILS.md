# Guide de Test Multi-Appareils - Aether Drive V1

## 🎯 Objectif

Ce guide permet de tester la synchronisation des données entre plusieurs appareils via Wayne (Control Plane) et Storj (Data Plane). L'objectif est de valider que :
- Le MKEK est correctement synchronisé via Wayne
- Les fichiers sont accessibles depuis tous les appareils via Storj
- L'index local SQLCipher est créé/ouvert correctement sur chaque appareil
- Les opérations (upload, download, delete) fonctionnent en multi-appareils

## 📋 Prérequis

1. **Deux appareils** avec Aether Drive installé :
   - Appareil A (ex: MacBook principal)
   - Appareil B (ex: MacBook secondaire ou autre machine)

2. **Un compte Wayne** avec :
   - Email et mot de passe Wayne
   - MKEK déjà créé (bootstrap effectué sur l'Appareil A)

3. **Connexion Internet** sur les deux appareils

4. **Accès au serveur Wayne** : `https://eather.io`

## 🔧 Configuration Initiale

### Étape 1 : Préparer l'Appareil A (Appareil Principal)

1. **Vérifier que l'Appareil A est configuré** :
   ```bash
   # Sur l'Appareil A, vérifier que l'app fonctionne
   cd /Users/nathanpetruzzellis/aether-drive
   npm run tauri dev
   ```

2. **Vérifier la connexion Wayne** :
   - Se connecter à Wayne avec email/mot de passe
   - Vérifier que le MKEK est sauvegardé (bootstrap effectué)
   - Uploader au moins un fichier de test

3. **Noter les informations importantes** :
   - Email Wayne : `_________________`
   - Mot de passe Wayne : `_________________`
   - Nombre de fichiers uploadés : `____`

### Étape 2 : Préparer l'Appareil B (Appareil Secondaire)

1. **Installer Aether Drive sur l'Appareil B** :
   ```bash
   # Sur l'Appareil B, cloner le dépôt (si nécessaire)
   git clone https://github.com/nathanpetruzzellis/aether-drive.git
   cd aether-drive
   npm install
   ```

2. **Configurer l'URL Wayne** :
   - Vérifier que `src/wayne_client.ts` contient : `https://eather.io`
   - Ou modifier dans l'interface si nécessaire

3. **Lancer l'application** :
   ```bash
   npm run tauri dev
   ```

## 🧪 Tests de Synchronisation

### Test 1 : Connexion depuis l'Appareil B

**Objectif** : Vérifier que l'Appareil B peut se connecter à Wayne et récupérer le MKEK.

**Étapes** :
1. Sur l'Appareil B, ouvrir Aether Drive
2. Aller à la page "Login"
3. Entrer l'email et mot de passe Wayne (même compte que l'Appareil A)
4. Cliquer sur "Se connecter"

**Résultat attendu** :
- ✅ Connexion réussie
- ✅ Redirection vers la page "Unlock"
- ✅ Le MKEK est récupéré depuis Wayne automatiquement
- ✅ Aucune erreur de connexion

**Si erreur** :
- Vérifier la connexion Internet
- Vérifier l'URL Wayne dans l'app
- Vérifier les logs dans le terminal

---

### Test 2 : Déverrouillage avec le Mot de Passe Maître

**Objectif** : Vérifier que le mot de passe maître fonctionne sur l'Appareil B.

**Étapes** :
1. Sur l'Appareil B, après connexion Wayne, entrer le mot de passe maître
2. Cliquer sur "Déverrouiller"

**Résultat attendu** :
- ✅ Déverrouillage réussi
- ✅ Redirection vers le Dashboard
- ✅ Configuration Storj automatique (bucket récupéré depuis Wayne)
- ✅ Chargement automatique des fichiers depuis Storj

**Si erreur** :
- Vérifier que le mot de passe maître est correct
- Vérifier les logs : `Erreur lors du déchiffrement du MKEK`
- Si erreur de base de données, utiliser le bouton "Réinitialiser la base locale"

---

### Test 3 : Vérification de la Synchronisation des Fichiers

**Objectif** : Vérifier que les fichiers uploadés sur l'Appareil A sont visibles sur l'Appareil B.

**Étapes** :
1. Sur l'Appareil B, après déverrouillage, observer le tableau des fichiers
2. Comparer avec l'Appareil A

**Résultat attendu** :
- ✅ Tous les fichiers uploadés sur l'Appareil A sont visibles sur l'Appareil B
- ✅ Les métadonnées sont correctes (nom, taille, type)
- ✅ Les icônes de type de fichier sont correctes

**Si fichiers manquants** :
- Vérifier la connexion Storj (logs dans le terminal)
- Vérifier que le bucket Storj est correctement configuré
- Vérifier les logs : `storj_list_files called`

---

### Test 4 : Upload depuis l'Appareil B

**Objectif** : Vérifier qu'un fichier uploadé depuis l'Appareil B est visible sur l'Appareil A.

**Étapes** :
1. Sur l'Appareil B, uploader un nouveau fichier (ex: `test-appareil-b.txt`)
2. Attendre la confirmation d'upload
3. Sur l'Appareil A, recharger les fichiers (ou attendre le chargement automatique)

**Résultat attendu** :
- ✅ Upload réussi sur l'Appareil B
- ✅ Fichier visible dans le tableau sur l'Appareil B
- ✅ Fichier visible sur l'Appareil A après rechargement

**Si fichier non visible** :
- Vérifier les logs Storj sur l'Appareil B
- Vérifier que le fichier est bien dans Storj (via l'API)
- Vérifier la synchronisation de l'index local

---

### Test 5 : Download depuis l'Appareil B

**Objectif** : Vérifier qu'un fichier uploadé sur l'Appareil A peut être téléchargé et déchiffré sur l'Appareil B.

**Étapes** :
1. Sur l'Appareil B, cliquer sur l'icône de téléchargement d'un fichier uploadé sur l'Appareil A
2. Choisir un emplacement de sauvegarde
3. Ouvrir le fichier téléchargé

**Résultat attendu** :
- ✅ Téléchargement réussi
- ✅ Déchiffrement réussi
- ✅ Fichier intact et lisible

**Si erreur** :
- Vérifier que le mot de passe maître est correct (nécessaire pour déchiffrer)
- Vérifier les logs : `storage_decrypt_file`
- Vérifier que le fichier n'est pas corrompu dans Storj

---

### Test 6 : Delete depuis l'Appareil B

**Objectif** : Vérifier qu'une suppression depuis l'Appareil B est reflétée sur l'Appareil A.

**Étapes** :
1. Sur l'Appareil B, supprimer un fichier (icône poubelle)
2. Confirmer la suppression
3. Sur l'Appareil A, recharger les fichiers

**Résultat attendu** :
- ✅ Suppression réussie sur l'Appareil B
- ✅ Fichier supprimé de Storj
- ✅ Fichier supprimé de l'index local sur l'Appareil B
- ✅ Fichier disparu sur l'Appareil A après rechargement

**Si fichier toujours visible** :
- Vérifier que la suppression Storj a bien eu lieu (logs)
- Vérifier la synchronisation de l'index local
- Vérifier que le rechargement sur l'Appareil A fonctionne

---

### Test 7 : Conflit de Base de Données Locale

**Objectif** : Tester la gestion des conflits si l'index local de l'Appareil B ne correspond pas au MKEK.

**Étapes** :
1. Sur l'Appareil B, supprimer manuellement la base de données locale :
   ```bash
   # Sur macOS
   rm ~/Library/Application\ Support/com.tauri.dev/index.db
   ```
2. Redémarrer l'app sur l'Appareil B
3. Se reconnecter et déverrouiller

**Résultat attendu** :
- ✅ L'app détecte l'absence de base de données
- ✅ Une nouvelle base est créée avec le MKEK récupéré depuis Wayne
- ✅ Les fichiers sont rechargés depuis Storj
- ✅ L'index local est reconstruit

**Si erreur** :
- Utiliser le bouton "Réinitialiser la base locale" dans l'interface
- Vérifier les logs : `reset_local_database`

---

### Test 8 : Changement de Mot de Passe Maître Multi-Appareils

**Objectif** : Vérifier qu'un changement de mot de passe maître sur l'Appareil A fonctionne sur l'Appareil B.

**Étapes** :
1. Sur l'Appareil A, changer le mot de passe maître (Settings → Changer le mot de passe maître)
2. Noter le nouveau mot de passe maître
3. Sur l'Appareil B, se déconnecter puis se reconnecter
4. Déverrouiller avec le nouveau mot de passe maître

**Résultat attendu** :
- ✅ Changement réussi sur l'Appareil A
- ✅ MKEK mis à jour sur Wayne
- ✅ Déverrouillage réussi sur l'Appareil B avec le nouveau mot de passe
- ✅ Accès aux fichiers préservé

**Si erreur** :
- Vérifier que le nouveau MKEK est bien sauvegardé sur Wayne
- Vérifier que l'ancien mot de passe ne fonctionne plus
- Vérifier les logs : `crypto_change_password`

---

## 📊 Checklist de Validation

Cochez chaque test après validation :

- [ ] **Test 1** : Connexion depuis l'Appareil B
- [ ] **Test 2** : Déverrouillage avec le Mot de Passe Maître
- [ ] **Test 3** : Vérification de la Synchronisation des Fichiers
- [ ] **Test 4** : Upload depuis l'Appareil B
- [ ] **Test 5** : Download depuis l'Appareil B
- [ ] **Test 6** : Delete depuis l'Appareil B
- [ ] **Test 7** : Conflit de Base de Données Locale
- [ ] **Test 8** : Changement de Mot de Passe Maître Multi-Appareils

## 🔍 Dépannage

### Problème : "Erreur lors de la récupération de la configuration Storj"

**Solution** :
1. Vérifier que le bucket Storj existe sur Wayne :
   ```bash
   ssh -i ~/.ssh/id_ed25519_wayne root@72.62.59.152
   sudo -u postgres psql -d wayne_db -c "SELECT id, user_id, bucket_name FROM storj_buckets;"
   ```
2. Vérifier les permissions PostgreSQL
3. Vérifier les logs Wayne : `journalctl -u wayne -f`

### Problème : "Fichiers non synchronisés"

**Solution** :
1. Vérifier que Storj est bien configuré sur les deux appareils
2. Vérifier les logs Storj : `storj_list_files called`
3. Vérifier que le bucket est le même sur les deux appareils

### Problème : "Erreur de déchiffrement"

**Solution** :
1. Vérifier que le mot de passe maître est correct
2. Vérifier que le MKEK est bien récupéré depuis Wayne
3. Utiliser le bouton "Réinitialiser la base locale" si nécessaire

## 📝 Notes Importantes

1. **MKEK Centralisé** : Le MKEK est stocké sur Wayne, donc accessible depuis tous les appareils avec le même compte.

2. **Index Local** : Chaque appareil a son propre index SQLCipher local, mais il est synchronisé avec Storj au chargement.

3. **Storj Partagé** : Tous les appareils du même utilisateur accèdent au même bucket Storj.

4. **Mot de Passe Maître** : Le même mot de passe maître doit être utilisé sur tous les appareils pour déverrouiller le coffre.

5. **Sécurité** : La MasterKey ne quitte jamais l'appareil en clair. Seul le MKEK (chiffré) est stocké sur Wayne.

## ✅ Validation Finale

Une fois tous les tests validés, l'architecture multi-appareils est fonctionnelle. Les utilisateurs peuvent :
- Se connecter depuis plusieurs appareils
- Accéder à leurs fichiers depuis n'importe quel appareil
- Uploader, télécharger et supprimer des fichiers depuis n'importe quel appareil
- Changer leur mot de passe maître sans perdre l'accès aux données

---

**Date de création** : 2025-12-06  
**Version** : 1.0  
**Auteur** : Aether Drive Team

