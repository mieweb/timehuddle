#!/usr/bin/env bash

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_HOST="${MONGO_HOST:-mongodb://localhost:27017}"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   User Migration Script${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo

# Step 1: List available databases
echo -e "${BLUE}📋 Listing available databases...${NC}\n"
DB_LIST=$(mongosh "$MONGO_HOST" --quiet --eval "db.getMongo().getDBNames().join('\n')" 2>&1)

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Error: Could not connect to MongoDB at $MONGO_HOST${NC}"
  echo -e "${RED}   Make sure MongoDB is running and accessible.${NC}"
  exit 1
fi

echo -e "${GREEN}Available databases:${NC}"
echo "$DB_LIST" | while IFS= read -r db; do
  echo "  - $db"
done
echo

# Step 2: Prompt for database name
if [ -n "${TARGET_DB:-}" ]; then
  echo -e "${GREEN}Using database from environment: ${TARGET_DB}${NC}\n"
else
  echo -en "${YELLOW}Enter the name of your Meteor database: ${NC}"
  read TARGET_DB
  
  if [ -z "$TARGET_DB" ]; then
    echo -e "${RED}❌ Error: Database name cannot be empty${NC}"
    exit 1
  fi
  
  # Verify the database exists
  if ! echo "$DB_LIST" | grep -q "^${TARGET_DB}$"; then
    echo -e "${YELLOW}⚠️  Warning: Database '${TARGET_DB}' not found in the list above${NC}"
    echo -en "${YELLOW}Continue anyway? (y/N): ${NC}"
    read CONTINUE
    if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
      echo -e "${BLUE}Migration cancelled.${NC}"
      exit 0
    fi
  fi
fi

export MONGO_URL="${MONGO_HOST}/${TARGET_DB}"
echo -e "${GREEN}✓ Target database: ${TARGET_DB}${NC}"
echo -e "${GREEN}✓ Connection string: ${MONGO_URL}${NC}\n"

# Step 3: Run dry-run migration
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Step 1: Dry Run (Preview Changes)${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

cd "$SCRIPT_DIR/meteor-backend/scripts"

if ! node migrate-to-meteor-accounts.js --dry-run; then
  echo -e "\n${RED}❌ Error: Dry run failed${NC}"
  exit 1
fi

echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# Step 4: Ask for confirmation
echo -en "${YELLOW}The above is a preview. Proceed with actual migration? (y/N): ${NC}"
read CONFIRM

if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo -e "${BLUE}Migration cancelled.${NC}"
  exit 0
fi

# Step 5: Run actual migration
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Step 2: Running Migration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

if ! node migrate-to-meteor-accounts.js; then
  echo -e "\n${RED}❌ Error: Migration failed${NC}"
  exit 1
fi

# Step 6: Run verification
echo
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Step 3: Verifying Migration${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

if ! node verify-user-collections.js; then
  echo -e "\n${RED}❌ Error: Verification failed${NC}"
  exit 1
fi

# Success!
echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}   ✅ Migration Complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
