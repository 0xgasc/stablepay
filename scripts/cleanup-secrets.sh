#!/bin/bash

# StablePay Security Cleanup Script
# This automates the security cleanup process

set -e  # Exit on error

echo ""
echo "🔒 StablePay Security Cleanup Wizard"
echo "===================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Please run this from the stablepay root directory"
    exit 1
fi

# Warning
echo "⚠️  WARNING: This script will:"
echo "   1. Remove .env from git history (rewrites history)"
echo "   2. Generate new secrets"
echo "   3. Create a new .env file"
echo "   4. Require you to update Supabase credentials manually"
echo ""
read -p "Do you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Aborted"
    exit 0
fi

echo ""
echo "📦 Step 1: Checking dependencies..."

# Check for BFG
if ! command -v bfg &> /dev/null; then
    echo "⚠️  BFG not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install bfg
    else
        echo "❌ Homebrew not found. Please install BFG manually:"
        echo "   https://rtyley.github.io/bfg-repo-cleaner/"
        exit 1
    fi
fi

echo "✅ Dependencies OK"
echo ""

# Backup
echo "📋 Step 2: Creating backup..."
BACKUP_DIR="../stablepay-backup-$(date +%Y%m%d-%H%M%S)"
cp -r . "$BACKUP_DIR"
echo "✅ Backup created at: $BACKUP_DIR"
echo ""

# Check if .env exists in history
echo "🔍 Step 3: Checking if .env exists in git history..."
if git log --all --full-history --oneline -- .env 2>&1 | grep -q "^[a-f0-9]"; then
    echo "⚠️  Found .env in git history. Removing..."

    # Remove .env from history
    bfg --delete-files .env
    git reflog expire --expire=now --all
    git gc --prune=now --aggressive

    echo "✅ .env removed from git history"
    echo ""
    echo "⚠️  IMPORTANT: You MUST force push to update remote:"
    echo "   git push origin --force --all"
    echo ""
    read -p "Push to remote now? (yes/no): " push_confirm

    if [ "$push_confirm" = "yes" ]; then
        git push origin --force --all
        echo "✅ Pushed to remote"
    else
        echo "⚠️  Remember to push later: git push origin --force --all"
    fi
else
    echo "✅ .env not found in git history (already clean)"
fi

echo ""
echo "🔐 Step 4: Generating new secrets..."
node scripts/generate-secrets.js > .secrets-temp.txt

# Parse the generated secrets
JWT_SECRET=$(grep -A 1 "JWT_SECRET" .secrets-temp.txt | tail -1)
ADMIN_PASSWORD=$(grep -A 1 "ADMIN_PASSWORD" .secrets-temp.txt | tail -1)
PRIVATE_KEY=$(grep -A 1 "PRIVATE_KEY" .secrets-temp.txt | tail -1)

echo "✅ New secrets generated"
echo ""

# Create new .env file
echo "📝 Step 5: Creating new .env file..."

cat > .env << EOL
# ===================================================================
# STABLEPAY ENVIRONMENT VARIABLES - GENERATED $(date)
# ===================================================================

# Database - Supabase PostgreSQL
# ⚠️  ACTION REQUIRED: Update these with NEW credentials from Supabase
# Go to: https://supabase.com/dashboard/project/_/settings/database
DATABASE_URL="REPLACE_ME_FROM_SUPABASE"
DIRECT_URL="REPLACE_ME_FROM_SUPABASE"

# Supabase Credentials
# ⚠️  ACTION REQUIRED: Get from Supabase dashboard
NEXT_PUBLIC_SUPABASE_URL="https://lxbrsiujmntrvzqdphhj.supabase.co"
SUPABASE_ANON_KEY="REPLACE_ME_FROM_SUPABASE"

# Server Configuration
PORT=3000
NODE_ENV=development

# CORS - Allowed Origins
ALLOWED_ORIGINS="http://localhost:3000,https://stablepay-nine.vercel.app"

# TESTNET Configuration
BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
ETHEREUM_SEPOLIA_RPC_URL="https://eth-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY"

# USDC Testnet Contract Addresses
USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
USDC_ETHEREUM_SEPOLIA="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"

# Payment Addresses
PAYMENT_ADDRESS_BASE_SEPOLIA="0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF"
PAYMENT_ADDRESS_ETHEREUM_SEPOLIA="0x2e8D1eAd7Ba51e04c2A8ec40a8A3eD49CC4E1ceF"

# Private Key - AUTO GENERATED
PRIVATE_KEY="$PRIVATE_KEY"

# Security Secrets - AUTO GENERATED
JWT_SECRET="$JWT_SECRET"
ADMIN_PASSWORD="$ADMIN_PASSWORD"
EOL

echo "✅ New .env file created"
echo ""

# Clean up temp file
rm .secrets-temp.txt

# Summary
echo ""
echo "✅ CLEANUP COMPLETE!"
echo "==================="
echo ""
echo "📋 What was done:"
echo "   ✅ Removed .env from git history"
echo "   ✅ Generated new secrets (JWT, admin password, private key)"
echo "   ✅ Created new .env file"
echo ""
echo "⚠️  MANUAL STEPS REQUIRED:"
echo ""
echo "1. 🔑 Rotate Supabase Credentials:"
echo "   → Go to: https://supabase.com/dashboard/project/lxbrsiujmntrvzqdphhj/settings/database"
echo "   → Click 'Reset database password'"
echo "   → Copy new DATABASE_URL and DIRECT_URL to .env"
echo ""
echo "   → Go to: https://supabase.com/dashboard/project/lxbrsiujmntrvzqdphhj/settings/api"
echo "   → Copy SUPABASE_ANON_KEY to .env (or rotate if needed)"
echo ""
echo "2. 🌐 Update Vercel Environment Variables:"
echo "   → Go to: https://vercel.com/settings/environment-variables"
echo "   → Update all variables with values from your new .env"
echo ""
echo "3. 🧪 Test locally:"
echo "   npm run dev"
echo "   → Test login/registration"
echo ""
echo "4. 🗑️  Delete backup (after confirming everything works):"
echo "   rm -rf $BACKUP_DIR"
echo ""
echo "Your new admin password: $ADMIN_PASSWORD"
echo "(Save this in your password manager!)"
echo ""
