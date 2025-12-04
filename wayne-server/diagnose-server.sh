#!/bin/bash
set -e

echo "🔍 Diagnostic du serveur Wayne"
echo "=============================="
echo ""

# Vérifie que le serveur Node.js est démarré
echo "1️⃣  Vérification du service Wayne..."
if systemctl is-active --quiet wayne; then
    echo "   ✅ Service Wayne actif"
else
    echo "   ❌ Service Wayne inactif"
    echo "   Démarre avec: systemctl start wayne"
fi

# Vérifie que le serveur écoute sur le port 3000
echo ""
echo "2️⃣  Vérification du port 3000..."
if netstat -tuln | grep -q ':3000 '; then
    echo "   ✅ Port 3000 en écoute"
else
    echo "   ❌ Port 3000 non accessible"
fi

# Teste la connexion locale
echo ""
echo "3️⃣  Test de connexion locale (localhost:3000)..."
if curl -s http://localhost:3000/health > /dev/null; then
    echo "   ✅ Serveur Node.js répond localement"
    curl -s http://localhost:3000/health | jq '.' 2>/dev/null || curl -s http://localhost:3000/health
else
    echo "   ❌ Serveur Node.js ne répond pas localement"
fi

# Vérifie la configuration Nginx
echo ""
echo "4️⃣  Vérification de la configuration Nginx..."
if nginx -t 2>&1 | grep -q "successful"; then
    echo "   ✅ Configuration Nginx valide"
else
    echo "   ❌ Configuration Nginx invalide"
    nginx -t
fi

# Vérifie que Nginx est actif
echo ""
echo "5️⃣  Vérification du service Nginx..."
if systemctl is-active --quiet nginx; then
    echo "   ✅ Service Nginx actif"
else
    echo "   ❌ Service Nginx inactif"
fi

# Affiche la configuration Nginx pour eather.io
echo ""
echo "6️⃣  Configuration Nginx pour eather.io..."
if [ -f /etc/nginx/sites-enabled/wayne ]; then
    echo "   ✅ Fichier de configuration trouvé"
    echo "   Contenu:"
    cat /etc/nginx/sites-enabled/wayne | grep -A 5 "server_name"
else
    echo "   ❌ Fichier de configuration non trouvé"
fi

# Teste la connexion via Nginx (HTTP)
echo ""
echo "7️⃣  Test de connexion via Nginx (HTTP)..."
if curl -s -H "Host: eather.io" http://localhost/health > /dev/null; then
    echo "   ✅ Nginx route correctement vers Node.js"
    curl -s -H "Host: eather.io" http://localhost/health | jq '.' 2>/dev/null || curl -s -H "Host: eather.io" http://localhost/health
else
    echo "   ❌ Nginx ne route pas correctement"
fi

# Vérifie le certificat SSL
echo ""
echo "8️⃣  Vérification du certificat SSL..."
if [ -f /etc/letsencrypt/live/eather.io/fullchain.pem ]; then
    echo "   ✅ Certificat SSL trouvé"
    echo "   Expire le: $(openssl x509 -in /etc/letsencrypt/live/eather.io/fullchain.pem -noout -enddate 2>/dev/null | cut -d= -f2 || echo 'N/A')"
else
    echo "   ❌ Certificat SSL non trouvé"
fi

# Teste la connexion HTTPS locale
echo ""
echo "9️⃣  Test de connexion HTTPS locale..."
if curl -s -k -H "Host: eather.io" https://localhost/health > /dev/null; then
    echo "   ✅ HTTPS fonctionne localement"
    curl -s -k -H "Host: eather.io" https://localhost/health | jq '.' 2>/dev/null || curl -s -k -H "Host: eather.io" https://localhost/health
else
    echo "   ❌ HTTPS ne fonctionne pas localement"
fi

echo ""
echo "✅ Diagnostic terminé"
echo ""
echo "💡 Si des erreurs sont détectées, corrige-les avant de tester depuis l'application."

