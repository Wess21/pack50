#!/bin/bash
set -e

echo "=== Pack50 Bot Installation ==="
echo ""

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Please install Docker first."
    exit 1
fi

# Check Docker Compose
if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose not found. Please install Docker Compose first."
    exit 1
fi

echo "✓ Docker found"
echo "✓ Docker Compose found"
echo ""

# Clone or update repo
if [ -d "pack50-bot" ]; then
    echo "📦 Updating existing installation..."
    cd pack50-bot
    git pull
else
    echo "📦 Cloning repository..."
    git clone https://github.com/Wess21/pack50.git pack50-bot
    cd pack50-bot
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Run ./configure.sh to setup environment"
echo "  2. Run docker compose up -d to start the bot"
echo ""
