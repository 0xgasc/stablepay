# 🚨 CRITICAL SECURITY CLEANUP REQUIRED

## ⚠️ Your `.env` file with production credentials is in git history!

This means anyone with access to your repository can see:
- Database passwords
- API keys
- Private keys
- All secrets

---

## 🔧 STEP 1: Remove .env from Git History

You have two options:

### Option A: Using BFG Repo-Cleaner (Recommended - Faster)

```bash
# 1. Install BFG (if not installed)
# macOS:
brew install bfg

# 2. Backup your repo first!
cd /Users/gs/Desktop
cp -r stablepay stablepay-backup

# 3. Remove .env from history
cd stablepay
bfg --delete-files .env

# 4. Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 5. Force push (⚠️ WARNING: This rewrites history!)
git push origin --force --all
```

### Option B: Using git filter-repo (Alternative)

```bash
# 1. Install git-filter-repo
# macOS:
brew install git-filter-repo

# 2. Backup your repo first!
cd /Users/gs/Desktop
cp -r stablepay stablepay-backup

# 3. Remove .env from history
cd stablepay
git filter-repo --path .env --invert-paths

# 4. Force push
git push origin --force --all
```

---

## 🔐 STEP 2: Rotate ALL Credentials Immediately

### Supabase
1. Go to https://supabase.com/dashboard
2. Select your project: `lxbrsiujmntrvzqdphhj`
3. **Reset Database Password:**
   - Settings → Database → Reset Password
   - Update `DATABASE_URL` and `DIRECT_URL`
4. **Rotate API Keys (if possible):**
   - Settings → API → Generate new keys
   - Update `SUPABASE_ANON_KEY`

### JWT Secret
```bash
# Generate new JWT secret
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```
Copy output and update `JWT_SECRET` in `.env`

### Admin Password
```bash
# Generate new admin password
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```
Copy output and update `ADMIN_PASSWORD` in `.env`

### Private Key
```bash
# Generate new Ethereum private key
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Copy output and update `PRIVATE_KEY` in `.env`

---

## 🔄 STEP 3: Update Environment Variables

### Local Development
1. Create new `.env` file from template:
```bash
cp .env.example .env
```

2. Fill in your NEW credentials (from Step 2)

### Vercel Production
Update environment variables in Vercel:

```bash
# Set via Vercel CLI
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add SUPABASE_ANON_KEY
vercel env add DATABASE_URL
vercel env add JWT_SECRET
vercel env add ADMIN_PASSWORD
vercel env add ALLOWED_ORIGINS

# Or via Dashboard:
# https://vercel.com/your-team/stablepay/settings/environment-variables
```

---

## ✅ STEP 4: Verify Cleanup

```bash
# 1. Check that .env is not in current state
git ls-files | grep "\.env$"
# Should return nothing (only .env.example is ok)

# 2. Check git history for .env
git log --all --full-history -- .env
# Should say "fatal: ambiguous argument '.env': unknown revision"

# 3. Verify .env is ignored
git check-ignore -v .env
# Should show: .gitignore:14:.env	.env
```

---

## 📋 After Cleanup Checklist

- [ ] Removed .env from git history
- [ ] Force pushed to remote
- [ ] Rotated Supabase database password
- [ ] Generated new JWT secret
- [ ] Generated new admin password
- [ ] Generated new private key
- [ ] Updated local .env with new credentials
- [ ] Updated Vercel environment variables
- [ ] Tested login/registration works with new credentials
- [ ] Verified .env not in git history
- [ ] Deleted backup folder once confirmed working

---

## 🆘 Need Help?

If you need assistance or something breaks:
1. Don't panic - you have a backup at `/Users/gs/Desktop/stablepay-backup`
2. Check Vercel logs for deployment errors
3. Check Supabase logs for database connection issues

---

## 📝 Security Best Practices Going Forward

1. **Never** commit `.env` files
2. **Always** use `.env.example` for templates
3. Use Vercel/platform secrets for production
4. Rotate secrets every 90 days
5. Use different secrets for dev/staging/production
6. Enable 2FA on all services (GitHub, Vercel, Supabase)
