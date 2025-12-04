#!/bin/bash
set -e

echo "🌐 Configuration temporaire pour accès HTTP via IP"
echo "=================================================="
echo ""
echo "Ce script permet l'accès HTTP direct à l'IP en attendant la propagation DNS."
echo "⚠️  À utiliser uniquement temporairement !"
echo ""

# Récupère l'IP publique
CURRENT_IP=$(curl -s ifconfig.me)
echo "📋 IP publique: $CURRENT_IP"
echo ""

# Crée une configuration Nginx temporaire pour l'IP
echo "📝 Création de la configuration Nginx temporaire..."
cat > /etc/nginx/sites-available/wayne-ip-temp << EOF
# Configuration temporaire pour accès HTTP via IP
# À supprimer une fois le DNS propagé
server {
    listen 80;
    server_name $CURRENT_IP;

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

# Active la configuration temporaire
echo "🔗 Activation de la configuration temporaire..."
ln -sf /etc/nginx/sites-available/wayne-ip-temp /etc/nginx/sites-enabled/wayne-ip-temp

# Teste la configuration
echo "🧪 Test de la configuration Nginx..."
nginx -t

# Recharge Nginx
echo "🔄 Rechargement de Nginx..."
systemctl reload nginx

echo ""
echo "✅ Configuration terminée !"
echo ""
echo "📋 Tu peux maintenant utiliser:"
echo "   - HTTP via IP: http://$CURRENT_IP"
echo "   - HTTPS via domaine: https://eather.io (une fois le DNS propagé)"
echo ""
echo "⚠️  IMPORTANT:"
echo "   - Dans l'application, utilise temporairement: http://$CURRENT_IP"
echo "   - Une fois le DNS propagé, change pour: https://eather.io"
echo "   - Pour supprimer cette config temporaire: rm /etc/nginx/sites-enabled/wayne-ip-temp && systemctl reload nginx"
echo ""

