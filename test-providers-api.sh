#!/bin/bash

# Test script for new providers API

echo "🧪 Testing Providers API"
echo "========================"
echo ""

# Login
echo "1. Logging in..."
TOKEN=$(curl -s -X POST http://localhost:3000/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | jq -r .token)

if [ "$TOKEN" = "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Login failed"
  exit 1
fi

echo "✅ Login successful"
echo ""

# List providers
echo "2. Listing providers..."
curl -s http://localhost:3000/api/providers \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Create test provider
echo "3. Creating test provider..."
PROVIDER_ID=$(curl -s -X POST http://localhost:3000/api/providers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Provider",
    "provider_type": "openai",
    "api_key": "test-key-123",
    "api_base_url": "https://api.example.com/v1",
    "model_name": "gpt-4o-test",
    "is_active": false
  }' | jq -r .id)

if [ "$PROVIDER_ID" = "null" ] || [ -z "$PROVIDER_ID" ]; then
  echo "❌ Failed to create provider"
else
  echo "✅ Provider created with ID: $PROVIDER_ID"
fi
echo ""

# Get single provider
echo "4. Getting provider details..."
curl -s http://localhost:3000/api/providers/$PROVIDER_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Update provider
echo "5. Updating provider..."
curl -s -X PUT http://localhost:3000/api/providers/$PROVIDER_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Provider Updated",
    "model_name": "gpt-4o-mini"
  }' | jq .
echo ""

# Activate provider
echo "6. Activating provider..."
curl -s -X POST http://localhost:3000/api/providers/$PROVIDER_ID/activate \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# List providers again
echo "7. Listing providers (should show as active)..."
curl -s http://localhost:3000/api/providers \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Delete provider
echo "8. Deleting test provider..."
curl -s -X DELETE http://localhost:3000/api/providers/$PROVIDER_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

# Final list
echo "9. Final provider list..."
curl -s http://localhost:3000/api/providers \
  -H "Authorization: Bearer $TOKEN" | jq .
echo ""

echo "✅ All tests completed!"
