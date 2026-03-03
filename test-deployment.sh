#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "================================================"
echo "Pack50 Docker Deployment Test Script"
echo "================================================"
echo ""

# Function to print colored output
print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}➜ $1${NC}"
}

# Function to wait for service
wait_for_service() {
    local service=$1
    local max_attempts=30
    local attempt=0

    print_info "Waiting for $service to be healthy..."

    while [ $attempt -lt $max_attempts ]; do
        if docker compose -f docker-compose.test.yml ps $service | grep -q "healthy"; then
            print_success "$service is healthy"
            return 0
        fi

        attempt=$((attempt + 1))
        echo -n "."
        sleep 2
    done

    print_error "$service failed to become healthy"
    return 1
}

# Cleanup function
cleanup() {
    print_info "Cleaning up test environment..."
    docker compose -f docker-compose.test.yml down -v 2>/dev/null || true
    print_success "Cleanup complete"
}

# Trap to ensure cleanup on exit
trap cleanup EXIT

# Main test flow
main() {
    print_info "Step 1: Cleaning up any existing test containers..."
    cleanup
    echo ""

    print_info "Step 2: Building Docker image..."
    if docker compose -f docker-compose.test.yml build --no-cache; then
        print_success "Docker image built successfully"
    else
        print_error "Docker build failed"
        exit 1
    fi
    echo ""

    print_info "Step 3: Starting services..."
    if docker compose -f docker-compose.test.yml up -d; then
        print_success "Services started"
    else
        print_error "Failed to start services"
        exit 1
    fi
    echo ""

    print_info "Step 4: Waiting for PostgreSQL..."
    if wait_for_service postgres; then
        print_success "PostgreSQL is ready"
    else
        print_error "PostgreSQL failed to start"
        docker compose -f docker-compose.test.yml logs postgres
        exit 1
    fi
    echo ""

    print_info "Step 5: Waiting for Redis..."
    if wait_for_service redis; then
        print_success "Redis is ready"
    else
        print_error "Redis failed to start"
        docker compose -f docker-compose.test.yml logs redis
        exit 1
    fi
    echo ""

    print_info "Step 6: Waiting for Bot application..."
    sleep 10  # Give bot extra time to initialize

    if docker compose -f docker-compose.test.yml ps bot | grep -q "Up"; then
        print_success "Bot container is running"
    else
        print_error "Bot container failed to start"
        docker compose -f docker-compose.test.yml logs bot
        exit 1
    fi
    echo ""

    print_info "Step 7: Testing health endpoint..."
    sleep 5  # Extra wait for app to be fully ready

    if curl -f http://localhost:23000/health -o /dev/null -s; then
        print_success "Health endpoint responded successfully"
        echo ""
        echo "Response:"
        curl -s http://localhost:23000/health | python3 -m json.tool || curl -s http://localhost:23000/health
    else
        print_error "Health endpoint failed to respond"
        echo ""
        print_info "Bot logs:"
        docker compose -f docker-compose.test.yml logs bot | tail -50
        exit 1
    fi
    echo ""

    print_info "Step 8: Checking PostgreSQL connection..."
    if docker compose -f docker-compose.test.yml exec -T postgres psql -U pack50_test -d pack50_test -c "SELECT version();" > /dev/null 2>&1; then
        print_success "PostgreSQL connection successful"
    else
        print_error "Failed to connect to PostgreSQL"
        exit 1
    fi
    echo ""

    print_info "Step 9: Checking Redis connection..."
    if docker compose -f docker-compose.test.yml exec -T redis redis-cli ping | grep -q "PONG"; then
        print_success "Redis connection successful"
    else
        print_error "Failed to connect to Redis"
        exit 1
    fi
    echo ""

    print_info "Step 10: Checking pgvector extension..."
    if docker compose -f docker-compose.test.yml exec -T postgres psql -U pack50_test -d pack50_test -c "SELECT * FROM pg_extension WHERE extname = 'vector';" | grep -q "vector"; then
        print_success "pgvector extension is installed"
    else
        print_error "pgvector extension not found"
        exit 1
    fi
    echo ""

    print_info "Step 11: Checking database tables..."
    table_count=$(docker compose -f docker-compose.test.yml exec -T postgres psql -U pack50_test -d pack50_test -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')

    if [ "$table_count" -gt 0 ]; then
        print_success "Database tables created ($table_count tables)"
    else
        print_error "No database tables found"
        exit 1
    fi
    echo ""

    print_info "Step 12: Viewing container resource usage..."
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}" \
        pack50_test_bot pack50_test_postgres pack50_test_redis
    echo ""

    echo "================================================"
    print_success "ALL TESTS PASSED!"
    echo "================================================"
    echo ""
    print_info "Test environment is still running. You can:"
    echo "  - View logs: docker compose -f docker-compose.test.yml logs -f"
    echo "  - Access bot: http://localhost:23000"
    echo "  - Stop test: docker compose -f docker-compose.test.yml down -v"
    echo ""

    # Keep containers running for manual inspection
    read -p "Press Enter to stop test environment and cleanup..."
}

# Run main function
main
