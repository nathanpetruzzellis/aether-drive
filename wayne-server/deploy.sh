#!/bin/bash
# Script de déploiement du serveur Wayne sur le VPS
# À exécuter depuis le serveur VPS

set -e

echo "🚀 Déploiement du serveur Wayne"
echo "================================"

# Variables
APP_DIR="/opt/wayne-server"
SERVICE_USER="wayne"

# 1. Créer l'utilisateur système pour Wayne (si n'existe pas)
if ! id "$SERVICE_USER" &>/dev/null; then
    echo "👤 Création de l'utilisateur $SERVICE_USER..."
    useradd -r -s /bin/false $SERVICE_USER
fi

# 2. Créer le répertoire de l'application
echo "📁 Création du répertoire de l'application..."
mkdir -p $APP_DIR
chown $SERVICE_USER:$SERVICE_USER $APP_DIR

# 3. Copier les fichiers (à faire manuellement ou via Git)
echo "📦 Les fichiers doivent être copiés dans $APP_DIR"
echo "   Option 1: Git clone"
echo "   Option 2: SCP depuis ton ordinateur local"
echo "   Option 3: Créer les fichiers directement sur le serveur"

# 4. Installer les dépendances
echo "📦 Installation des dépendances..."
cd $APP_DIR
npm install --production

# 5. Exécuter les migrations
echo "🔄 Exécution des migrations..."
npm run migrate

# 6. Créer le fichier .env (à éditer manuellement)
if [ ! -f "$APP_DIR/.env" ]; then
    echo "📝 Création du fichier .env..."
    cp $APP_DIR/.env.example $APP_DIR/.env
    echo "⚠️  IMPORTANT : Édite $APP_DIR/.env avec tes valeurs !"
fi

# 7. Créer le service systemd
echo "⚙️  Création du service systemd..."
cat > /etc/systemd/system/wayne.service <<EOF
[Unit]
Description=Wayne Server - Control Plane pour Aether Drive V1
After=network.target postgresql.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $APP_DIR/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 8. Recharger systemd et démarrer le service
systemctl daemon-reload
systemctl enable wayne
systemctl start wayne

echo ""
echo "✅ Déploiement terminé !"
echo ""
echo "📋 Commandes utiles :"
echo "   - Voir les logs : journalctl -u wayne -f"
echo "   - Redémarrer : systemctl restart wayne"
echo "   - Statut : systemctl status wayne"
echo ""

