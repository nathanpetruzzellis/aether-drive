#!/bin/bash
# Script de test manuel des Refresh Tokens
# À utiliser après avoir obtenu un refresh_token via l'app React

set -e

SERVER_URL="https://eather.io"
REFRESH_TOKEN="${1:-}"

if [ -z "$REFRESH_TOKEN" ]; then
    echo "❌ Usage: $0 <refresh_token>"
    echo ""
    echo "Pour obtenir un refresh_token :"
    echo "  1. Lance l'app React : npm run tauri dev"
    echo "  2. Connecte-toi à Wayne"
    echo "  3. Ouvre la console du navigateur (F12)"
    echo "  4. Tape : localStorage.getItem('wayne_refresh_token')"
    echo "  5. Copie le token et utilise-le avec ce script"
    exit 1
fi

echo "🧪 Test de l'endpoint /api/v1/auth/refresh"
echo "=========================================="
echo ""

echo "📤 Envoi de la requête..."
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/api/v1/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo ""
echo "📊 Code HTTP : $HTTP_CODE"
echo "📄 Réponse :"
echo "$BODY" | jq '.' 2>/dev/null || echo "$BODY"

if [ "$HTTP_CODE" = "200" ]; then
    echo ""
    echo "✅ Refresh token valide ! Nouvel access_token généré."
    ACCESS_TOKEN=$(echo "$BODY" | jq -r '.access_token' 2>/dev/null || echo "")
    if [ -n "$ACCESS_TOKEN" ]; then
        echo "🔑 Access Token (premiers 20 caractères) : ${ACCESS_TOKEN:0:20}..."
    fi
else
    echo ""
    echo "❌ Erreur lors du refresh"
fi

echo ""
echo "🧪 Test de l'endpoint /api/v1/auth/logout"
echo "========================================="
echo ""

echo "📤 Envoi de la requête de déconnexion..."
LOGOUT_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/api/v1/auth/logout" \
  -H 'Content-Type: application/json' \
  -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}")

LOGOUT_HTTP_CODE=$(echo "$LOGOUT_RESPONSE" | tail -n1)
LOGOUT_BODY=$(echo "$LOGOUT_RESPONSE" | head -n-1)

echo ""
echo "📊 Code HTTP : $LOGOUT_HTTP_CODE"
echo "📄 Réponse :"
echo "$LOGOUT_BODY" | jq '.' 2>/dev/null || echo "$LOGOUT_BODY"

if [ "$LOGOUT_HTTP_CODE" = "200" ]; then
    echo ""
    echo "✅ Déconnexion réussie ! Refresh token révoqué."
    echo ""
    echo "🧪 Vérification : Tentative de refresh après logout..."
    VERIFY_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SERVER_URL/api/v1/auth/refresh" \
      -H 'Content-Type: application/json' \
      -d "{\"refresh_token\": \"$REFRESH_TOKEN\"}")
    
    VERIFY_HTTP_CODE=$(echo "$VERIFY_RESPONSE" | tail -n1)
    if [ "$VERIFY_HTTP_CODE" = "401" ]; then
        echo "✅ Le refresh token a bien été révoqué (401 Unauthorized)"
    else
        echo "⚠️  Le refresh token semble toujours valide (code: $VERIFY_HTTP_CODE)"
    fi
else
    echo ""
    echo "❌ Erreur lors de la déconnexion"
fi

