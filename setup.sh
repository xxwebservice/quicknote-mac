#!/bin/bash
# QuickNote macOS — Setup & Run
# Run this on your Mac:  cd mac && chmod +x setup.sh && ./setup.sh

set -e

echo "📦 Installing dependencies..."
npm install
npm install archiver

echo ""
echo "✅ Setup complete!"
echo ""
echo "To run QuickNote:"
echo "  npm start"
echo ""
echo "To build .dmg:"
echo "  npm run dist"
echo ""

# Auto-start
echo "🚀 Starting QuickNote..."
npm start
