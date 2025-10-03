#!/usr/bin/env bash
set -e  # Exit on any error

echo "🚀 Setting up Conductor workspace for Jinn..."

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored messages
error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
    exit 1
}

success() {
    echo -e "${GREEN}✓ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠ WARNING: $1${NC}"
}

# 1. Validate prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js version
if ! command -v node &> /dev/null; then
    error "Node.js is not installed. Please install Node.js v22.x"
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
    error "Node.js version must be v22.x or higher (current: $(node -v))"
fi
success "Node.js version OK ($(node -v))"

# Check Yarn
if ! command -v yarn &> /dev/null; then
    error "Yarn is not installed. Please install Yarn 1.22.x"
fi
success "Yarn found ($(yarn --version))"

# 2. Copy .env file from repository root
echo ""
echo "🔐 Setting up environment variables..."

# Determine the root path
if [ -n "$CONDUCTOR_ROOT_PATH" ]; then
    ROOT_PATH="$CONDUCTOR_ROOT_PATH"
else
    # Assume we're in .conductor/<workspace-name> directory
    ROOT_PATH="$(cd ../.. && pwd)"
    warning "CONDUCTOR_ROOT_PATH not set, using: $ROOT_PATH"
fi

if [ ! -f "$ROOT_PATH/.env" ]; then
    error ".env file not found at $ROOT_PATH/.env - Please create it first!"
fi

cp "$ROOT_PATH/.env" .env
success "Copied .env from $ROOT_PATH"

# Validate critical env vars are present
if ! grep -q "MECH_PRIVATE_KEY" .env; then
    warning "MECH_PRIVATE_KEY not found in .env - some features may not work"
fi

# 3. Install dependencies
echo ""
echo "📦 Installing dependencies..."
yarn install --silent
success "Root dependencies installed"

# 4. Build the main project
echo ""
echo "🔨 Building main project..."
yarn build > /dev/null
success "Main project built"

# 5. Build mech-client-ts package
echo ""
echo "🔧 Building mech-client-ts package..."
cd packages/mech-client-ts
yarn install --silent
yarn build > /dev/null
success "mech-client-ts built"

# 6. Copy ABIs and configs to dist directory
echo ""
echo "📁 Copying ABIs and configs to dist..."
cp -r src/abis dist/
cp -r src/configs dist/
success "ABIs and configs copied to dist"
cd ../..

# 7. Re-run yarn install to update symlinks
echo ""
echo "🔗 Updating package symlinks..."
yarn install --silent --force
success "Package symlinks updated"

# 8. Install ponder dependencies
echo ""
echo "🗂️  Installing ponder dependencies..."
cd ponder
yarn install --silent
success "Ponder dependencies installed"
cd ..

# 9. Validate setup
echo ""
echo "✅ Validating setup..."

# Check that critical files exist
if [ ! -f "node_modules/mech-client-ts/dist/marketplace_interact.js" ]; then
    error "mech-client-ts not properly linked in node_modules"
fi
success "mech-client-ts package linked correctly"

if [ ! -f "node_modules/mech-client-ts/dist/abis/AgentMech.json" ]; then
    error "ABIs not found in mech-client-ts dist"
fi
success "ABIs available in package"

if [ ! -f "node_modules/mech-client-ts/dist/configs/mechs.json" ]; then
    error "Configs not found in mech-client-ts dist"
fi
success "Configs available in package"

echo ""
echo -e "${GREEN}🎉 Workspace setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  • Click the Run button to start the development server"
echo "  • Or run: yarn dev"
echo ""
