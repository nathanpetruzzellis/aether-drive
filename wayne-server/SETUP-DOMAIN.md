# Configuration d'un nom de domaine pour Wayne Server

## Achat du domaine

1. **Achète le domaine "aether.io" sur Hostinger**
   - Va sur https://www.hostinger.com
   - Recherche "aether.io"
   - Ajoute-le au panier et finalise l'achat

## Configuration DNS

Une fois le domaine acheté, configure les DNS pour pointer vers ton serveur :

### Option 1 : DNS Hostinger (recommandé)

1. Connecte-toi à ton compte Hostinger
2. Va dans la section "Domaines" → "Gérer" → "DNS / Zone DNS"
3. Ajoute/modifie ces enregistrements :

```
Type: A
Nom: @ (ou laisse vide)
Valeur: 72.62.59.152
TTL: 3600 (ou par défaut)

Type: A
Nom: wayne (ou www)
Valeur: 72.62.59.152
TTL: 3600 (ou par défaut)
```

**Résultat :**
- `aether.io` → 72.62.59.152
- `wayne.aether.io` → 72.62.59.152 (optionnel, pour un sous-domaine)

### Option 2 : Cloudflare (gratuit, plus de contrôle)

1. Crée un compte sur https://www.cloudflare.com
2. Ajoute ton domaine "aether.io"
3. Suis les instructions pour changer les nameservers chez Hostinger
4. Dans Cloudflare, ajoute un enregistrement A :
   - Type: A
   - Name: @ (ou wayne)
   - IPv4: 72.62.59.152
   - Proxy: Désactivé (orange cloud OFF) pour Let's Encrypt

## Vérification DNS

Attends 5-15 minutes après la configuration, puis vérifie :

```bash
# Depuis ta machine locale
dig aether.io
# ou
nslookup aether.io
```

Tu devrais voir l'IP `72.62.59.152` dans la réponse.

## Configuration HTTPS

Une fois les DNS configurés et propagés :

1. Transfère le script SSL sur le serveur :
```bash
scp wayne-server/configure-ssl.sh root@72.62.59.152:/opt/wayne-server/
```

2. Connecte-toi au serveur :
```bash
ssh root@72.62.59.152
```

3. Exécute le script :
```bash
cd /opt/wayne-server
chmod +x configure-ssl.sh
./configure-ssl.sh
```

Quand le script demande le nom de domaine, entre : `aether.io` (ou `wayne.aether.io` si tu as configuré un sous-domaine)

## Migration future

Si tu migres vers un autre serveur plus tard :

1. **Le domaine reste le tien** - tu ne perds rien
2. **Change simplement les DNS** pour pointer vers la nouvelle IP
3. **Renouvelle le certificat SSL** sur le nouveau serveur (Let's Encrypt le fait automatiquement)

Exemple : Nouveau serveur avec IP `123.45.67.89`
- Change l'enregistrement A dans Hostinger/Cloudflare : `aether.io` → `123.45.67.89`
- Attends la propagation DNS (5-15 min)
- Sur le nouveau serveur, exécute `./configure-ssl.sh` avec le même domaine
- Let's Encrypt génère un nouveau certificat automatiquement

**Aucune perte de données** - le domaine est indépendant du serveur !

