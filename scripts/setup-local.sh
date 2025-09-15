#!/usr/bin/env bash
set -euo pipefail

OS="$(uname -s)"
echo "🔧 Local setup starting on: $OS"

# 1) Ensure pnpm
if ! command -v pnpm >/dev/null 2>&1; then
  echo "📦 Installing pnpm..."
  npm i -g pnpm
fi

# 2) Install MongoDB Community (best effort)
if ! nc -z 127.0.0.1 27017 >/dev/null 2>&1; then
  case "$OS" in
    Darwin)
      if ! command -v brew >/dev/null 2>&1; then
        echo "🍺 Homebrew not found. Install from https://brew.sh then re-run this script."; exit 1;
      fi
      brew tap mongodb/brew
      brew install mongodb-community@7.0
      brew services start mongodb-community@7.0
      ;;
    Linux)
      if command -v apt >/dev/null 2>&1; then
        echo "🐧 Installing MongoDB via apt..."
        sudo apt-get update -y
        sudo apt-get install -y gnupg curl
        curl -fsSL https://pgp.mongodb.com/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
        echo "deb [ signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu $(. /etc/os-release && echo $UBUNTU_CODENAME)/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
        sudo apt-get update -y
        sudo apt-get install -y mongodb-org
        sudo systemctl enable mongod
        sudo systemctl start mongod
      else
        echo "⚠️  Please install MongoDB Community for your distro manually: https://www.mongodb.com/docs/manual/administration/install-on-linux/"
      fi
      ;;
    *)
      echo "⚠️  Unsupported OS for auto-install. Install MongoDB manually: https://www.mongodb.com/try/download/community";;
  esac
else
  echo "✅ MongoDB already running on 27017"
fi

# 3) Install dependencies
pnpm install

# 4) Generate env files with strong secrets
pnpm run env:generate

# 5) Done: suggest dev
cat <<EOF

🎉 Setup completed.
Run:
  pnpm dev             # Starts Express backend (MongoDB required) + Vite

Health:
  http://localhost:3001/api/health
  http://localhost:3001/api/health/db

EOF
