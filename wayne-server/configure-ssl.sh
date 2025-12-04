#!/bin/bash
set -e

echo "🔒 Configuration SSL/HTTPS pour Wayne Server"
echo "=============================================="
echo ""
echo "Ce script configure HTTPS avec Let's Encrypt via Certbot."
echo ""

# Vérifie que Certbot est installé
if ! command -v certbot &> /dev/null; then
    echo "❌ Certbot n'est pas installé. Installation..."
    apt-get update -y
    apt-get install -y certbot python3-certbot-nginx
fi

# Demande le nom de domaine
read -p "Entrez le nom de domaine (ex: aether-wayne.duckdns.org): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "❌ Le nom de domaine est requis."
    exit 1
fi

echo ""
echo "📋 Configuration pour le domaine: $DOMAIN"
echo ""

# Vérifie que le domaine pointe vers cette IP
CURRENT_IP=$(curl -s ifconfig.me)
echo "🌐 IP publique actuelle: $CURRENT_IP"
echo "⚠️  Assure-toi que le domaine $DOMAIN pointe vers cette IP avant de continuer."
read -p "Le domaine pointe-t-il vers cette IP ? (o/n): " CONFIRM

if [ "$CONFIRM" != "o" ] && [ "$CONFIRM" != "O" ]; then
    echo "❌ Configure d'abord le DNS pour $DOMAIN → $CURRENT_IP"
    echo "   Pour DuckDNS: https://www.duckdns.org/update?domains=TON_SUBDOMAIN&token=TON_TOKEN&ip=$CURRENT_IP"
    exit 1
fi

# Sauvegarde la configuration Nginx actuelle
echo "💾 Sauvegarde de la configuration Nginx actuelle..."
cp /etc/nginx/sites-available/wayne /etc/nginx/sites-available/wayne.backup

# Met à jour la configuration Nginx avec le nom de domaine
echo "📝 Mise à jour de la configuration Nginx..."
cat > /etc/nginx/sites-available/wayne << EOF
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }
}
EOF

# Teste la configuration Nginx
echo "🧪 Test de la configuration Nginx..."
nginx -t

# Recharge Nginx
echo "🔄 Rechargement de Nginx..."
systemctl reload nginx

# Obtient le certificat SSL
echo "🔐 Obtention du certificat SSL avec Let's Encrypt..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email admin@$DOMAIN --redirect

# Vérifie que le certificat a été créé
if [ -f "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    echo ""
    echo "✅ Certificat SSL installé avec succès !"
    echo ""
    echo "📋 Informations:"
    echo "   - Domaine: https://$DOMAIN"
    echo "   - Certificat: /etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    echo "   - Clé privée: /etc/letsencrypt/live/$DOMAIN/privkey.pem"
    echo ""
    echo "🔄 Renouvellement automatique:"
    echo "   Certbot renouvelle automatiquement les certificats."
    echo "   Vérifie avec: certbot renew --dry-run"
    echo ""
    echo "⚠️  IMPORTANT:"
    echo "   - Mets à jour l'URL dans l'application React: https://$DOMAIN"
    echo "   - Le certificat expire dans 90 jours (renouvellement automatique)"
    echo ""
else
    echo "❌ Erreur lors de l'obtention du certificat SSL."
    exit 1
fi

