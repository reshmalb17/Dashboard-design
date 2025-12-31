# Configuration Guide

## Using Existing Server and Database

This React dashboard is configured to use the **existing Cloudflare Worker API and D1 database** from the `consentbit-dashboard-1` project.

### Server Configuration

- **API Base URL**: `https://consentbit-dashboard-test.web-8fb.workers.dev`
- **Database**: D1 database `consentbit-licenses` (same as original dashboard)
- **Worker Name**: `consentbit-dashboard-test`

### What This Means

✅ **No separate API setup needed** - The React app connects to the existing server  
✅ **Shared database** - All data (sites, licenses, users) is shared with the original dashboard  
✅ **Same authentication** - Uses the same Memberstack integration and session management  
✅ **Immediate access** - Your existing data will be available in the React dashboard  

### API Endpoints Used

The React app uses these endpoints from the existing server:

- `GET /dashboard?email={email}` - Fetch user's sites and subscriptions
- `GET /licenses?email={email}` - Fetch user's license keys  
- `POST /add-site` - Add a new site to user's subscription
- `POST /remove-site` - Remove a site from user's subscription

### CORS Configuration

The existing server already has CORS configured for:
- `https://memberstack-login-test-713fa5.webflow.io`
- `http://localhost:3000` (for development)
- `http://localhost:8080` (for development)

If you deploy to a new domain, you may need to update the CORS settings in the Worker.

### Environment Variables

The app uses these environment variables (all optional with defaults):

- `VITE_API_BASE` - API base URL (defaults to existing server)
- Memberstack App ID - Set in `index.html` (not an env var)

### Changing the Server URL

If you need to use a different server:

1. Create a `.env` file in the root directory
2. Set `VITE_API_BASE` to your server URL
3. Rebuild the app: `npm run build`

### Database Access

The database is managed by the Cloudflare Worker. The React app does not have direct database access - all operations go through the API endpoints.

