# Plan de Test Intégral - Aether Drive V1

## Objectif
Valider complètement la Phase 1 (Crypto Core + Index + Storage) et la Phase 2 (Intégration Storj) avec un test end-to-end.

---

## 🧪 TEST INTÉGRAL COMPLET

### Prérequis
1. **Nettoyer l'environnement** (optionnel mais recommandé) :
   - Supprimer le fichier `index.db` si tu veux repartir de zéro
   - Localisation : `~/Library/Application Support/com.tauri.dev/index.db`
   - OU simplement utiliser un nouveau mot de passe maître

2. **Storj configuré** :
   - Access Key ID
   - Secret Access Key
   - Endpoint (ex: `https://gateway.storjshare.io`)
   - Bucket Name

---

## 📋 PHASE 1 : CRYPTO CORE + INDEX + STORAGE

### Test 1.1 : Bootstrap (Initialisation du coffre)
- [ ] Saisir un nouveau mot de passe maître
- [ ] Cliquer sur "Initialiser le coffre (bootstrap)"
- [ ] **Vérifier** : Message de succès affiché
- [ ] **Vérifier** : État passe à "unlocked"
- [ ] **Vérifier** : Les sections "Gestion de l'index SQLCipher" et "Test du format de fichier Aether" sont visibles

### Test 1.2 : Index SQLCipher - Ajout de fichiers
- [ ] Ajouter un fichier manuellement dans l'index :
  - ID : `test-file-001`
  - Chemin logique : `/documents/test1.txt`
  - Taille chiffrée : `1024`
- [ ] Cliquer sur "Ajouter à l'index"
- [ ] **Vérifier** : Message de succès
- [ ] Cliquer sur "Rafraîchir la liste"
- [ ] **Vérifier** : Le fichier apparaît dans la liste avec les bonnes informations

### Test 1.3 : Format Aether - Chiffrement
- [ ] Dans "Chiffrer un fichier" :
  - Données : `"Hello Aether Drive!"`
  - Chemin logique : `/documents/hello.txt`
- [ ] Cliquer sur "Chiffrer"
- [ ] **Vérifier** : Métadonnées affichées (UUID, Version, Cipher ID, Taille chiffrée)
- [ ] **Vérifier** : UUID généré (format hex 32 caractères)
- [ ] **Vérifier** : Version = `0x01`
- [ ] **Vérifier** : Cipher ID = `0x02`

### Test 1.4 : Format Aether - Déchiffrement
- [ ] Dans "Déchiffrer un fichier" :
  - Chemin logique : `/documents/hello.txt` (même que lors du chiffrement)
- [ ] Cliquer sur "Déchiffrer"
- [ ] **Vérifier** : Données déchiffrées = `"Hello Aether Drive!"`
- [ ] **Vérifier** : Message de succès affiché

### Test 1.5 : Vérification d'intégrité
- [ ] Cliquer sur "Vérifier l'intégrité de l'index"
- [ ] **Vérifier** : Message "✅ Intégrité de l'index vérifiée : toutes les entrées sont valides (HMAC + Merkle Tree)."

### Test 1.6 : Index SQLCipher - Liste et suppression
- [ ] Cliquer sur "Rafraîchir la liste" dans "Gestion de l'index SQLCipher"
- [ ] **Vérifier** : Au moins 2 fichiers dans la liste (le fichier manuel + le fichier chiffré)
- [ ] Supprimer le fichier manuel `test-file-001`
- [ ] **Vérifier** : Message de succès
- [ ] Rafraîchir la liste
- [ ] **Vérifier** : Le fichier a été supprimé

---

## 📋 PHASE 2 : INTÉGRATION STORJ

### Test 2.1 : Configuration Storj
- [ ] Remplir les champs Storj :
  - Access Key ID
  - Secret Access Key
  - Endpoint
  - Bucket Name
- [ ] Cliquer sur "Configurer Storj"
- [ ] **Vérifier** : Message "✅ Client Storj configuré avec succès."
- [ ] **Vérifier** : Bouton passe à "✅ Storj configuré"
- [ ] **Vérifier** : Les sections Storj sont maintenant accessibles

### Test 2.2 : Upload vers Storj
- [ ] S'assurer d'avoir un fichier chiffré (utiliser celui du Test 1.3 ou en créer un nouveau)
- [ ] Cliquer sur "Upload vers Storj (synchronise avec index)"
- [ ] **Vérifier** : Message de succès avec ETag
- [ ] **Vérifier** : Le fichier apparaît dans "Liste des fichiers Storj" après rafraîchissement
- [ ] **Vérifier** : Le fichier apparaît dans "Gestion de l'index SQLCipher" après rafraîchissement
- [ ] **Vérifier** : Le chemin logique est correct dans les deux listes

### Test 2.3 : Liste des fichiers Storj
- [ ] Cliquer sur "Rafraîchir la liste" dans "Liste des fichiers Storj"
- [ ] **Vérifier** : Les fichiers Storj sont listés avec :
  - UUID (format original avec/sans tirets)
  - Chemin logique (si présent dans l'index local)
  - Taille chiffrée
- [ ] **Vérifier** : Les fichiers non-Aether sont marqués "⚠️ Non trouvé dans l'index local"

### Test 2.4 : Download depuis Storj par chemin logique
- [ ] Dans "Liste des fichiers Storj", cliquer sur "📥 Télécharger et préparer le déchiffrement" pour un fichier
- [ ] **Vérifier** : Message de succès
- [ ] **Vérifier** : Section "Fichier téléchargé" affichée avec la taille
- [ ] Dans "Déchiffrer un fichier", cliquer sur "Déchiffrer"
- [ ] **Vérifier** : Le fichier est déchiffré correctement
- [ ] **Vérifier** : Les données déchiffrées correspondent au fichier original

### Test 2.5 : Download depuis Storj par UUID (avancé)
- [ ] Copier l'UUID d'un fichier Storj (format 32 caractères hex)
- [ ] Dans "Download depuis Storj > Par UUID", coller l'UUID
- [ ] Cliquer sur "Download par UUID"
- [ ] **Vérifier** : Message de succès
- [ ] **Vérifier** : Section "Fichier téléchargé" affichée

### Test 2.6 : Suppression depuis Storj
- [ ] Dans "Liste des fichiers Storj", cliquer sur "🗑️ Supprimer de Storj" pour un fichier
- [ ] **Vérifier** : Message "✅ Fichier supprimé de Storj et de l'index local avec succès."
- [ ] Rafraîchir la liste Storj
- [ ] **Vérifier** : Le fichier n'apparaît plus dans la liste Storj
- [ ] Rafraîchir la liste de l'index local
- [ ] **Vérifier** : Le fichier n'apparaît plus dans l'index local

### Test 2.7 : Nettoyage automatique des fichiers orphelins
- [ ] Uploader un nouveau fichier vers Storj
- [ ] Supprimer ce fichier directement depuis le dashboard Storj (pas depuis l'interface)
- [ ] Dans l'interface, cliquer sur "Rafraîchir la liste" dans "Liste des fichiers Storj"
- [ ] **Vérifier** : Le fichier orphelin est automatiquement supprimé de l'index local
- [ ] Rafraîchir la liste de l'index local
- [ ] **Vérifier** : Le fichier n'apparaît plus dans l'index local

---

## 📋 TEST D'INTÉGRATION PHASE 1 + PHASE 2

### Test 3.1 : Workflow complet end-to-end
- [ ] **Étape 1** : Chiffrer un nouveau fichier avec chemin `/documents/workflow-test.txt`
- [ ] **Étape 2** : Uploader vers Storj
- [ ] **Étape 3** : Vérifier que le fichier apparaît dans l'index local
- [ ] **Étape 4** : Télécharger depuis Storj par chemin logique
- [ ] **Étape 5** : Déchiffrer le fichier téléchargé
- [ ] **Étape 6** : Vérifier que les données correspondent
- [ ] **Étape 7** : Vérifier l'intégrité de l'index
- [ ] **Étape 8** : Supprimer le fichier de Storj
- [ ] **Étape 9** : Vérifier que le fichier est supprimé de l'index local

### Test 3.2 : Non-régression Phase 1 après Phase 2
- [ ] Vérifier que le bootstrap fonctionne toujours
- [ ] Vérifier que l'ajout manuel dans l'index fonctionne toujours
- [ ] Vérifier que le chiffrement/déchiffrement fonctionne toujours
- [ ] Vérifier que la vérification d'intégrité fonctionne toujours
- [ ] Vérifier que la suppression dans l'index fonctionne toujours

### Test 3.3 : Persistance après redémarrage
- [ ] Fermer complètement l'application
- [ ] Relancer l'application (`npm run tauri dev`)
- [ ] Déverrouiller le coffre avec le même mot de passe
- [ ] **Vérifier** : L'index local contient toujours les fichiers
- [ ] **Vérifier** : La liste Storj affiche toujours les fichiers
- [ ] **Vérifier** : La vérification d'intégrité fonctionne toujours

---

## ✅ CRITÈRES DE VALIDATION

### Phase 1 validée si :
- ✅ Bootstrap/Unlock fonctionnent
- ✅ Index SQLCipher : ajout, liste, suppression fonctionnent
- ✅ Format Aether : chiffrement/déchiffrement fonctionnent
- ✅ Vérification d'intégrité (HMAC + Merkle Tree) fonctionne
- ✅ Tous les tests unitaires passent (18/18)

### Phase 2 validée si :
- ✅ Configuration Storj fonctionne
- ✅ Upload vers Storj avec synchronisation index fonctionne
- ✅ Download depuis Storj (par chemin et par UUID) fonctionne
- ✅ Suppression Storj avec synchronisation index fonctionne
- ✅ Nettoyage automatique des fichiers orphelins fonctionne
- ✅ Liste Storj affiche les métadonnées depuis l'index local

### Intégration validée si :
- ✅ Workflow complet end-to-end fonctionne
- ✅ Phase 1 fonctionne toujours après Phase 2 (non-régression)
- ✅ Persistance après redémarrage fonctionne

---

## 📝 NOTES DE TEST

**Date du test** : _______________

**Résultat global** : ☐ Réussi  ☐ Échec

**Problèmes rencontrés** :
- 
- 
- 

**Commentaires** :
- 
- 
- 

---

## 🎯 PROCHAINES ÉTAPES APRÈS VALIDATION

Une fois tous les tests validés :
1. Mettre à jour `.cursor/etat_actuel.md`
2. Faire un commit Git avec message descriptif
3. Push vers le dépôt GitHub

