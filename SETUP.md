# Quick Setup Guide

## 1. Install Dependencies

```bash
cd Consent-React
npm install
```

## 2. Configure Environment Variables (Optional)

The app is **pre-configured** to use the existing server (`https://consentbit-dashboard-test.web-8fb.workers.dev`), so you can skip this step unless you need a different API URL.

If you need to override it, create a `.env` file:

```bash
# Only needed if using a different server
VITE_API_BASE=https://consentbit-dashboard-test.web-8fb.workers.dev
```

**Note:** The React app uses the same server and database as the original dashboard, so all your data will be available immediately!

## 3. Configure Memberstack

Edit `index.html` and replace `YOUR_MEMBERSTACK_APP_ID` with your actual Memberstack App ID:

```html
<script data-memberstack-app="YOUR_ACTUAL_APP_ID" src="https://api.memberstack.com/static/js/v2/memberstack.js"></script>
```

You can find your App ID in your Memberstack dashboard under Settings → API.

## 4. Run Development Server

```bash
npm run dev
```

The app will open at `http://localhost:3000`

## 5. Build for Production

```bash
npm run build
```

The built files will be in the `dist` directory, ready for deployment.

## 6. Deploy to Cloudflare Pages

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

## Features

✅ Memberstack authentication integration  
✅ Session management via cookies  
✅ Site management (add/remove)  
✅ License key display and copying  
✅ Responsive design matching original dashboard  
✅ Error handling and loading states  

## Project Structure

- `src/components/` - React components (Sites, Licenses, LoginPrompt)
- `src/hooks/` - Custom React hooks (useMemberstack)
- `src/services/` - API and Memberstack integration services
- `src/App.jsx` - Main application component
- `public/` - Static assets

## Troubleshooting

### Memberstack SDK not loading
- Check that the script tag is in `index.html`
- Verify your App ID is correct
- Check browser console for errors

### API connection issues
- Verify `VITE_API_BASE` is set correctly
- Check CORS settings on your API
- Ensure credentials are included in requests

### Build errors
- Run `npm install` to ensure all dependencies are installed
- Check Node.js version (18+ required)
- Clear cache: `rm -rf node_modules && npm install`

