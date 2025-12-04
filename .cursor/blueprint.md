# Aether Drive V1 : Spécifications Produit & Architecture (Blueprint)

## 1. Philosophie & Architecture
* **Vision** : Stockage souverain "Zero-Knowledge" et "Local-First". L'opérateur est techniquement aveugle.
* **Architecture Duale** : 
    * **"Wayne" (Control Plane)** : Serveur central (Islande). Gère l'auth, la facturation, les métadonnées anonymisées. Considéré "Non Fiable" pour les données.
    * **"Batman" (Data Plane)** : Client local + Stockage Storj. Lieu unique où les clés existent en clair (RAM volatile)[cite: 32].
* **Sécurité** : Single-Paranoia (Niveau CIVIL par défaut en V1)[cite: 26].

## 2. Stack Technologique (V1)
* **Frontend (UI)** : Tauri 2.0 + React/TypeScript + Tailwind CSS.
* **Core Système (Noyau)** : Rust 1.75+. Bibliothèque native exposée via FFI.
* **Base de Données Locale** : SQLite avec **SQLCipher** (chiffrement AES-256 de l'index local)[cite: 44].
* **Backend Stockage** : Storj DCS (Objets chiffrés distribués).
* **Réseau** : API REST (TLS 1.3) + WebSocket.
* **Plateformes** : Windows 10/11, macOS 12+ (Intel/Silicon), Linux. (Pas de mobile/web en V1).

## 3. Cryptographie & Hiérarchie de Clés (Critique)
L'implémentation doit respecter strictement cette chaîne de confiance [cite: 167-183] :
1.  **Secret Utilisateur** : Mot de passe (Jamais stocké, jamais envoyé).
2.  **KEK (Key Encryption Key)** : Dérivée du mot de passe via **Argon2id** (Adaptatif CPU/RAM). Ephémère.
3.  **MKEK (Master Key Encryption Key)** : Clé intermédiaire chiffrée par la KEK et stockée sur le serveur. Permet le changement de mot de passe sans re-chiffrer les données.
4.  **Master Key (MK)** : 256-bit random. La racine de confiance. Déchiffrée en RAM uniquement via la MKEK. **Ne quitte jamais l'appareil en clair.**
5.  **File Keys** : Dérivées pour chaque fichier via **HKDF-SHA256** (MasterKey + Salt).
6.  **Chiffrement Données** : **XChaCha20-Poly1305** (Stream cipher authentifié).

* **Post-Quantique** : Échange de clés hybride **X25519 + ML-KEM-768** pour les sessions TLS/Handshake[cite: 227].
* **Sécurité Mémoire** : Utilisation de `mlock` et `zeroize` pour protéger les clés en RAM[cite: 86].

## 4. Spécifications du Format de Fichier "Aether" (V1)
Tout fichier chiffré doit respecter l'en-tête binaire défini en Annexe A [cite: 239-241] :
* **Magic Number** : `AETH` (ASCII)
* **Version** : `0x01`
* **Cipher ID** : `0x02` (XChaCha20-Poly1305 + PQ Hybrid)
* **Header Content** : UUID (16o) + Salt (32o) + Commitment HMAC (32o) + Nonce (24o).
* **AAD (Additional Authenticated Data)** : Le chemin logique du fichier est inclus dans l'AAD pour empêcher le déplacement/renommage non autorisé[cite: 251].

## 5. Règles d'Implémentation (Garde-fous)
1.  **FFI Boundary** : Aucune clé privée ou donnée en clair ne traverse la frontière Rust -> JS. L'UI ne reçoit que des états ou des données non sensibles[cite: 52].
2.  **Intégrité Index** : Chaque entrée de la DB locale est protégée par un HMAC. L'index global est vérifié par un Merkle Tree[cite: 81].
3.  **Pas de "Invented Crypto"** : Utiliser exclusivement `RustCrypto`, `ring`, `libsodium`.

## 6. Roadmap Phase 1 (Actuelle)
* **Objectif** : "Crypto Core". Implémentation de la hiérarchie Argon2id -> MKEK -> MasterKey en Rust.
* **Validation** : Tests unitaires couvrant >95% du module crypto.
