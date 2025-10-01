#!/bin/bash

# Conductor Setup Script for Gemini CLI Jinn
# This script sets up a new Conductor workspace

set -e  # Exit on any error

echo "🚀 Setting up Conductor workspace for Gemini CLI Jinn..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    print_error "This script must be run from the root of the workspace"
fi

# Check Node.js version (required: 22.x)
print_status "Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2)
NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [ "$NODE_MAJOR" != "22" ]; then
    print_error "Node.js version 22.x is required, but found v$NODE_VERSION. Please install the correct version."
fi
print_success "Node.js version: v$NODE_VERSION"

# Check if yarn is available
print_status "Checking yarn availability..."
if ! command -v yarn &> /dev/null; then
    print_error "yarn is not installed. Please install yarn first."
fi
print_success "yarn is available"

# Copy .env file from repository root
print_status "Copying .env file from repository root..."
if [ ! -f "$CONDUCTOR_ROOT_PATH/.env" ]; then
    print_error ".env file not found at $CONDUCTOR_ROOT_PATH/.env. Please create it with your environment variables."
fi

cp "$CONDUCTOR_ROOT_PATH/.env" .env
print_success "Copied .env file"

# Validate required environment variables from main branch .env.template
print_status "Validating required environment variables..."
REQUIRED_VARS=(
    "GEMINI_API_KEY"
    "OPENAI_API_KEY"
    "SUPABASE_URL"
    "SUPABASE_ANON_KEY"
    "SUPABASE_SERVICE_ROLE_KEY"
    "CHAIN_ID"
    "RPC_URL"
    "WORKER_PRIVATE_KEY"
    "MECH_ADDRESS"
    "MECH_SAFE_ADDRESS"
    "MECH_PRIVATE_KEY"
    "MECH_CHAIN_CONFIG"
    "PONDER_GRAPHQL_URL"
    "PONDER_START_BLOCK"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${var}=..*" .env 2>/dev/null; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    echo -e "${RED}[ERROR]${NC} Missing required environment variables in .env:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    echo ""
    echo "Please update $CONDUCTOR_ROOT_PATH/.env with the missing variables."
    exit 1
fi
print_success "All required environment variables are set"

# Install dependencies (ignore engine warnings)
print_status "Installing dependencies..."
yarn install --ignore-engines

# Build the main project
print_status "Building the main project..."
if yarn build; then
    print_success "Main project built successfully"
else
    print_error "Main project build failed"
fi

# Build the MCP package (optional - not required for yarn dev)
print_status "Building MCP package..."
if yarn workspace @jinn/metacog-mcp build 2>/dev/null; then
    print_success "MCP package built successfully"
else
    echo -e "${YELLOW}[WARNING]${NC} MCP package build skipped (not required for development)"
fi

echo ""
print_success "Workspace setup completed!"
echo ""
echo "Next steps:"
echo "  • Click the 'Run' button to run the e2e test"
echo "  • This will verify changes don't break the marketplace flow"
echo ""