#!/bin/bash
# Script d'installation du serveur Wayne pour Aether Drive V1
# À exécuter sur le VPS Ubuntu 24.04 LTS

set -e  # Arrête en cas d'erreur

echo "🚀 Installation du serveur Wayne pour Aether Drive V1"
echo "=================================================="

# 1. Mise à jour du système
echo ""
echo "📦 Mise à jour du système..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y curl wget git build-essential

# 2. Installation de PostgreSQL
echo ""
echo "🗄️  Installation de PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# Création de la base de données et de l'utilisateur
echo ""
echo "📝 Configuration de la base de données..."
sudo -u postgres psql <<EOF
-- Création de l'utilisateur wayne
CREATE USER wayne WITH PASSWORD 'wayne_secure_password_change_me';
-- Création de la base de données
CREATE DATABASE wayne_db OWNER wayne;
-- Attribution des privilèges
GRANT ALL PRIVILEGES ON DATABASE wayne_db TO wayne;
\q
EOF

echo "✅ PostgreSQL installé et configuré"
echo "⚠️  IMPORTANT : Change le mot de passe 'wayne_secure_password_change_me' dans la production !"

# 3. Installation de Node.js (via NodeSource)
echo ""
echo "📦 Installation de Node.js 20.x LTS..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Vérification de l'installation
node_version=$(node --version)
npm_version=$(npm --version)
echo "✅ Node.js installé : $node_version"
echo "✅ npm installé : $npm_version"

# 4. Installation de Nginx
echo ""
echo "🌐 Installation de Nginx..."
apt-get install -y nginx
systemctl start nginx
systemctl enable nginx

# Configuration de base de Nginx (sera modifiée plus tard pour HTTPS)
echo "✅ Nginx installé et démarré"

# 5. Installation de Certbot (pour Let's Encrypt)
echo ""
echo "🔒 Installation de Certbot (Let's Encrypt)..."
apt-get install -y certbot python3-certbot-nginx

echo "✅ Certbot installé"

# 6. Configuration du firewall (UFW)
echo ""
echo "🔥 Configuration du firewall..."
ufw --force enable
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw status

echo ""
echo "✅ Installation terminée !"
echo ""
echo "📋 Résumé :"
echo "   - PostgreSQL : installé (base 'wayne_db', utilisateur 'wayne')"
echo "   - Node.js : $node_version"
echo "   - npm : $npm_version"
echo "   - Nginx : installé et démarré"
echo "   - Certbot : installé"
echo "   - Firewall : configuré (ports 22, 80, 443 ouverts)"
echo ""
echo "⚠️  PROCHAINES ÉTAPES :"
echo "   1. Changer le mot de passe PostgreSQL dans /etc/postgresql/*/main/pg_hba.conf si nécessaire"
echo "   2. Créer le serveur Wayne (code à venir)"
echo "   3. Configurer Nginx pour le reverse proxy"
echo "   4. Configurer HTTPS avec Let's Encrypt"
echo ""

