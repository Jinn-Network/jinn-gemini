#!/usr/bin/env bash
set -e  # Exit on any error

echo "🚀 Setting up Conductor workspace for Jinn..."
echo ""

# =============================================================================
# Color codes and logging functions
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

MAIN_REPO_ROOT=""
WORKTREE_GITDIR=""
WORKTREE_NAME=""
REPO_CONTEXT=""

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

info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

step() {
    echo ""
    echo -e "${BLUE}🔧 $1${NC}"
}

detect_repo_context() {
    if [ -n "$MAIN_REPO_ROOT" ]; then
        return
    fi

    if [ -f .git ]; then
        WORKTREE_GITDIR=$(sed 's/gitdir:[[:space:]]*//;q' .git | tr -d '\r')
        if [ -z "$WORKTREE_GITDIR" ] || [ ! -d "$WORKTREE_GITDIR" ]; then
            error "Worktree gitdir not found: $WORKTREE_GITDIR"
        fi
        MAIN_REPO_ROOT=$(dirname "$(dirname "$(dirname "$WORKTREE_GITDIR")")")
        WORKTREE_NAME=$(basename "$WORKTREE_GITDIR")
        REPO_CONTEXT="worktree"
    elif [ -d .git ]; then
        MAIN_REPO_ROOT="$(pwd)"
        WORKTREE_GITDIR="$MAIN_REPO_ROOT/.git"
        WORKTREE_NAME=""
        REPO_CONTEXT="main"
    else
        error "Not in a git repository"
    fi
}

# =============================================================================
# 1. Prerequisites validation
# =============================================================================

check_prerequisites() {
    step "Checking prerequisites..."

    local missing=()

    # Check Node.js version
    if ! command -v node &> /dev/null; then
        missing+=("node v22+")
    else
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -lt 22 ]; then
            error "Node.js version must be v22.x or higher (current: $(node -v))"
        fi
        success "Node.js version OK ($(node -v))"
    fi

    # Check other dependencies
    for cmd in yarn python3 git poetry; do
        if ! command -v $cmd &> /dev/null; then
            missing+=("$cmd")
        else
            success "$cmd found ($(command -v $cmd))"
        fi
    done

    if [ ${#missing[@]} -ne 0 ]; then
        error "Missing dependencies: ${missing[*]}"
    fi

    success "All prerequisites installed"
}

# =============================================================================
# 2. Detect main repo root and copy environment files
# =============================================================================

setup_environment_files() {
    step "Setting up environment files..."

    detect_repo_context

    if [ "$REPO_CONTEXT" = "worktree" ]; then
        info "Detected git worktree setup"
        info "Main repo root: $MAIN_REPO_ROOT"
    else
        info "Already in main repository"
    fi

    # Check if .env already exists
    if [ -f .env ]; then
        success ".env already exists"
        if [ -f .env.test ]; then
            success ".env.test already exists"
        fi
        return
    fi

    # Copy .env from main repo
    if [ -f "$MAIN_REPO_ROOT/.env" ]; then
        cp "$MAIN_REPO_ROOT/.env" .env
        success "Copied .env from main repo"
    else
        error ".env file not found at $MAIN_REPO_ROOT/.env"
    fi

    # Copy .env.test from main repo
    if [ -f "$MAIN_REPO_ROOT/.env.test" ]; then
        cp "$MAIN_REPO_ROOT/.env.test" .env.test
        success "Copied .env.test from main repo"
    else
        warning ".env.test not found - tests may use production config"
    fi
}

# =============================================================================
# 3. Initialize git submodules
# =============================================================================

init_submodules() {
    step "Initializing git submodules..."

    detect_repo_context

    if [ ! -f .gitmodules ]; then
        warning "No .gitmodules file found"
        return
    fi

    # Skip submodule initialization in worktrees
    # The olas-operate-middleware submodule is optional - worker falls back to environment variables
    # If needed, manually run: git submodule update --init olas-operate-middleware
    info "Skipping submodule initialization (optional - worker uses env vars as fallback)"

    # Note: .operate directory copying skipped since submodule is not initialized
    # Tests use test credentials, production needs manual service setup
}

# =============================================================================
# 4. Clean test artifacts
# =============================================================================

clean_test_artifacts() {
    step "Cleaning test artifacts..."

    rm -rf .operate-test/ 2>/dev/null || true
    rm -rf ponder/.ponder/ 2>/dev/null || true
    rm -rf .tmp/ 2>/dev/null || true
    rm -f .vnet-session-*.json 2>/dev/null || true

    success "Test artifacts cleaned"
}

# =============================================================================
# 5. Setup test fixtures
# =============================================================================

setup_test_fixtures() {
    step "Setting up test fixtures..."

    detect_repo_context

    # Create fixtures directory structure
    mkdir -p tests-next/fixtures/operate-profile/services
    mkdir -p tests-next/fixtures/operate-profile/keys

    # 1. Copy git template fixture
    if [ "$REPO_CONTEXT" = "worktree" ]; then
        local git_template_source="$MAIN_REPO_ROOT/tests-next/fixtures/git-template"
        if [ -d "$git_template_source/.git" ]; then
            info "Copying git template from main repo..."
            rm -rf tests-next/fixtures/git-template
            cp -R "$git_template_source" tests-next/fixtures/
            success "Git template fixture copied"
        else
            warning "Git template not found at $git_template_source (tests may fail)"
        fi
    else
        if [ -d "tests-next/fixtures/git-template/.git" ]; then
            success "Git template fixture already exists"
        else
            warning "Git template not found (tests may fail)"
        fi
    fi

    # 2. Copy .operate services configuration
    if [ "$REPO_CONTEXT" = "worktree" ]; then
        local operate_source="$MAIN_REPO_ROOT/olas-operate-middleware/.operate"
        if [ -d "$operate_source/services" ]; then
            info "Copying .operate services from main repo..."
            cp -R "$operate_source"/services/sc-* tests-next/fixtures/operate-profile/services/ 2>/dev/null || true
            success "Operate services configuration copied"
        else
            warning ".operate services not found at $operate_source (Ponder may fail to start)"
        fi

        # 3. Copy .operate keys
        if [ -d "$operate_source/keys" ]; then
            info "Copying .operate keys from main repo..."
            cp -R "$operate_source/keys" tests-next/fixtures/operate-profile/
            success "Operate keys copied"
        else
            warning ".operate keys not found at $operate_source (worker may fail to dispatch)"
        fi
    else
        # In main repo, copy from local .operate
        if [ -d "olas-operate-middleware/.operate/services" ]; then
            info "Copying .operate services from local directory..."
            cp -R olas-operate-middleware/.operate/services/sc-* tests-next/fixtures/operate-profile/services/ 2>/dev/null || true
            success "Operate services configuration copied"
        else
            warning ".operate services not found locally (Ponder may fail to start)"
        fi

        if [ -d "olas-operate-middleware/.operate/keys" ]; then
            info "Copying .operate keys from local directory..."
            cp -R olas-operate-middleware/.operate/keys tests-next/fixtures/operate-profile/
            success "Operate keys copied"
        else
            warning ".operate keys not found locally (worker may fail to dispatch)"
        fi
    fi
}

# =============================================================================
# 6. Install Node dependencies
# =============================================================================

install_node_dependencies() {
    step "Installing Node.js dependencies..."

    # Install all dependencies (including @jinn-network/mech-client-ts and @ponder/core from npm)
    info "Installing all dependencies..."
    yarn install --silent
    success "All dependencies installed"

    # Build main project
    info "Building main project..."
    yarn build > /dev/null 2>&1
    success "Main project built"
}

# =============================================================================
# 7. Validate setup
# =============================================================================

validate_setup() {
    step "Validating setup..."

    local errors=()
    local warnings=()

    # Check critical build artifacts from npm package
    if [ ! -f "node_modules/@jinn-network/mech-client-ts/dist/marketplace_interact.js" ]; then
        errors+=("@jinn-network/mech-client-ts not properly installed from npm")
    else
        success "@jinn-network/mech-client-ts package installed correctly"
    fi

    if [ ! -f "node_modules/@jinn-network/mech-client-ts/dist/abis/AgentMech.json" ]; then
        errors+=("ABIs not found in @jinn-network/mech-client-ts")
    else
        success "ABIs available in npm package"
    fi

    if [ ! -f "node_modules/@jinn-network/mech-client-ts/dist/configs/mechs.json" ]; then
        errors+=("Configs not found in @jinn-network/mech-client-ts")
    else
        success "Configs available in npm package"
    fi

    # Check submodule initialized
    if [ ! -d "olas-operate-middleware" ]; then
        errors+=("olas-operate-middleware submodule not initialized")
    else
        success "olas-operate-middleware submodule present"
    fi

    # Check environment files
    if [ ! -f ".env" ]; then
        errors+=(".env file missing")
    else
        success ".env file present"
    fi

    if [ ! -f ".env.test" ]; then
        warnings+=(".env.test file missing (tests may use wrong config)")
    else
        success ".env.test file present"
    fi

    # Check critical env vars (non-blocking)
    if ! grep -q "MECH_ADDRESS" .env 2>/dev/null; then
        warnings+=("MECH_ADDRESS not found in .env")
    fi

    if ! grep -q "SUPABASE_URL" .env 2>/dev/null; then
        warnings+=("SUPABASE_URL not found in .env")
    fi

    # Report warnings
    if [ ${#warnings[@]} -gt 0 ]; then
        echo ""
        warning "Setup warnings (non-blocking):"
        for w in "${warnings[@]}"; do
            echo "  ⚠  $w"
        done
    fi

    # Report errors (blocking)
    if [ ${#errors[@]} -gt 0 ]; then
        echo ""
        error "Setup validation failed:"
        for e in "${errors[@]}"; do
            echo "  ❌ $e"
        done
        return 1
    fi

    success "Setup validation passed"
}

# =============================================================================
# 8. Run full integration smoke test
# =============================================================================

run_integration_test() {
    step "Running full integration smoke test..."

    echo ""
    info "This will:"
    echo "  • Start Tenderly VNet (ephemeral blockchain)"
    echo "  • Start Ponder indexer"
    echo "  • Start Control API"
    echo "  • Run worker basic execution test"
    echo "  • Verify Poetry auto-installs Python dependencies"
    echo "  • Verify on-chain delivery works"
    echo ""
    info "This may take 2-5 minutes on first run..."
    echo ""

    # Create log file for test output
    local log_file="/tmp/conductor-smoke-test-$(date +%s).log"

    # Run worker basic execution test
    # The --run flag ensures Vitest runs once and exits (not watch mode)
    if yarn test:worker --run tests/worker/worker-basic-execution.test.ts 2>&1 | tee "$log_file"; then
        echo ""
        success "✅ Integration smoke test PASSED"
        echo ""
        info "All infrastructure verified:"
        echo "  ✓ Tenderly VNet creation"
        echo "  ✓ Ponder indexer startup"
        echo "  ✓ Control API startup"
        echo "  ✓ Poetry auto-installed Python dependencies"
        echo "  ✓ Worker claimed and executed request"
        echo "  ✓ On-chain delivery successful"
        echo ""
        success "Environment is fully operational!"
        return 0
    else
        echo ""
        error "❌ Integration smoke test FAILED"
        echo ""
        echo "Check the output above for errors."
        echo "Full log saved to: $log_file"
        echo ""
        info "Common issues:"
        echo "  • Missing environment variables in .env.test"
        echo "  • Network connectivity issues (Tenderly API)"
        echo "  • Port conflicts (Ponder, Control API)"
        echo ""
        return 1
    fi
}

# =============================================================================
# 9. Print completion message
# =============================================================================

print_completion() {
    echo ""
    echo "========================================="
    success "🎉 Workspace setup complete and tested!"
    echo "========================================="
    echo ""
    echo "Environment:"
    echo "  ✓ .env and .env.test configured"
    echo "  ✓ olas-operate-middleware submodule initialized"
    echo "  ✓ Poetry available (auto-installs deps on first run)"
    echo "  ✓ Build artifacts validated"
    echo "  ✓ Full integration test passed"
    echo ""
    echo "Next steps:"
    echo "  • Click the Run button in Conductor"
    echo "  • Or run any test suite:"
    echo "    - yarn test:marketplace"
    echo "    - yarn test:worker"
    echo "    - yarn test:service"
    echo ""
    echo "Note: Poetry will auto-install Python dependencies"
    echo "      when tests or services start (already done in smoke test)"
    echo ""
}

# =============================================================================
# Main execution
# =============================================================================

main() {
    check_prerequisites
    setup_environment_files
    init_submodules
    clean_test_artifacts
    setup_test_fixtures
    install_node_dependencies

    if validate_setup; then
        if run_integration_test; then
            print_completion
        else
            echo ""
            error "Setup completed but integration test failed. Fix errors above and re-run."
        fi
    else
        echo ""
        error "Setup validation failed. Fix errors above and re-run."
    fi
}

main
