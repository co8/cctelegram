#!/bin/bash

# CCTelegram MCP Server Documentation Development Setup
# Sets up development environment for documentation

set -e

echo "🚀 Setting up CCTelegram MCP Server documentation environment..."

# Check Node.js version
NODE_VERSION=$(node --version)
echo "📦 Node.js version: $NODE_VERSION"

if [[ ! "$NODE_VERSION" =~ ^v(18|20) ]]; then
    echo "⚠️  Warning: Node.js 18.x or 20.x recommended"
fi

# Install main dependencies
echo "📦 Installing main project dependencies..."
cd ..
npm install
echo "✅ Main dependencies installed"

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build
echo "✅ TypeScript build complete"

# Install docs dependencies
cd docs
echo "📖 Installing documentation dependencies..."
npm install
echo "✅ Documentation dependencies installed"

# Generate API documentation
echo "🔧 Generating API documentation..."
npm run api:generate
echo "✅ API documentation generated"

# Check if documentation builds successfully
echo "🏗️  Testing documentation build..."
npm run docs:build
echo "✅ Documentation build successful"

echo ""
echo "🎉 Setup complete! You can now:"
echo ""
echo "  Start development server:"
echo "    npm run docs:dev"
echo ""  
echo "  Build documentation:"
echo "    npm run docs:build"
echo ""
echo "  Preview built docs:"
echo "    npm run docs:preview"
echo ""
echo "📚 Documentation will be available at: http://localhost:5173"

# Start development server if requested
if [[ "$1" == "--dev" ]]; then
    echo ""
    echo "🚀 Starting development server..."
    npm run docs:dev
fi