# Cloudflare Pages Deployment Guide

This guide will help you deploy the Consent React Dashboard to Cloudflare Pages.

## Prerequisites

1. A Cloudflare account
2. Your code pushed to a Git repository (GitHub, GitLab, or Bitbucket)
3. Your Memberstack App ID
4. Your API base URL

## Deployment Steps

### Method 1: Git Integration (Recommended)

1. **Push your code to Git**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin <your-repo-url>
   git push -u origin main
   ```

2. **Connect to Cloudflare Pages**
   - Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
   - Navigate to **Pages** → **Create a project**
   - Click **Connect to Git**
   - Select your Git provider and repository
   - Click **Begin setup**

3. **Configure Build Settings**
   - **Framework preset**: Vite
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/` (or leave empty)

4. **Add Environment Variables**
   Click **Add environment variable** and add:
   - **Variable name**: `VITE_API_BASE`
   - **Value**: Your API URL (e.g., `https://consentbit-dashboard-test.web-8fb.workers.dev`)

5. **Deploy**
   - Click **Save and Deploy**
   - Wait for the build to complete
   - Your site will be available at `https://<project-name>.pages.dev`

### Method 2: Wrangler CLI

1. **Install Wrangler**
   ```bash
   npm install -g wrangler
   ```

2. **Login to Cloudflare**
   ```bash
   wrangler login
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Deploy to Pages**
   ```bash
   wrangler pages deploy dist --project-name=consent-react-dashboard
   ```

5. **Set Environment Variables**
   ```bash
   wrangler pages secret put VITE_API_BASE
   # Enter your API URL when prompted
   ```

## Post-Deployment Configuration

### 1. Update Memberstack App ID

After deployment, you'll need to update the Memberstack App ID in your deployed site:

1. Go to your Cloudflare Pages project
2. Navigate to **Settings** → **Builds & deployments**
3. Add a build environment variable or update the HTML directly

Alternatively, you can use Cloudflare Pages Functions to inject the App ID dynamically.

### 2. Configure Custom Domain (Optional)

1. Go to your Pages project
2. Click **Custom domains**
3. Add your domain
4. Follow the DNS configuration instructions

### 3. Set Up Redirects

The `_redirects` file is already configured for SPA routing. All routes will redirect to `index.html` with a 200 status code.

## Environment Variables

### Required Variables

- `VITE_API_BASE`: Your Cloudflare Worker API base URL

### Optional Variables

- `VITE_MEMBERSTACK_APP_ID`: If you want to inject the App ID via environment variable instead of hardcoding it

## Troubleshooting

### Build Fails

- Check that all dependencies are in `package.json`
- Verify Node.js version (18+ required)
- Check build logs in Cloudflare Dashboard

### Memberstack Not Working

- Verify the Memberstack script tag is in `index.html`
- Check that your App ID is correct
- Ensure the script loads before React initializes
- Check browser console for errors

### API Errors

- Verify `VITE_API_BASE` is set correctly
- Check CORS settings on your API
- Ensure credentials are included in requests

### Routing Issues

- Verify `_redirects` file is in the `dist` folder after build
- Check that all routes redirect to `index.html`

## Updating the Deployment

### Automatic Updates (Git Integration)

When you push to your connected branch, Cloudflare Pages will automatically rebuild and redeploy.

### Manual Updates (Wrangler CLI)

```bash
npm run build
wrangler pages deploy dist --project-name=consent-react-dashboard
```

## Production Checklist

- [ ] Environment variables configured
- [ ] Memberstack App ID updated
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate active (automatic with Cloudflare)
- [ ] API CORS settings allow your Pages domain
- [ ] Error tracking configured (optional)
- [ ] Analytics configured (optional)

## Support

For issues or questions:
1. Check the [README.md](./README.md) for setup instructions
2. Review Cloudflare Pages documentation
3. Check browser console for errors
4. Verify API endpoints are working

