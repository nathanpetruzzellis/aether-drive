#!/bin/bash
# Script d'installation complet du serveur Wayne
# À exécuter sur le serveur VPS après avoir transféré les fichiers

set -e

echo "🚀 Installation du serveur Wayne"
echo "================================"

APP_DIR="/opt/wayne-server"

# 1. Vérifier que nous sommes dans le bon répertoire
if [ ! -f "package.json" ]; then
    echo "❌ Erreur : Ce script doit être exécuté depuis le répertoire wayne-server"
    echo "   Exemple : cd /opt/wayne-server && ./install-on-server.sh"
    exit 1
fi

# 2. Installer les dépendances npm
echo ""
echo "📦 Installation des dépendances npm..."
npm install

# 3. Créer le fichier .env s'il n'existe pas
if [ ! -f ".env" ]; then
    echo ""
    echo "📝 Création du fichier .env..."
    cp env.template .env
    echo "⚠️  IMPORTANT : Édite .env avec tes valeurs (JWT_SECRET, DB_PASSWORD) !"
    echo "   Commande : nano .env"
    read -p "Appuie sur Entrée après avoir édité .env..."
fi

# 4. Exécuter les migrations
echo ""
echo "🔄 Exécution des migrations de base de données..."
npm run migrate

# 5. Compiler TypeScript
echo ""
echo "🔨 Compilation TypeScript..."
npm run build

# 6. Créer le service systemd
echo ""
echo "⚙️  Création du service systemd..."
cat > /etc/systemd/system/wayne.service <<EOF
[Unit]
Description=Wayne Server - Control Plane pour Aether Drive V1
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP_DIR/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 7. Activer et démarrer le service
systemctl daemon-reload
systemctl enable wayne
systemctl start wayne

echo ""
echo "✅ Installation terminée !"
echo ""
echo "📋 Commandes utiles :"
echo "   - Voir les logs : journalctl -u wayne -f"
echo "   - Redémarrer : systemctl restart wayne"
echo "   - Statut : systemctl status wayne"
echo "   - Tester : curl http://localhost:3000/health"
echo ""

