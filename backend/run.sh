#!/bin/bash
# Decent-Hospital Backend Run Script
# 
# Usage:
#   ./run.sh           # Start in development mode
#   ./run.sh prod      # Start in production mode
#   ./run.sh test      # Run tests
#   ./run.sh docker    # Build and run Docker container

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs)
fi

# Default values
HOST="${BACKEND_HOST:-0.0.0.0}"
PORT="${BACKEND_PORT:-8000}"

case "${1:-dev}" in
    dev|development)
        echo -e "${GREEN}Starting backend in development mode...${NC}"
        echo "Host: $HOST, Port: $PORT"
        uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
        ;;
        
    prod|production)
        echo -e "${GREEN}Starting backend in production mode...${NC}"
        echo "Host: $HOST, Port: $PORT"
        uvicorn app.main:app --host "$HOST" --port "$PORT" --workers 4
        ;;
        
    test)
        echo -e "${YELLOW}Running tests...${NC}"
        pytest tests/ -v --tb=short
        ;;
        
    test-cov|coverage)
        echo -e "${YELLOW}Running tests with coverage...${NC}"
        pytest tests/ -v --cov=app --cov-report=html --cov-report=term
        ;;
        
    docker|docker-build)
        echo -e "${GREEN}Building Docker image...${NC}"
        docker build -t decent-hospital-backend:latest .
        echo -e "${GREEN}Running Docker container...${NC}"
        docker run -p 8000:8000 \
            -e DEV_MODE=true \
            -e JWT_SECRET="${JWT_SECRET:-dev-secret}" \
            -e STORACHA_API_KEY="${STORACHA_API_KEY:-}" \
            decent-hospital-backend:latest
        ;;
        
    seed)
        echo -e "${GREEN}Running seed script...${NC}"
        python ../scripts/seed.py "$@"
        ;;
        
    install|setup)
        echo -e "${GREEN}Installing dependencies...${NC}"
        pip install -r requirements.txt
        echo -e "${GREEN}Dependencies installed!${NC}"
        ;;
        
    *)
        echo "Decent-Hospital Backend Run Script"
        echo ""
        echo "Usage: $0 [command]"
        echo ""
        echo "Commands:"
        echo "  dev, development  Start in development mode with hot reload (default)"
        echo "  prod, production  Start in production mode with multiple workers"
        echo "  test              Run pytest test suite"
        echo "  test-cov          Run tests with coverage report"
        echo "  docker            Build and run Docker container"
        echo "  seed              Run seed script to create invite codes"
        echo "  install, setup    Install Python dependencies"
        echo ""
        echo "Environment Variables:"
        echo "  BACKEND_HOST      Host to bind to (default: 0.0.0.0)"
        echo "  BACKEND_PORT      Port to listen on (default: 8000)"
        echo "  DEV_MODE          Enable development features (default: false)"
        echo "  JWT_SECRET        Secret key for JWT tokens"
        echo "  STORACHA_API_KEY  API key for Storacha/web3.storage"
        ;;
esac
