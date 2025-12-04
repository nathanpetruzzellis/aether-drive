# État Actuel du Projet "Aether Drive V1"

## 1. Dépôt et Configuration
* **Nom du Dépôt** : nathanpetruzzellis/aether-drive
* **Statut Git** : Squelette Tauri/React initialisé.
* **Environnement IDE** : Cursor, Terminal (zsh).
* **Règles IA** : Fichiers de contexte en place.

## 2. État Technique
* **Phase de Développement** : PHASE 2 — Intégration Storj.
* **Travail Effectué** : Dépôt configuré, stack Tauri (React + Rust) initialisée, dépendances crypto ajoutées, module `crypto` (Argon2id → MasterKey → FileKey → MKEK) implémenté et couvert par des tests unitaires, commandes Tauri exposées et flux React local (bootstrap/unlock) opérationnel avec persistance des données du bootstrap via localStorage, contrat d'API Wayne défini (DTO + client HTTP minimal), module SQLCipher implémenté (`SqlCipherIndex`) avec dérivation de clé via HKDF depuis la MasterKey et tests unitaires validés, intégration SQLCipher dans le flux applicatif terminée (base créée/ouverte automatiquement lors du bootstrap/unlock dans le répertoire de données de l'app), persistance des données du bootstrap implémentée (localStorage) permettant le déverrouillage après redémarrage de l'app, commandes Tauri pour manipuler l'index implémentées et testées (`index_add_file`, `index_list_files`, `index_remove_file`, `index_get_file`) avec interface React fonctionnelle permettant l'ajout, la liste et la suppression de fichiers dans l'index SQLCipher, module `storage` implémenté avec format de fichier "Aether" V1 (en-tête binaire avec Magic Number `AETH`, Version `0x01`, Cipher ID `0x02`, UUID, Salt, Commitment HMAC, Nonce) et fonctions de chiffrement/déchiffrement avec XChaCha20-Poly1305 utilisant FileKey dérivée via HKDF depuis MasterKey, AAD incluant le chemin logique pour protection contre déplacement/renommage, sérialisation/désérialisation binaire et tests unitaires validés (12/12 tests passent), commandes Tauri exposées pour le chiffrement/déchiffrement (`storage_encrypt_file`, `storage_decrypt_file`, `storage_get_file_info`) avec interface React fonctionnelle permettant de tester le format Aether de manière interactive (chiffrement de texte, affichage des métadonnées, déchiffrement avec vérification du chemin logique), **PHASE 1 FINALISÉE** : protection HMAC pour chaque entrée de l'index SQLCipher (HMAC-SHA256 calculé et vérifié lors de chaque opération), module Merkle Tree implémenté pour vérification de l'intégrité globale de l'index (hash Merkle calculé et stocké automatiquement lors des modifications, vérification disponible via `verify_integrity()`), commande Tauri `index_verify_integrity` exposée pour vérifier l'intégrité depuis l'interface React, migration automatique du schéma SQLCipher pour ajouter le champ HMAC aux bases existantes, tous les tests unitaires passent (18/18 tests).
* **Travail Restant (Prochaine Phase)** : Phase 2 — Intégration Storj (client Storj DCS, upload/download de fichiers chiffrés au format Aether, synchronisation avec l'index local).

## 3. Non-Régression
* Tests initiaux Tauri (dev server) validés.
* Tests unitaires Rust du Crypto Core (`cargo test`) validés.
* Flux UI local (bootstrap/unlock) testé manuellement avec succès.
* Tests unitaires SQLCipher (`cargo test sqlcipher_index`) validés.
* Persistance des données du bootstrap et déverrouillage après redémarrage validés.
* Commandes d'index (ajout/liste/suppression) testées manuellement avec succès.
* Module storage (format Aether) compilé et tests unitaires validés (12/12 tests passent).
* Commandes de chiffrement/déchiffrement testées manuellement avec succès depuis l'interface React.
* Protection HMAC par entrée implémentée et testée (tests unitaires passent).
* Merkle Tree pour intégrité globale implémenté et testé (tests unitaires passent).
* Vérification d'intégrité testée manuellement depuis l'interface React avec succès.
* **PHASE 1 COMPLÈTE** : Tous les tests unitaires passent (18/18), conformité blueprint 100%.
