#!/bin/bash
# Script de test complet pour les Refresh Tokens
# Aether Drive V1 - Wayne Server

set -e  # Arrête en cas d'erreur

echo "🔐 Test des Refresh Tokens - Aether Drive V1"
echo "============================================"
echo ""

# Variables
SERVER_IP="72.62.59.152"
SERVER_USER="root"
SSH_KEY="$HOME/.ssh/id_ed25519_wayne"
SERVER_PATH="/opt/wayne-server"
LOCAL_PATH="$(pwd)"

echo "📦 Étape 1 : Transfert des fichiers modifiés vers le serveur"
echo "------------------------------------------------------------"
echo ""

# Vérifie que la clé SSH existe
if [ ! -f "$SSH_KEY" ]; then
    echo "❌ Clé SSH introuvable : $SSH_KEY"
    exit 1
fi

# Transfert du nouveau modèle RefreshToken
echo "📤 Transfert RefreshToken.ts..."
scp -i "$SSH_KEY" "$LOCAL_PATH/wayne-server/src/models/RefreshToken.ts" "$SERVER_USER@$SERVER_IP:$SERVER_PATH/src/models/"

# Transfert des routes auth modifiées
echo "📤 Transfert auth.ts..."
scp -i "$SSH_KEY" "$LOCAL_PATH/wayne-server/src/routes/auth.ts" "$SERVER_USER@$SERVER_IP:$SERVER_PATH/src/routes/"

echo ""
echo "✅ Fichiers transférés avec succès"
echo ""

echo "🔨 Étape 2 : Compilation du serveur Wayne"
echo "------------------------------------------"
echo ""

ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" << 'EOF'
cd /opt/wayne-server
echo "📦 Installation des dépendances (si nécessaire)..."
npm install

echo ""
echo "🔨 Compilation TypeScript..."
npm run build

if [ $? -eq 0 ]; then
    echo "✅ Compilation réussie"
else
    echo "❌ Erreur lors de la compilation"
    exit 1
fi
EOF

echo ""
echo "🔄 Étape 3 : Redémarrage du service Wayne"
echo "-----------------------------------------"
echo ""

ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" << 'EOF'
echo "🛑 Arrêt du service..."
systemctl stop wayne

echo "▶️  Démarrage du service..."
systemctl start wayne

echo "⏳ Attente de 2 secondes..."
sleep 2

echo "📊 Vérification du statut..."
systemctl status wayne --no-pager -l | head -15
EOF

echo ""
echo "📋 Étape 4 : Vérification des logs"
echo "-----------------------------------"
echo ""

ssh -i "$SSH_KEY" "$SERVER_USER@$SERVER_IP" << 'EOF'
echo "📜 Dernières lignes des logs (20 dernières)..."
journalctl -u wayne -n 20 --no-pager
EOF

echo ""
echo "🧪 Étape 5 : Test de l'endpoint /refresh"
echo "----------------------------------------"
echo ""

echo "⚠️  Pour tester l'endpoint /refresh, tu dois d'abord :"
echo "   1. Te connecter via l'app React pour obtenir un refresh_token"
echo "   2. Utiliser ce refresh_token pour tester l'endpoint"
echo ""
echo "Exemple de commande curl (après connexion) :"
echo "curl -X POST https://eather.io/api/v1/auth/refresh \\"
echo "  -H 'Content-Type: application/json' \\"
echo "  -d '{\"refresh_token\": \"TON_REFRESH_TOKEN_ICI\"}'"
echo ""

echo "✅ Déploiement terminé !"
echo ""
echo "📱 Prochaines étapes dans l'application React :"
echo "   1. Lance l'app : npm run tauri dev"
echo "   2. Connecte-toi à Wayne"
echo "   3. Ferme et rouvre l'app → La session doit être restaurée automatiquement"
echo "   4. Teste la déconnexion → Le refresh token doit être révoqué"
echo ""

