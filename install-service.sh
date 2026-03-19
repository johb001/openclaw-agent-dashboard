#!/usr/bin/env bash
set -e

APP_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_DIR="/etc/systemd/system"
API_SERVICE="agent-dashboard-api.service"
WEB_SERVICE="agent-dashboard-web.service"

cat > /tmp/$API_SERVICE <<EOF
[Unit]
Description=Agent Dashboard API
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm run dev:api
Restart=always
RestartSec=3
Environment=NODE_ENV=development

[Install]
WantedBy=multi-user.target
EOF

cat > /tmp/$WEB_SERVICE <<EOF
[Unit]
Description=Agent Dashboard Web
After=network.target $API_SERVICE

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/npm run dev -- --host 0.0.0.0 --port 4173
Restart=always
RestartSec=3
Environment=NODE_ENV=development

[Install]
WantedBy=multi-user.target
EOF

sudo mv /tmp/$API_SERVICE $SERVICE_DIR/$API_SERVICE
sudo mv /tmp/$WEB_SERVICE $SERVICE_DIR/$WEB_SERVICE
sudo systemctl daemon-reload
sudo systemctl enable $API_SERVICE $WEB_SERVICE
sudo systemctl restart $API_SERVICE $WEB_SERVICE

echo "installed services:"
echo "- $API_SERVICE"
echo "- $WEB_SERVICE"
echo
echo "check status with:"
echo "sudo systemctl status $API_SERVICE"
echo "sudo systemctl status $WEB_SERVICE"
