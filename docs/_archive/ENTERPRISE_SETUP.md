# StablePay Enterprise Multi-Tenant Setup

## Overview
Your StablePay platform is now enterprise-ready with full multi-tenant capabilities. You can manage multiple merchant customers from a central admin panel.

## New Features Added

### 1. Enterprise Admin Dashboard
**URL:** `https://stablepay-nine.vercel.app/enterprise-admin.html`

**Login Credentials:**
- Email: `admin@stablepay.com`
- Password: `admin123`

**Features:**
- View all merchant accounts
- Monitor orders across all merchants
- Platform-wide analytics
- Add/manage merchant accounts
- Enable/disable merchants
- View per-merchant revenue and stats

### 2. Merchant Onboarding Portal
**URL:** `https://stablepay-nine.vercel.app/onboard-merchant.html`

**Features:**
- 3-step guided onboarding
- Company information collection
- Multi-chain wallet setup
- Automatic plan assignment
- Email notifications (coming soon)

### 3. Enhanced Database Schema
**New additions:**
- `ApiKey` model for merchant API key management
- Merchant fields: `website`, `industry`, `monthlyVolume`, `notes`
- Better relationship tracking

## API Endpoints

### Admin Merchant Management
**GET** `/api/v1/admin/merchants`
- List all merchants with stats
- Requires: `Authorization: Bearer admin-token`

**POST** `/api/v1/admin/merchants`
- Create new merchant account
- Returns temporary password
- Body: `{ email, companyName, contactName, plan, networkMode, ... }`

**PUT** `/api/v1/admin/merchants`
- Update merchant details
- Body: `{ merchantId, ...updateData }`

**DELETE** `/api/v1/admin/merchants`
- Deactivate merchant (soft delete)
- Body: `{ merchantId }`

### Admin Orders
**GET** `/api/v1/admin/orders`
- View all platform orders
- Supports filtering: `?merchantId=xxx&status=CONFIRMED&chain=BASE_SEPOLIA`

### Admin Analytics
**GET** `/api/v1/admin/analytics`
- Platform-wide statistics
- Revenue by merchant
- Daily revenue trends
- Order counts and averages

## Setup Instructions

### 1. Update Database Schema
```bash
# Generate Prisma client with new schema
npx prisma generate

# Push schema changes to database
npx prisma db push
```

### 2. Deploy to Vercel
```bash
# Login to Vercel
vercel login

# Deploy
vercel --prod
```

### 3. Test Locally
```bash
# Start development server
npm run dev

# Access admin dashboard
open http://localhost:3000/enterprise-admin.html

# Access onboarding
open http://localhost:3000/onboard-merchant.html
```

## Workflow: Adding Your First Customer

1. **Go to Enterprise Admin**
   - Navigate to `/enterprise-admin.html`
   - Login with admin credentials

2. **Add New Merchant**
   - Click "Add Merchant" button
   - Fill in company details
   - Select plan tier (Starter/Growth/Enterprise)
   - Choose network mode (Testnet/Mainnet)
   - Click "Create Merchant"

3. **Get Credentials**
   - System generates temporary password
   - Share credentials with customer (via email/secure channel)
   - Customer logs in at `/login.html`

4. **Customer Completes Setup**
   - Customer adds wallet addresses
   - Configures payment settings
   - Generates API keys in Developer Console

5. **Monitor from Admin Panel**
   - View customer's orders in "All Orders" tab
   - Check revenue in "Platform Analytics"
   - Impersonate view by clicking "View" on merchant

## Multi-Tenant Architecture

### Data Isolation
- Each merchant has unique `merchantId`
- Orders are scoped to merchant via `merchantId` field
- API keys tied to specific merchants
- Wallets are merchant-specific

### Admin Access Levels
- **Super Admin**: Full platform access (enterprise-admin.html)
- **Merchant**: Own data only (dashboard.html)

### Security
- Merchants can only see their own orders
- Admin endpoints require Bearer token
- Password hashing with bcrypt
- Session-based authentication

## Page Reference

| Page | URL | Purpose | Access |
|------|-----|---------|--------|
| Enterprise Admin | `/enterprise-admin.html` | Manage all merchants | Super Admin |
| Merchant Onboarding | `/onboard-merchant.html` | New customer signup | Public |
| Merchant Login | `/login.html` | Merchant login | Merchants |
| Merchant Dashboard | `/dashboard.html` | Individual merchant view | Merchants |
| Developer Console | `/developer-dashboard.html` | API key management | Merchants |
| Old Admin Panel | `/admin.html` | Legacy global view | Admin |

## Next Steps

### Immediate
1. ✅ Push database schema: `npx prisma db push`
2. ✅ Test adding a merchant locally
3. ✅ Deploy to Vercel
4. ✅ Test in production

### Short-term Enhancements
- [ ] Email notifications for new merchants
- [ ] Automated API key generation on signup
- [ ] Merchant invitation system
- [ ] Webhook configuration per merchant
- [ ] Custom branding per merchant

### Long-term
- [ ] Merchant self-service onboarding (no admin needed)
- [ ] Billing and subscription management
- [ ] Advanced analytics and reporting
- [ ] White-label capabilities
- [ ] Multi-user accounts per merchant

## Support

For questions or issues:
- Check logs in Vercel dashboard
- Review Prisma queries in API endpoints
- Test API endpoints with Postman/curl
- Check browser console for frontend errors

## Security Notes

⚠️ **Important:**
- Change default admin credentials before production
- Implement proper JWT authentication for admin endpoints
- Use environment variables for admin credentials
- Enable rate limiting on admin endpoints
- Set up proper CORS origins
- Rotate API keys regularly

## Migration from Old Admin Panel

The old `admin.html` shows all orders globally without merchant filtering. The new `enterprise-admin.html` provides:
- Better merchant management
- Per-merchant analytics
- Customer onboarding
- API key management
- Platform-wide statistics

You can keep both panels or retire the old one once you've migrated your workflow.
