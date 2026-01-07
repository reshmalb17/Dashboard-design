# Memberstack Production Setup Guide

## Required Data for Production Memberstack Integration

### 1. Frontend Configuration (React App)

#### Environment Variables Needed:
- **`VITE_MEMBERSTACK_PUBLIC_KEY`** - Production Memberstack Public Key
  - Format: `pk_live_xxxxxxxxxxxxx` (production keys start with `pk_live_`)
  - Current test key: `pk_sb_1f9717616667ce56e24c` (test keys start with `pk_sb_`)
  - Location: Get from Memberstack Dashboard → Settings → API Keys → Public Key (Live Mode)
  - **Note**: Frontend ONLY needs public key, no secret key needed

#### Files to Update:
1. **`.env.production`** (create if doesn't exist):
   ```env
   VITE_MEMBERSTACK_PUBLIC_KEY=pk_live_YOUR_PRODUCTION_PUBLIC_KEY
   VITE_API_BASE=https://your-production-api-url.workers.dev
   ```

2. **`ConsentBit-Dashboard-React/src/services/memberstack.js`** (line 35):
   - Already configured to use environment variable: `import.meta.env.VITE_MEMBERSTACK_PUBLIC_KEY`
   - Fallback will be used if env var not set, so make sure to set it in production

---

### 2. Backend Configuration (Cloudflare Worker)

#### Environment Variables Needed:

1. **`MEMBERSTACK_REDIRECT_URL`** - Production Dashboard URL (Required)
   - **Set to**: `https://dashboard.consentbit.com/`
   - This is your single URL that handles:
     - ✅ Login form (when not authenticated)
     - ✅ Dashboard (when authenticated)
     - ✅ After logout (redirects back to show login form)
   - The app automatically shows login or dashboard based on authentication state

2. **`MEMBERSTACK_SECRET_KEY`** - Production Memberstack Admin Secret Key (Optional)
   - **Only needed if**: You use `/memberstack-webhook` endpoint or programmatically create members
   - Format: `sk_xxxxxxxxxxxxx` (production keys start with `sk_`)
   - Current test key format: `sk_sb_xxxxx` (test keys start with `sk_sb_`)
   - Location: Get from Memberstack Dashboard → Settings → API Keys → Secret Key (Live Mode)
   - **Security**: Never commit this to version control!
   - **Note**: If users are created manually in Memberstack, you don't need this

3. **`MEMBERSTACK_LOGIN_URL`** (Optional) - Production Login Page URL
   - Example: `https://yourdomain.com/login`
   - Used for passwordless magic link login flow

4. **`MEMBERSTACK_PLAN_ID`** (Optional) - Production Plan ID
   - If you want to auto-assign a plan to users after purchase
   - Get from Memberstack Dashboard → Plans → Select Plan → Copy Plan ID

#### Files to Update:
1. **`consentbit-dashboard-1/wrangler.toml`** (or Cloudflare Dashboard):
   ```toml
   [env.production]
   MEMBERSTACK_SECRET_KEY = "sk_YOUR_PRODUCTION_SECRET_KEY"
   MEMBERSTACK_REDIRECT_URL = "https://dashboard.consentbit.com/"
   MEMBERSTACK_LOGIN_URL = "https://yourdomain.com/login"  # Optional
   MEMBERSTACK_PLAN_ID = "plan_xxxxxxxxxxxxx"  # Optional
   ```

2. **`consentbit-dashboard-1/src/index.js`**:
   - Already configured to use environment variables
   - No code changes needed, just update env vars

---

## How to Get Production Keys from Memberstack

### Step 1: Access Memberstack Dashboard
1. Go to [Memberstack Dashboard](https://dashboard.memberstack.com/)
2. Log in with your production account
3. Select your production app (not test app)

### Step 2: Get Public Key (Frontend)
1. Navigate to **Settings** → **API Keys**
2. Find **Public Key** section
3. Switch to **Live Mode** (not Test Mode)
4. Copy the public key (starts with `pk_live_`)

### Step 3: Get Secret Key (Backend)
1. In the same **Settings** → **API Keys** page
2. Find **Secret Key** section
3. Switch to **Live Mode** (not Test Mode)
4. Copy the secret key (starts with `sk_`)
5. **⚠️ WARNING**: Keep this secret! Never expose it in frontend code or commit to git.

### Step 4: Get Plan ID (Optional)
1. Navigate to **Plans** in Memberstack Dashboard
2. Select the plan you want to assign
3. Copy the Plan ID from the URL or plan details

---

## Deployment Steps

### Frontend (React App):
1. Create `.env.production` file:
   ```env
   VITE_MEMBERSTACK_PUBLIC_KEY=pk_live_YOUR_PRODUCTION_KEY
   VITE_API_BASE=https://your-production-api.workers.dev
   ```

2. Build for production:
   ```bash
   npm run build
   ```

3. Deploy to your hosting (Vercel, Netlify, etc.)
   - Make sure to set environment variables in your hosting platform
   - Set `VITE_MEMBERSTACK_PUBLIC_KEY` in production environment

### Backend (Cloudflare Worker):
1. Update `wrangler.toml` with production environment variables
2. Or set them in Cloudflare Dashboard → Workers → Your Worker → Settings → Environment Variables
3. Deploy:
   ```bash
   npm run deploy
   ```

---

## Testing Production Setup

1. **Test Login Flow**:
   - Try logging in with a production Memberstack account
   - Verify session persists correctly
   - Check that cookies are set properly

2. **Test Logout Flow**:
   - Click logout button
   - Verify all session data is cleared
   - Verify redirect to login page

3. **Test Session Duration**:
   - Currently set to 7 days (`sessionDurationDays: 7`)
   - Verify session persists across browser restarts

---

## Current Configuration Summary

### Test Configuration (Current):
- **Public Key**: `pk_sb_1f9717616667ce56e24c` (test)
- **Secret Key**: `sk_sb_898df6437a559447ed3` (test - for Use Case 1 member creation)
- **Session Duration**: 7 days
- **Redirect URL**: `https://dashboard.consentbit.com/`

### Production Configuration (To Set):
- **Public Key**: `pk_live_xxxxxxxxxxxxx` (get from Memberstack - REQUIRED)
- **Secret Key**: `sk_xxxxxxxxxxxxx` (get from Memberstack - REQUIRED for Use Case 1)
- **Session Duration**: 7 days (same)
- **Redirect URL**: `https://dashboard.consentbit.com/` (same)

---

## Important Notes

1. **Never mix test and production keys** - Always use production keys in production environment
2. **Secret keys are sensitive** - Never commit them to git or expose in frontend
3. **Test thoroughly** - Test login/logout flows before going live
4. **Session duration** - Currently 7 days, adjust if needed in `memberstack.js` line 51
5. **CORS settings** - Make sure production API URL is added to allowed origins if needed

---

## Troubleshooting

### Issue: "Invalid public key"
- **Solution**: Make sure you're using the Live Mode public key, not Test Mode
- Check that the key starts with `pk_live_` for production

### Issue: "Authentication failed"
- **Solution**: Verify both frontend and backend are using production keys
- Check that `MEMBERSTACK_SECRET_KEY` is set correctly in backend

### Issue: "Session not persisting"
- **Solution**: Check cookie settings (`useCookies: true`, `setCookieOnRootDomain: true`)
- Verify domain settings match your production domain
