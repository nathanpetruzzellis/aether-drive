# Installation du serveur Wayne sur le VPS

## Étape 1 : Transférer les fichiers sur le serveur

Depuis ton ordinateur local, exécute :

```bash
cd /Users/nathanpetruzzellis/aether-drive
tar -czf wayne-server.tar.gz wayne-server/
scp wayne-server.tar.gz root@72.62.59.152:/root/
```

Puis sur le serveur :

```bash
cd /root
tar -xzf wayne-server.tar.gz
mv wayne-server /opt/wayne-server
```

## Étape 2 : Installer les dépendances

Sur le serveur :

```bash
cd /opt/wayne-server
npm install
```

## Étape 3 : Configurer l'environnement

```bash
cp env.template .env
nano .env  # Édite avec tes valeurs
```

**IMPORTANT** : Change le `JWT_SECRET` et le `DB_PASSWORD` !

## Étape 4 : Exécuter les migrations

```bash
npm run migrate
```

## Étape 5 : Compiler TypeScript

```bash
npm run build
```

## Étape 6 : Créer le service systemd

```bash
cat > /etc/systemd/system/wayne.service <<EOF
[Unit]
Description=Wayne Server - Control Plane pour Aether Drive V1
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/wayne-server
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/wayne-server/dist/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable wayne
systemctl start wayne
```

## Étape 7 : Vérifier que ça fonctionne

```bash
# Voir les logs
journalctl -u wayne -f

# Vérifier le statut
systemctl status wayne

# Tester l'API
curl http://localhost:3000/health
```

## Étape 8 : Configurer Nginx (reverse proxy)

```bash
cat > /etc/nginx/sites-available/wayne <<EOF
server {
    listen 80;
    server_name 72.62.59.152;  # Remplace par ton domaine si tu en as un

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

ln -s /etc/nginx/sites-available/wayne /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## Étape 9 : Configurer HTTPS (Let's Encrypt) - Optionnel

Si tu as un nom de domaine :

```bash
certbot --nginx -d ton-domaine.com
```

Sinon, tu peux utiliser l'IP directement (HTTP uniquement pour la beta).

