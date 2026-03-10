#!/bin/bash

# Simplified build script - Cal.com + API v2 only
# Usage: ./build-simple.sh [version]
# Example: ./build-simple.sh v5.6.10

VERSION=${1:-v5.6.10}
DOCKER_HUB_USER="kaumudpa"

echo "Building Cal.com and API v2 - Version: $VERSION"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to check if command succeeded
check_status() {
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓ $1 succeeded${NC}"
    else
        echo -e "${RED}✗ $1 failed${NC}"
        echo -e "${RED}Error details above. Stopping build process.${NC}"
        exit 1
    fi
}

# Step 1: Build main Cal.com image
echo -e "${YELLOW}Step 1: Building main Cal.com image...${NC}"
sudo DOCKER_BUILDKIT=1 docker compose build calcom
check_status "Main Cal.com build"

echo -e "${YELLOW}Tagging main image...${NC}"
sudo docker tag calcom.docker.scarf.sh/calcom/cal.com ${DOCKER_HUB_USER}/calcom:${VERSION}
check_status "Main Cal.com tag"

# Step 2: Build API v2
echo -e "${YELLOW}Step 2: Building API v2...${NC}"
sudo DOCKER_BUILDKIT=1 docker build \
  -f apps/api/v2/Dockerfile \
  -t ${DOCKER_HUB_USER}/calcom-api-v2:${VERSION} \
  --build-arg DATABASE_URL="postgresql://postgres:postgres@localhost:5432/calendso" \
  --build-arg DATABASE_DIRECT_URL="postgresql://postgres:postgres@localhost:5432/calendso" \
  .
check_status "API v2 build"

echo -e "${GREEN}✅ Build completed successfully!${NC}"
echo ""
echo -e "${YELLOW}Now pushing images to Docker Hub...${NC}"

# Push images
echo -e "${YELLOW}Pushing main Cal.com...${NC}"
sudo docker push ${DOCKER_HUB_USER}/calcom:${VERSION}
check_status "Push main Cal.com"

echo -e "${YELLOW}Pushing API v2...${NC}"
sudo docker push ${DOCKER_HUB_USER}/calcom-api-v2:${VERSION}
check_status "Push API v2"

echo -e "${GREEN}✅ All images built and pushed successfully!${NC}"
echo ""
echo "Images available on Docker Hub:"
echo "  - ${DOCKER_HUB_USER}/calcom:${VERSION}"
echo "  - ${DOCKER_HUB_USER}/calcom-api-v2:${VERSION}"
echo ""
echo "Ready for deployment on CasaOS!"