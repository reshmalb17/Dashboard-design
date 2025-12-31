# Consent React Dashboard

A React-based dashboard for managing sites and license keys, built for Cloudflare Pages with Memberstack authentication integration.

**✅ Uses existing server and database** - This React app connects to the same Cloudflare Worker API (`consentbit-dashboard-test`) and D1 database as the original dashboard.

## Features

- 🔐 Memberstack authentication integration
- 🌐 Site management (add/remove sites)
- 🔑 License key display and copying
- 📱 Responsive design
- ⚡ Fast and modern React implementation
- 🔗 Connects to existing API and database

## Prerequisites

- Node.js 18+ and npm
- Memberstack account and app ID
- Cloudflare Pages account (for deployment)
- **Existing server is already configured** - No API setup needed!

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables (Optional)

The app is pre-configured to use the existing server. If you need to override it, create a `.env` file:

```env
VITE_API_BASE=https://consentbit-dashboard-test.web-8fb.workers.dev
```

**Note:** The default API URL is already set to the existing server, so you can skip this step unless you have a different server URL.

### 3. Configure Memberstack

Update `index.html` with your Memberstack App ID:

```html
<script data-memberstack-app="YOUR_MEMBERSTACK_APP_ID" src="https://api.memberstack.com/static/js/v2/memberstack.js"></script>
```

Replace `YOUR_MEMBERSTACK_APP_ID` with your actual Memberstack application ID.

## Development

Run the development server:

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

## Building for Production

Build the project:

```bash
npm run build
```

The built files will be in the `dist` directory.

## Deployment to Cloudflare Pages

### Option 1: Using Wrangler CLI

1. Install Wrangler (if not already installed):
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Deploy:
   ```bash
   npm run build
   wrangler pages deploy dist
   ```

### Option 2: Using Git Integration

1. Push your code to a Git repository (GitHub, GitLab, etc.)

2. In Cloudflare Dashboard:
   - Go to Pages
   - Click "Create a project"
   - Connect your Git repository
   - Set build settings:
     - Build command: `npm run build`
     - Build output directory: `dist`
   - Add environment variables:
     - `VITE_API_BASE`: Your API base URL

3. Deploy!

## Project Structure

```
Consent-React/
├── src/
│   ├── components/       # React components
│   │   ├── Sites.jsx     # Site management component
│   │   ├── Licenses.jsx # License keys display
│   │   └── LoginPrompt.jsx
│   ├── hooks/           # Custom React hooks
│   │   └── useMemberstack.js
│   ├── services/        # API and service layer
│   │   ├── api.js       # API service
│   │   └── memberstack.js # Memberstack integration
│   ├── App.jsx          # Main app component
│   ├── App.css          # App styles
│   ├── main.jsx         # Entry point
│   └── index.css        # Global styles
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

## API Integration

The dashboard communicates with the **existing Cloudflare Worker API** (`consentbit-dashboard-test.web-8fb.workers.dev`) which uses the same D1 database as the original dashboard.

The API endpoints used are:

- `GET /dashboard?email={email}` - Get user's sites and subscriptions
- `GET /licenses?email={email}` - Get user's license keys
- `POST /add-site` - Add a new site
- `POST /remove-site` - Remove a site

**Database:** Uses the same D1 database (`consentbit-licenses`) as the original dashboard, so all data is shared.

Authentication is handled via:
1. Email parameter (primary method for Memberstack users)
2. Session cookie (`sb_session`) as fallback

## Memberstack Session Management

The app handles Memberstack authentication by:

1. Checking for Memberstack SDK on page load
2. Verifying user session via `getCurrentMember()`
3. Using user email for API authentication
4. Managing session cookies for API requests
5. Handling logout and redirects

## Troubleshooting

### Memberstack SDK not loading

- Ensure the Memberstack script tag is in `index.html`
- Check that your Memberstack App ID is correct
- Verify the script loads before React initializes

### API errors

- Check that `VITE_API_BASE` is set correctly
- Verify CORS settings on your API
- Check browser console for detailed error messages

### Build errors

- Ensure all dependencies are installed: `npm install`
- Check Node.js version (18+ required)
- Clear cache: `rm -rf node_modules package-lock.json && npm install`

## License

Private project - All rights reserved

