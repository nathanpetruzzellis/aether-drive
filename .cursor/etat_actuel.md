# État Actuel du Projet "Aether Drive V1"

## 1. Dépôt et Configuration
* **Nom du Dépôt** : nathanpetruzzellis/aether-drive
* **Statut Git** : Squelette Tauri/React initialisé.
* **Environnement IDE** : Cursor, Terminal (zsh).
* **Règles IA** : Fichiers de contexte en place.

## 2. État Technique
* **Phase de Développement** : PHASE 1 — Crypto Core.
* **Travail Effectué** : Dépôt configuré, stack Tauri (React + Rust) initialisée, dépendances crypto ajoutées, module `crypto` (Argon2id → MasterKey → FileKey → MKEK) implémenté et couvert par des tests unitaires, commandes Tauri exposées et flux React local (bootstrap/unlock) opérationnel avec persistance des données du bootstrap via localStorage, contrat d'API Wayne défini (DTO + client HTTP minimal), module SQLCipher implémenté (`SqlCipherIndex`) avec dérivation de clé via HKDF depuis la MasterKey et tests unitaires validés, intégration SQLCipher dans le flux applicatif terminée (base créée/ouverte automatiquement lors du bootstrap/unlock dans le répertoire de données de l'app), persistance des données du bootstrap implémentée (localStorage) permettant le déverrouillage après redémarrage de l'app, commandes Tauri pour manipuler l'index implémentées et testées (`index_add_file`, `index_list_files`, `index_remove_file`, `index_get_file`) avec interface React fonctionnelle permettant l'ajout, la liste et la suppression de fichiers dans l'index SQLCipher, module `storage` implémenté avec format de fichier "Aether" V1 (en-tête binaire avec Magic Number `AETH`, Version `0x01`, Cipher ID `0x02`, UUID, Salt, Commitment HMAC, Nonce) et fonctions de chiffrement/déchiffrement avec XChaCha20-Poly1305 utilisant FileKey dérivée via HKDF depuis MasterKey, AAD incluant le chemin logique pour protection contre déplacement/renommage, sérialisation/désérialisation binaire et tests unitaires validés (12/12 tests passent).
* **Travail Restant (Prochaine Micro-Étape)** : Exposer les fonctions de chiffrement/déchiffrement via des commandes Tauri pour permettre le test depuis l'interface React, puis préparer l'intégration avec le stockage Storj pour la Phase 2.

## 3. Non-Régression
* Tests initiaux Tauri (dev server) validés.
* Tests unitaires Rust du Crypto Core (`cargo test`) validés.
* Flux UI local (bootstrap/unlock) testé manuellement avec succès.
* Tests unitaires SQLCipher (`cargo test sqlcipher_index`) validés.
* Persistance des données du bootstrap et déverrouillage après redémarrage validés.
* Commandes d'index (ajout/liste/suppression) testées manuellement avec succès.
* Module storage (format Aether) compilé et tests unitaires validés (12/12 tests passent).
