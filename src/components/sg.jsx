/*
Cloudflare Worker (module) - Stripe Checkout + Dashboard user mgmt
Deploy: Cloudflare Workers (Wrangler v3) or Pages Functions

Bindings required (set in your worker's environment):
- STRIPE_SECRET_KEY: your Stripe secret key
- STRIPE_WEBHOOK_SECRET: your Stripe webhook signing secret (optional but recommended)
- JWT_SECRET: HMAC secret for magic links / session tokens
- SESSION_KV (KV namespace binding) - Only for session tokens
- RESEND_API_KEY: Resend API key for sending emails (required for email functionality)
- EMAIL_FROM: (optional) from address for Resend emails (defaults to 'onboarding@resend.dev')
- BASE_URL: (optional) Base URL for magic links (defaults to request origin, e.g., 'https://consentbit-dashboard-test.web-8fb.workers.dev')
- MEMBERSTACK_SECRET_KEY: (optional) Memberstack admin secret key for /memberstack-webhook
  - Test Mode Keys: Start with 'sk_sb_' (development/testing)
  - Live Mode Keys: Start with 'sk_' (production)
  - Security: Store in environment variables, never commit to version control
  - Reference: https://developers.memberstack.com/admin-node-package/quick-start#installation-setup
- MEMBERSTACK_PLAN_ID: (optional) Memberstack plan ID to assign to users
- MEMBERSTACK_REDIRECT_URL: (optional) Redirect URL after Memberstack magic link login (defaults to dashboard: https://memberstack-login-test-713fa5.webflow.io/dashboard)
- MEMBERSTACK_LOGIN_URL: (optional) Webflow login page URL for triggering passwordless (defaults to: https://memberstack-login-test-713fa5.webflow.io/)

Notes:
- This Worker uses fetch to call Stripe REST API (no stripe-node dependency) so it runs cleanly on Workers.
- Email sending is implemented with Resend. If RESEND_API_KEY is not configured, emails will be logged to console for development.
- This is an illustrative starting point — add production hardening (rate limits, validation, logging, retries).

Endpoints implemented:
POST /create-checkout-session    -> create a Stripe Checkout Session (for multiple sites, single subscription with items)
POST /webhook                    -> handle Stripe webhooks (payment_intent.succeeded, checkout.session.completed, customer.subscription.updated)
POST /memberstack-webhook        -> Stripe → Memberstack integration (creates/updates Memberstack user, assigns plan, sends magic link)
POST /magic-link                 -> request a magic login link (creates a session token and returns a link)
GET  /auth/callback?token=...    -> verifies token and sets session cookie (redirects to dashboard URL)
GET  /dashboard                  -> returns the user's sites and billing info (requires session cookie)
POST /add-site                   -> add a site (create subscription_item)
POST /remove-site                -> remove a site (delete subscription_item)

Database usage (schema):
- All user data stored in D1 database tables (users, customers, subscriptions, subscription_items, pending_sites, licenses, payments, sites)
- No KV storage needed for user data - everything is in D1 
    email: string,
    customers: [
      {
        customerId: string,
        subscriptions: [
          {
            subscriptionId: string,
            status: string,
            items: [
              {
                item_id: string,
                site: string,  // Actual site name/domain
                price: string,
                quantity: number,
                status: string,
                created_at: number
              }
            ],
            created_at: number
          }
        ]
      }
    ],
    licenses: [...],
    pendingSites: [...],
    updated_at: number
  }
- SESSION_KV: key `session:{token}` => JSON { customerId, email, expires }

Deployment:
1. wrangler init
2. configure bindings in wrangler.toml
3. wrangler publish

*/

const STRIPE_BASE = 'https://api.stripe.com/v1';

// Import transaction manager for ACID-like consistency
// Note: Cloudflare Workers don't support ES6 imports from local files in the same way
// We'll inline the transaction logic or use a different approach

// Generate a random license key (internal function - use generateUniqueLicenseKey or generateLicenseKeys instead)
function generateLicenseKey() {
  // Generate a random license key format: KEY-XXXX-XXXX-XXXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing chars
  const segments = [4, 4, 4, 4];
  const key = segments.map(segLen => {
    let segment = '';
    for (let i = 0; i < segLen; i++) {
      segment += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return segment;
  }).join('-');
  return `KEY-${key}`;
}
// Enqueue site purchase job (Use Case 2 -> process later from sitesqueue)
async function enqueueSiteQueueItem(env, {
  customerId,
  userEmail,
  subscriptionId,
  sites,
  billingPeriod,
  priceId,
  paymentIntentId,
}) {
  if (!env.DB) {
    console.warn('[USE CASE 2 - QUEUE] No DB configured, skipping enqueue');
    return null;
  }

  const queueId = `sitequeue_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const sitesJson = JSON.stringify(sites || []);

  const res = await env.DB.prepare(`
    INSERT INTO sitesqueue (
      queueid,
      customerid,
      useremail,
      subscriptionid,
      paymentintentid,
      priceid,
      sites_json,
      billingperiod,
      status,
      createdat,
      updatedat
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    queueId,
    customerId,
    userEmail.toLowerCase().trim(),
    subscriptionId || null,
    paymentIntentId || null,
    priceId || null,
    sitesJson,
    billingPeriod || null,
    'pending',
    timestamp,
    timestamp
  ).run();

  console.log('[USE CASE 2 - QUEUE] Insert result:', res);

  if (!res.success) {
    console.error('[USE CASE 2 - QUEUE] Failed to enqueue site job', res);
    return null;
  }

  console.log('[USE CASE 2 - QUEUE] Enqueued site job', queueId, 'for', sites.length, 'site(s)');
  return queueId;
}

async function getOrCreateDynamicPrice(env, {
  productId,
  billingPeriod,
  currency,
  unitAmount,
}) {
  const period = (billingPeriod || '').toLowerCase().trim();

  // Flatten nested objects for form-encoded Stripe API
  const createBody = {
    product: productId,
    currency: currency || 'usd',
    unit_amount: unitAmount,
    'recurring[interval]': period === 'yearly' ? 'year' : 'month',
  };

  console.log('[USE CASE 2] Dynamic price createBody:', createBody);

  const res = await stripeFetch(env, '/prices', 'POST', createBody, true);

  if (res.status !== 200) {
    console.error('[USE CASE 2] ❌ Failed to create dynamic price', {
      status: res.status,
      body: res.body,
    });
    return null;
  }

  console.log('[USE CASE 2] ✅ Created dynamic price', res.body.id, 'for product', productId);
  return res.body.id;
}

async function processSitesQueue(env, limit = 100) {
  if (!env.DB) {
    console.warn('[SITES QUEUE] No DB, skipping sitesqueue processing');
    return { processed: 0, error: 'No database configured' };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const fiveMinutesAgo = timestamp - (5 * 60);

  try {
    // Reset stuck processing items
    try {
      const resetResult = await env.DB.prepare(
        `UPDATE sitesqueue 
         SET status = 'pending', updatedat = ?
         WHERE status = 'processing' 
         AND updatedat < ?`
      ).bind(timestamp, fiveMinutesAgo).run();
      
      if (resetResult.meta.changes > 0) {
        console.log(`[SITES QUEUE] 🔄 Reset ${resetResult.meta.changes} stuck 'processing' items back to 'pending'`);
      }
    } catch (resetErr) {
      console.warn(`[SITES QUEUE] ⚠️ Could not reset stuck processing items:`, resetErr);
    }

    // Get pending items
    const queueItems = await env.DB.prepare(`
      SELECT * FROM sitesqueue
      WHERE status = 'pending'
      ORDER BY createdat ASC
      LIMIT ?
    `).bind(limit).all();

    if (!queueItems.results || queueItems.results.length === 0) {
      console.log(`[SITES QUEUE] ⏸️ No pending queue items found`);
      return { processed: 0, message: 'No pending queue items' };
    }

    console.log(`[SITES QUEUE] 📋 Processing ${queueItems.results.length} queue item(s)...`);
    console.log(`[SITES QUEUE] Queue IDs:`, queueItems.results.map(j => j.queueid));

    let successCount = 0;
    let failCount = 0;

    for (const job of queueItems.results) {
      // Atomic lock mechanism
      const lockResult = await env.DB.prepare(
        `UPDATE sitesqueue 
         SET status = 'processing', updatedat = ? 
         WHERE queueid = ? AND status = 'pending'`
      ).bind(timestamp, job.queueid).run();

      if (lockResult.meta.changes === 0) {
        console.log(`[SITES QUEUE] ⚠️ Could not acquire lock for queue item ${job.queueid}`);
        continue;
      }

      try {
        console.log('[SITES QUEUE] Processing queueid:', job.queueid);
        console.log('[SITES QUEUE] Queue item details:', {
          queueid: job.queueid,
          customerid: job.customerid,
          useremail: job.useremail,
          sites_json: job.sites_json,
          billingperiod: job.billingperiod,
          priceid: job.priceid,
          paymentintentid: job.paymentintentid,
          status: job.status
        });

        const sites = JSON.parse(job.sites_json || '[]');
        const customerId = job.customerid;
        const userEmail = job.useremail;
        const billingPeriod = job.billingperiod || 'monthly';
        const priceId = job.priceid;
        
        console.log(`[SITES QUEUE] Processing ${sites.length} site(s) for customer ${customerId}`);

        const createdSubscriptions = [];

        for (const site of sites) {
          const siteName = site.site || site.site_domain || site;
          
          // Generate unique license key
          const licenseKey = await generateUniqueLicenseKey(env);

          // Calculate trial end (30 days from now)
          const trialEnd = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

          // Create subscription in Stripe with trial
          const subRes = await stripeFetch(env, '/subscriptions', 'POST', {
            customer: customerId,
            'items[0][price]': site.price || priceId,
            'items[0][quantity]': 1,
            'trial_end': trialEnd.toString(),
            'metadata[license_key]': licenseKey,
            'metadata[usecase]': '2',
            'metadata[purchase_type]': 'site',
            'metadata[site]': siteName,
            'collection_method': 'charge_automatically',
          }, true);

          if (subRes.status === 200) {
            const sub = subRes.body;
            const itemId = sub.items?.data?.[0]?.id || null;

            // Save license to database
            const licenseTimestamp = Math.floor(Date.now() / 1000);
            await env.DB.prepare(`
              INSERT INTO licenses (
                license_key, customer_id, subscription_id, item_id, site_domain,
                status, purchase_type, billing_period, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'active', 'site', ?, ?, ?)
            `).bind(
              licenseKey,
              customerId,
              sub.id,
              itemId,
              siteName,
              billingPeriod,
              licenseTimestamp,
              licenseTimestamp
            ).run();

            // Save subscription to database
            await env.DB.prepare(`
              INSERT OR REPLACE INTO subscriptions (
                user_email, customer_id, subscription_id, status,
                current_period_start, current_period_end, billing_period,
                created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              userEmail,
              customerId,
              sub.id,
              sub.status || 'trialing',
              sub.current_period_start || null,
              sub.current_period_end || null,
              billingPeriod,
              licenseTimestamp,
              licenseTimestamp
            ).run();

            // Save subscription item
            if (itemId) {
              await env.DB.prepare(`
                INSERT OR REPLACE INTO subscription_items (
                  subscription_id, item_id, site_domain, price_id, quantity,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 1, 'active', ?, ?)
              `).bind(
                sub.id,
                itemId,
                siteName,
                site.price || priceId,
                licenseTimestamp,
                licenseTimestamp
              ).run();
            }

            createdSubscriptions.push({
              site: siteName,
              subscriptionId: sub.id,
              licenseKey: licenseKey
            });

            console.log(`[SITES QUEUE] ✅ Created subscription ${sub.id} for site ${siteName}`);
          } else {
            console.error(`[SITES QUEUE] ❌ Failed to create subscription for site ${siteName}:`, subRes.status, subRes.body);
            throw new Error(`Failed to create subscription: ${subRes.status}`);
          }

          // Small delay between subscriptions
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Mark queue item as completed
        await env.DB.prepare(`
          UPDATE sitesqueue
          SET status = 'completed', updatedat = ?
          WHERE queueid = ?
        `).bind(timestamp, job.queueid).run();

        successCount++;
        console.log(`[SITES QUEUE] ✅ Completed queueid: ${job.queueid} (${createdSubscriptions.length} subscriptions)`);

      } catch (err) {
        console.error(`[SITES QUEUE] ❌ Error processing queueid ${job.queueid}:`, err);
        await env.DB.prepare(`
          UPDATE sitesqueue
          SET status = 'failed', updatedat = ?, errormessage = ?
          WHERE queueid = ?
        `).bind(timestamp, err.message || 'Unknown error', job.queueid).run();
        failCount++;
      }
    }

    console.log(`[SITES QUEUE] ✅ Queue processing complete: ${successCount} succeeded, ${failCount} failed`);
    return { processed: queueItems.results.length, successCount, failCount };

  } catch (error) {
    console.error(`[SITES QUEUE] ❌ Error processing queue:`, error);
    return { processed: 0, error: error.message };
  }
}
async function detectPlatform(domain) {
  try {
    const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
    const res = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'platform-detector-bot'
      }
    });
    const html = await res.text();
    // Check for Framer
    const isFramer = html.includes('events.framer.com/script') || html.includes('data-fid=');
    if (isFramer) return 'framer';
    // Check for Webflow
    const isWebflow = html.includes('webflow.com') || html.includes('data-wf-page');
    if (isWebflow) return 'webflow';
    // Not published or unknown platform
    return 'pending';
  } catch (error) {
    console.error('Platform detection error:', error);
    return 'pending';
  }
}
// :new: Get KV namespaces based on platform
function getKvNamespaces(env, platform) {
  switch (platform) {
    case 'framer':
      return {
        activeSitesKv: env.ACTIVE_SITES_CONSENTBIT_FRAMER
      };
    case 'webflow':
      return {
        activeSitesKv: env.ACTIVE_SITES_CONSENTBIT
      };
    case 'pending':
      return {
        activeSitesKv: env.Pending_Active_site
      };
    default:
      return {
        activeSitesKv: null
      };
  }
}
// :new: Updated saveLicenseKeyToKV (accepts specific KV + platform)
async function saveLicenseKeyToKVPlatform(
  activeSitesKv,
  license_key,
  customer_id,
  subscription_id,
  email,
  status,
  cancelAtPeriodEnd,
  validatedSiteDomain,
  platform
) {
  if (!activeSitesKv) {
    console.warn(`[saveLicenseKeyToKV] No activeSitesKv provided`);
    return;
  }
  const formattedKey = formatSiteName(validatedSiteDomain); // Your existing function
  const kvData = {
    license_key,
    customer_id,
    subscription_id,
    email,
    status,
    cancelAtPeriodEnd,
    site_domain: validatedSiteDomain,
    platform,  // :new:
    updated_at: Math.floor(Date.now() / 1000)
  };
  console.log(`[saveLicenseKeyToKV] Saving to KV ${formattedKey}:`, kvData);
  await activeSitesKv.put(license_key, JSON.stringify(kvData));
  await activeSitesKv.put(formattedKey, JSON.stringify(kvData)); // Also save by domain
  console.log(`[saveLicenseKeyToKV] :white_check_mark: Saved to ${platform} KV namespace`);
}



// Helper: map billing_period -> Stripe price id
function getPriceIdForSite(env, billingPeriod) {
  if (billingPeriod === 'yearly') return env.STRIPE_SITE_YEARLY_PRICE_ID;
  return env.STRIPE_SITE_MONTHLY_PRICE_ID;
}


function getSitePriceId(env, billingPeriod) {
  if (billingPeriod === 'yearly') return env.STRIPE_SITE_YEARLY_PRICE_ID;
  return env.STRIPE_SITE_MONTHLY_PRICE_ID;
}
function getPriceIdFromProduct(productId, billingPeriod, env) {
  const period = (billingPeriod || '').toLowerCase().trim();

  // prod_SHWZdF20XLXtn9 = monthly product
  if (productId === 'prod_SHWZdF20XLXtn9' && period === 'monthly') {
    return env.MONTHLY_LICENSE_PRICE_ID;  // used for both quantity + sites
  }

  // prod_SJQgqC8uDgRcOi = yearly product
  if (productId === 'prod_SJQgqC8uDgRcOi' && period === 'yearly') {
    return env.YEARLY_LICENSE_PRICE_ID;   // used for both quantity + sites
  }

  return null;
}



// Generate a single unique license key with database check
function generateTempLicenseKeys(quantity) {
  return Array.from({ length: quantity }, (_, i) => `L${i + 1}`);
}

// Check if a license key is temporary (placeholder)
function isTemporaryLicenseKey(key) {
  if (!key || typeof key !== 'string') return false;
  // Temporary keys start with "L" followed by numbers (e.g., "L1", "L2", "L10")
  // or start with "TEMP-" (e.g., "TEMP-1", "TEMP-2")
  return /^L\d+$/.test(key) || /^TEMP-/.test(key);
}

// Generate a single unique license key with database check
async function generateUniqueLicenseKey(env) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const makeKey = () =>
    'KEY-' +
    Array.from({ length: 4 })
      .map(() =>
        Array.from({ length: 4 })
          .map(() => chars[Math.floor(Math.random() * chars.length)])
          .join('')
      )
      .join('-');

  // If DB is not available, return a key without uniqueness check
  if (!env?.DB) {
    const key = makeKey();
    console.log(`[generateUniqueLicenseKey] ⚠️ DB not available - returning key without uniqueness check: ${key.substring(0, 10)}...`);
    return key;
  }

  // Try up to 50 times to generate a unique key
  for (let i = 0; i < 50; i++) {
    try {
      const key = makeKey();
      
      // Check if key exists in database
      const exists = await env.DB.prepare(
        'SELECT license_key FROM licenses WHERE license_key = ? LIMIT 1'
      ).bind(key).first();

      if (!exists) {
        if (i > 0) {
          console.log(`[generateUniqueLicenseKey] ✅ Generated unique key after ${i + 1} attempt(s): ${key.substring(0, 10)}...`);
        }
        return key;
      }
      
      // Key exists, try again
      if (i === 0) {
        console.log(`[generateUniqueLicenseKey] 🔄 Key collision detected, retrying...`);
      }
    } catch (dbError) {
      console.error(`[generateUniqueLicenseKey] ❌ Database error checking key uniqueness (attempt ${i + 1}):`, dbError);
      // If it's a critical error, throw it
      if (dbError.message && dbError.message.includes('no such table: licenses')) {
        // Table doesn't exist - return key without check
        const key = makeKey();
        console.log(`[generateUniqueLicenseKey] ⚠️ Licenses table not found - returning key without check: ${key.substring(0, 10)}...`);
        return key;
      }
      // For other errors, continue trying
      if (i === 49) {
        // Last attempt failed
        throw new Error(`Failed to generate unique license key after 50 attempts. Last error: ${dbError.message}`);
      }
    }
  }

  throw new Error('Failed to generate unique license key after 50 attempts (all keys were duplicates)');
}

// Generate multiple unique license keys
async function generateLicenseKeys(quantity, env) {
  const keys = [];
  for (let i = 0; i < quantity; i++) {
    const key = await generateUniqueLicenseKey(env);
    keys.push(key);
  }
  return keys;
}

// Generate multiple license keys with uniqueness check
async function handleCreateSiteCheckout(request, env) {
  const url = new URL(request.url);

  console.log('[CREATE-SITE-CHECKOUT] 📥 Request received');

  /* ─────────────────────────────
     PARSE BODY
  ───────────────────────────── */
  let body;
  try {
    body = await request.json();
    console.log('[CREATE-SITE-CHECKOUT] 📋 Request body:', {
      email: body.email ? 'provided' : 'not provided',
      billing_period: body.billing_period,
      sites: Array.isArray(body.sites) ? body.sites.length : 0,
    });
  } catch (err) {
    console.error('[CREATE-SITE-CHECKOUT] ❌ Error parsing request body:', err);
    return jsonResponse(400, {
      error: 'invalid_request',
      message: 'Invalid JSON in request body',
    }, true, request);
  }

  const { email: emailParam, sites, billing_period: billingPeriodParam } = body;
  const sitesArray = Array.isArray(sites) ? sites : [];

  if (!sitesArray.length) {
    console.log('[CREATE-SITE-CHECKOUT] ❌ No sites provided');
    return jsonResponse(400, {
      error: 'missing_sites',
      message: 'At least one site is required',
    }, true, request);
  }

  /* ─────────────────────────────
     AUTH / EMAIL (same as purchase-quantity)
  ───────────────────────────── */
  let email = emailParam?.toLowerCase().trim();

  if (!email) {
    const cookie = request.headers.get('cookie') || '';
    const match = cookie.match(/sb_session=([^;]+)/);
    if (!match) {
      return jsonResponse(401, { error: 'unauthenticated' }, true, request);
    }

    const payload = await verifyToken(env, match[1]);
    if (!payload?.email) {
      return jsonResponse(401, { error: 'invalid_session' }, true, request);
    }

    email = payload.email;
  }

  if (!email.includes('@')) {
    console.log('[CREATE-SITE-CHECKOUT] ❌ Invalid email format:', email);
    return jsonResponse(400, { error: 'invalid_email' }, true, request);
  }

  console.log('[CREATE-SITE-CHECKOUT] ✅ Email validated:', email);

  /* ─────────────────────────────
     LOAD USER & CUSTOMER (exactly like purchase-quantity)
  ───────────────────────────── */
  console.log('[CREATE-SITE-CHECKOUT] 🔍 Loading user from database...');
  const user = await getUserByEmail(env, email);

  if (!user?.customers?.length) {
    console.log('[CREATE-SITE-CHECKOUT] ❌ No customer found for email:', email);
    return jsonResponse(400, {
      error: 'no_customer',
      message: 'Customer account required',
    }, true, request);
  }

  console.log('[CREATE-SITE-CHECKOUT] ✅ User found with', user.customers.length, 'customer(s)');

  let customerId = null;
  if (user.customers && user.customers.length > 0) {
    customerId = user.customers[0].customerId;
  }

  if (!customerId) {
    return jsonResponse(400, {
      error: 'no_customer',
      message: 'Customer account required',
    }, true, request);
  }

  /* ─────────────────────────────
     PRICE CONFIG (reuse purchase-quantity logic)
  ───────────────────────────── */
  if (!billingPeriodParam) {
    console.log('[CREATE-SITE-CHECKOUT] ❌ Billing period not provided');
    return jsonResponse(400, {
      error: 'billing_period_required',
      message: 'billing_period is required. Please provide "monthly" or "yearly".',
    }, true, request);
  }

  const normalizedPeriod = billingPeriodParam.toLowerCase().trim();
  console.log('[CREATE-SITE-CHECKOUT] 📅 Billing period:', normalizedPeriod);

  let productId, unitAmount;
  const currency = 'usd'; // Default to USD
  if (normalizedPeriod === 'monthly') {
    productId = env.MONTHLY_PRODUCT_ID || env.MONTHLY_LICENSE_PRODUCT_ID || 'prod_SHWZdF20XLXtn9';
    unitAmount = parseInt(env.MONTHLY_UNIT_AMOUNT || env.MONTHLY_LICENSE_UNIT_AMOUNT || '800');
    console.log('[CREATE-SITE-CHECKOUT] 💰 Monthly config:', { productId, unitAmount, currency });
  } else if (normalizedPeriod === 'yearly') {
    productId = env.YEARLY_PRODUCT_ID || env.YEARLY_LICENSE_PRODUCT_ID || 'prod_SJQgqC8uDgRcOi';
    unitAmount = parseInt(env.YEARLY_UNIT_AMOUNT || env.YEARLY_LICENSE_UNIT_AMOUNT || '7500');
    console.log('[CREATE-SITE-CHECKOUT] 💰 Yearly config:', { productId, unitAmount, currency });
  } else {
    console.log('[CREATE-SITE-CHECKOUT] ❌ Invalid billing period:', billingPeriodParam);
    return jsonResponse(400, {
      error: 'invalid_billing_period',
      message: `Invalid billing_period: ${billingPeriodParam}. Must be "monthly" or "yearly".`,
    }, true, request);
  }

  if (!productId) {
    console.log('[CREATE-SITE-CHECKOUT] ❌ Product ID not configured for:', normalizedPeriod);
    return jsonResponse(500, {
      error: 'product_id_not_configured',
      message: `${normalizedPeriod.charAt(0).toUpperCase() + normalizedPeriod.slice(1)} product ID not configured.`,
    }, true, request);
  }

  const storedUnitAmount = unitAmount;
  console.log(`[CREATE-SITE-CHECKOUT] ✅ Price config loaded (${normalizedPeriod}):`, {
    productId,
    storedUnitAmount,
    currency: 'usd',
  });

  /* ─────────────────────────────
     STEP 1: CALCULATE AMOUNT (like purchase-quantity)
  ───────────────────────────── */
  const totalSites = sitesArray.length;
  let totalAmount = storedUnitAmount * totalSites;
  const invoiceCurrency = 'usd'; // Default to USD

  console.log(`[CREATE-SITE-CHECKOUT] Using unit_amount from env: ${storedUnitAmount}, sites: ${totalSites}, total: ${totalAmount}`);

  /* ─────────────────────────────
     STEP 2: PREPARE METADATA FOR AFTER PAYMENT
  ───────────────────────────── */
  try {
    await stripeFetch(env, `/customers/${customerId}`, 'POST', {
      'metadata[sites_pending]': JSON.stringify(sitesArray),
      'metadata[usecase]': '2',
      'metadata[billing_period]': normalizedPeriod,
    }, true);
  } catch (metadataErr) {
    console.warn('[CREATE-SITE-CHECKOUT] ⚠️ Failed to store metadata in customer:', metadataErr);
    // Non-critical
  }

  /* ─────────────────────────────
     STEP 3: CREATE CHECKOUT SESSION (mode: payment, like purchase-quantity)
  ───────────────────────────── */
  const dashboardUrl = env.MEMBERSTACK_REDIRECT_URL || 'https://dashboard.consentbit.com/dashboard';

  const form = {
  mode: 'payment',
  customer: customerId,
  // Payment method types: Card only
  'payment_method_types[0]': 'card',
  // Enable promotion codes
  'allow_promotion_codes': 'true',
  'line_items[0][price_data][currency]': 'usd', // Default to USD
  'line_items[0][price_data][unit_amount]': storedUnitAmount, // Unit price per site
  'line_items[0][price_data][product_data][name]': 'ConsentBit',
  'line_items[0][price_data][product_data][description]': `Billed ${normalizedPeriod === 'yearly' ? 'yearly' : 'monthly'}`,
  'line_items[0][quantity]': totalSites, // Show actual quantity (number of sites)

  'payment_intent_data[metadata][usecase]': '2',
  'payment_intent_data[metadata][customer_id]': customerId,
  'payment_intent_data[metadata][sites_json]': JSON.stringify(sitesArray),
  'payment_intent_data[metadata][billing_period]': normalizedPeriod,
  'payment_intent_data[metadata][product_id]': productId,   // 🔴 required for getPriceIdFromProduct
  'payment_intent_data[metadata][currency]': invoiceCurrency,

  'payment_intent_data[setup_future_usage]': 'off_session',
  'success_url': `${dashboardUrl}?session_id={CHECKOUT_SESSION_ID}&payment=success`,
  'cancel_url': dashboardUrl,
};

  console.log('[CREATE-SITE-CHECKOUT] 💳 Creating Stripe checkout session...', {
    amount: totalAmount,
    currency: invoiceCurrency,
    totalSites,
    productId,
  });

  const session = await stripeFetch(env, '/checkout/sessions', 'POST', form, true);

  if (session.status >= 400) {
    console.error('[CREATE-SITE-CHECKOUT] ❌ Checkout session creation failed:', {
      status: session.status,
      body: session.body,
    });

    return jsonResponse(500, {
      error: 'checkout_failed',
      message: 'Failed to create checkout session',
      details: session.body,
    }, true, request);
  }

  console.log('[CREATE-SITE-CHECKOUT] ✅ Checkout session created successfully:', {
    session_id: session.body.id,
    checkout_url: session.body.url ? 'present' : 'missing',
  });

  const response = {
    checkout_url: session.body.url,
    session_id: session.body.id,
    amount: totalAmount,
    currency: invoiceCurrency,
    sites: totalSites,
    billing_period: normalizedPeriod,
  };

  console.log('[CREATE-SITE-CHECKOUT] 📤 Returning response:', {
    has_checkout_url: !!response.checkout_url,
    session_id: response.session_id,
    sites: response.sites,
  });

  return jsonResponse(200, response, true, request);
}



async function generateTempLicenceKey(count) {
  
}

// Generate a secure random password for Memberstack members
// Members will use magic links to login, so password is just for API requirement
function generateRandomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  // Generate 32 character password
  for (let i = 0; i < 32; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

// Helper to get CORS headers with proper origin handling
function getCorsHeaders(request) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = [
    'https://memberstack-login-test-713fa5.webflow.io',
    'https://consentbit-dashboard-test.web-8fb.workers.dev',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:8080',
    'http://localhost:1337',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'https://dashboard.consentbit.com' // <- removed trailing slash
  ];

  const headers = {};

  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    headers['Vary'] = 'Origin';
  }

  return headers;
}


function jsonResponse(status, body, cors = true, request = null) {
  const headers = { 'content-type': 'application/json' };
  if (cors) {
    if (request) {
      const corsHeaders = getCorsHeaders(request);
      Object.assign(headers, corsHeaders);
    } else {
    headers['Access-Control-Allow-Origin'] = '*';
    headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    }
  }
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

function getEnvVar(env, key) {
  if (!env[key]) throw new Error(`Missing env var ${key}`);
  return env[key];
}

// Helper function to batch queries and avoid SQLite's 999 variable limit
async function batchQuery(env, ids, queryFn, batchSize = 100) {
  // Reduced batch size to 100 to avoid SQLite's 999 variable limit
  // Each ID in IN clause = 1 variable, plus query columns/parameters can add more
  // With complex queries having many columns (10+ columns), 100 is safer
  // SQLite limit is 999, so 100 leaves plenty of room for additional query parameters
  // For queries with many columns, consider reducing batchSize further (e.g., 50)
  if (ids.length === 0) return { results: [] };
  
  const results = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    try {
      const batchResults = await queryFn(batch);
      if (batchResults?.results) {
        results.push(...batchResults.results);
      }
    } catch (err) {
      console.error(`[batchQuery] Error processing batch ${i}-${i + batch.length}:`, err);
      throw err; // Re-throw to let caller handle
    }
  }
  return { results };
}

// Helper functions for email-based data structure
// Database-based user functions (replaces KV storage)
async function getUserByEmail(env, email) {
  if (!env.DB) {
    console.warn('Database not configured, cannot get user by email');
    return null;
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  
  try {
    // Get user
    const user = await env.DB.prepare(
      'SELECT email, created_at, updated_at FROM users WHERE email = ?'
    ).bind(normalizedEmail).first();
    
    if (!user) {
      return null;
    }
    
    // Get customers for this user
    const customersRes = await env.DB.prepare(
      'SELECT customer_id, created_at FROM customers WHERE user_email = ?'
    ).bind(normalizedEmail).all();
    
    const customers = [];
    
    if (customersRes && customersRes.results) {
      for (const customerRow of customersRes.results) {
        const customerId = customerRow.customer_id;
        
        // Get subscriptions for this customer
        // CRITICAL: Include billing_period in SELECT query
        const subscriptionsRes = await env.DB.prepare(
          'SELECT subscription_id, status, cancel_at_period_end, cancel_at, current_period_start, current_period_end, billing_period, created_at FROM subscriptions WHERE customer_id = ? AND user_email = ?'
        ).bind(customerId, normalizedEmail).all();
        
        const subscriptions = [];
        
        if (subscriptionsRes && subscriptionsRes.results) {
          for (const subRow of subscriptionsRes.results) {
            // Get items for this subscription
            const itemsRes = await env.DB.prepare(
              'SELECT item_id, site_domain, price_id, quantity, status, created_at, removed_at FROM subscription_items WHERE subscription_id = ?'
            ).bind(subRow.subscription_id).all();
            
            const items = [];
            if (itemsRes && itemsRes.results) {
              for (const itemRow of itemsRes.results) {
                // Get license for this site
                const licenseRes = await env.DB.prepare(
                  'SELECT license_key, status, created_at FROM licenses WHERE site_domain = ? AND subscription_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
                ).bind(itemRow.site_domain, subRow.subscription_id, 'active').first();
                
                items.push({
                  item_id: itemRow.item_id,
                  site: itemRow.site_domain,
                  price: itemRow.price_id,
                  quantity: itemRow.quantity,
                  status: itemRow.status,
                  created_at: itemRow.created_at,
                  license: licenseRes ? {
                    license_key: licenseRes.license_key,
                    status: licenseRes.status,
                    created_at: licenseRes.created_at
                  } : null
                });
              }
            }
            
            subscriptions.push({
              subscriptionId: subRow.subscription_id,
              status: subRow.status,
              cancel_at_period_end: subRow.cancel_at_period_end === 1,
              cancel_at: subRow.cancel_at,
              current_period_start: subRow.current_period_start,
              current_period_end: subRow.current_period_end,
              billingPeriod: subRow.billing_period || null, // CRITICAL: Load billing_period from database
              items: items,
              sitesCount: items.length,
              created_at: subRow.created_at
            });
          }
        }
        
        customers.push({
          customerId: customerId,
          subscriptions: subscriptions,
          created_at: customerRow.created_at
        });
      }
    }
    
    // Get pending sites
    // Use DISTINCT to prevent duplicate rows at database level
    // Also group by site_domain to ensure only one row per site (case-insensitive)
    const pendingSitesRes = await env.DB.prepare(
      `SELECT DISTINCT 
        subscription_id, 
        site_domain, 
        price_id, 
        quantity, 
        created_at 
      FROM pending_sites 
      WHERE user_email = ? 
      ORDER BY created_at DESC`
    ).bind(normalizedEmail).all();
    
    const pendingSites = [];
    const seenSites = new Set(); // Deduplicate by site domain (case-insensitive)
    if (pendingSitesRes && pendingSitesRes.results) {
      for (const psRow of pendingSitesRes.results) {
        const siteKey = (psRow.site_domain || '').toLowerCase().trim();
        if (!siteKey) {
          console.warn(`[getUserByEmail] ⚠️ Skipping pending site with empty domain`);
          continue;
        }
        
        if (!seenSites.has(siteKey)) {
          seenSites.add(siteKey);
          pendingSites.push({
            site: psRow.site_domain,
            price: psRow.price_id,
            quantity: psRow.quantity || 1,
            subscription_id: psRow.subscription_id,
            created_at: psRow.created_at
          });
        } else {
          // Duplicate found - log for audit but keep first occurrence
          console.warn(`[getUserByEmail] ⚠️ PAYMENT SAFETY: Skipping duplicate pending site "${psRow.site_domain}" to prevent duplicate charges`);
        }
      }
    }
    
    return {
      email: normalizedEmail,
      customers: customers,
      licenses: [], // Licenses are now fetched per item
      pendingSites: pendingSites,
      created_at: user.created_at,
      updated_at: user.updated_at
    };
  } catch (error) {
    console.error('Error getting user from database:', error);
    return null;
  }
}

async function saveUserByEmail(env, email, userData) {
  if (!env.DB) {
    return;
  }
  
  const normalizedEmail = email.toLowerCase().trim();
  const timestamp = Math.floor(Date.now() / 1000);
  
  try {
    // Create or update user
    await env.DB.prepare(
      'INSERT OR IGNORE INTO users (email, created_at, updated_at) VALUES (?, ?, ?)'
    ).bind(normalizedEmail, timestamp, timestamp).run();
    
    await env.DB.prepare(
      'UPDATE users SET updated_at = ? WHERE email = ?'
    ).bind(timestamp, normalizedEmail).run();
    
    // Update customers
    if (userData.customers && Array.isArray(userData.customers)) {
      for (const customer of userData.customers) {
        // Create or update customer
        await env.DB.prepare(
          'INSERT OR IGNORE INTO customers (user_email, customer_id, created_at, updated_at) VALUES (?, ?, ?, ?)'
        ).bind(normalizedEmail, customer.customerId, timestamp, timestamp).run();
        
        // Update subscriptions
        // CRITICAL: INSERT OR REPLACE only affects the specific subscription_id (UNIQUE constraint)
        // This means we can safely add new subscriptions without affecting existing ones
        if (customer.subscriptions && Array.isArray(customer.subscriptions)) {
          for (const subscription of customer.subscriptions) {
            // Check if subscription already exists in database
            const existingSub = await env.DB.prepare(
              'SELECT subscription_id FROM subscriptions WHERE subscription_id = ?'
            ).bind(subscription.subscriptionId).first();
            
            const isNewSubscription = !existingSub;
            const billingPeriodValue = subscription.billingPeriod || subscription.billing_period || null;
            
            // Try to save with billing_period column (if it exists in schema)
            // INSERT OR REPLACE: INSERTs if subscription_id doesn't exist, REPLACEs if it does
            // Since subscription_id is UNIQUE, this only affects THIS subscription, not others
            try {
              await env.DB.prepare(
                `INSERT OR REPLACE INTO subscriptions 
                 (user_email, customer_id, subscription_id, status, cancel_at_period_end, cancel_at, 
                  current_period_start, current_period_end, billing_period, created_at, updated_at) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                normalizedEmail,
                customer.customerId,
                subscription.subscriptionId,
                subscription.status || 'active',
                subscription.cancel_at_period_end ? 1 : 0,
                subscription.cancel_at || null,
                subscription.current_period_start || null,
                subscription.current_period_end || null,
                billingPeriodValue, // Use the extracted value explicitly
                subscription.created_at || timestamp,
                timestamp
              ).run();
            } catch (billingPeriodError) {
              // If billing_period column doesn't exist, save without it
              // Check for both error message formats: "no such column" and "has no column named"
              const errorMsg = billingPeriodError.message || '';
              if (errorMsg.includes('no such column: billing_period') || 
                  errorMsg.includes('has no column named billing_period') ||
                  errorMsg.includes('billing_period')) {
                await env.DB.prepare(
                  `INSERT OR REPLACE INTO subscriptions 
                   (user_email, customer_id, subscription_id, status, cancel_at_period_end, cancel_at, 
                    current_period_start, current_period_end, created_at, updated_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                  normalizedEmail,
                  customer.customerId,
                  subscription.subscriptionId,
                  subscription.status || 'active',
                  subscription.cancel_at_period_end ? 1 : 0,
                  subscription.cancel_at || null,
                  subscription.current_period_start || null,
                  subscription.current_period_end || null,
                  subscription.created_at || timestamp,
                  timestamp
                ).run();
              } else {
                throw billingPeriodError; // Re-throw if it's a different error
              }
            }
            
            // Update subscription items
            if (subscription.items && Array.isArray(subscription.items)) {
              // Get billing_period and renewal_date from subscription
              const billingPeriod = subscription.billingPeriod || subscription.billing_period || null;
              const renewalDate = subscription.current_period_end || null;
              
              for (const item of subscription.items) {
                await env.DB.prepare(
                  `INSERT OR REPLACE INTO subscription_items 
                   (subscription_id, item_id, site_domain, price_id, quantity, status, billing_period, renewal_date, created_at, updated_at, removed_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                  subscription.subscriptionId,
                  item.item_id,
                  item.site || item.site_domain,
                  item.price || item.price_id,
                  item.quantity || 1,
                  item.status || 'active',
                  billingPeriod,
                  renewalDate,
                  item.created_at || timestamp,
                  timestamp,
                  item.removed_at || null
                ).run();
              }
            }
          }
        }
      }
    }
    
    // Update pending sites
    // CRITICAL: Only sync if userData.pendingSites is explicitly provided
    // If not provided, don't touch the database (preserves existing pending sites)
    // IMPORTANT: The database is the source of truth - we sync FROM database TO user object, not the other way around
    // So when saving, we only update the database if userData.pendingSites is explicitly set
    console.log(`[saveUserByEmail] Checking pendingSites:`, {
      hasPendingSites: userData.pendingSites !== undefined,
      isArray: Array.isArray(userData.pendingSites),
      length: userData.pendingSites?.length,
      pendingSites: userData.pendingSites
    });
    
    if (userData.pendingSites !== undefined && Array.isArray(userData.pendingSites)) {
      // Get current pending sites from database (source of truth)
      const currentPendingSitesRes = await env.DB.prepare(
        'SELECT site_domain FROM pending_sites WHERE user_email = ?'
      ).bind(normalizedEmail).all();
      
      const currentPendingSites = new Set();
      if (currentPendingSitesRes && currentPendingSitesRes.results) {
        currentPendingSitesRes.results.forEach(row => {
          currentPendingSites.add(row.site_domain.toLowerCase().trim());
        });
      }
      
      console.log(`[saveUserByEmail] Current pending sites in DB: ${currentPendingSites.size}`);
      
      // Get user object pending sites
      const userPendingSites = new Set();
      userData.pendingSites.forEach(ps => {
        const siteName = (ps.site || ps.site_domain || '').toLowerCase().trim();
        if (siteName) {
          userPendingSites.add(siteName);
        }
      });
      
      console.log(`[saveUserByEmail] User pending sites: ${userPendingSites.size}`);
      
      // Flatten pendingSites array to handle nested structures
      const flattenedPendingSites = [];
      userData.pendingSites.forEach(ps => {
        // Handle nested arrays or objects with pendingSites property
        if (Array.isArray(ps)) {
          // If element is an array, extract items
          ps.forEach(item => {
            if (item && typeof item === 'object') {
              flattenedPendingSites.push(item);
            } else if (typeof item === 'string') {
              // If it's just a string, convert to object
              flattenedPendingSites.push({ site: item, site_domain: item });
            }
          });
        } else if (ps && typeof ps === 'object' && ps.pendingSites) {
          // If object has pendingSites property, extract it
          if (Array.isArray(ps.pendingSites)) {
            flattenedPendingSites.push(...ps.pendingSites);
          } else {
            flattenedPendingSites.push(ps.pendingSites);
          }
        } else if (ps && typeof ps === 'object') {
          // Normal object, add as is
          flattenedPendingSites.push(ps);
        } else if (typeof ps === 'string') {
          // If it's just a string, convert to object
          flattenedPendingSites.push({ site: ps, site_domain: ps });
        }
      });
      
      // Find sites to delete (in database but not in user object)
      const sitesToDelete = [];
      currentPendingSites.forEach(site => {
        if (!userPendingSites.has(site)) {
          sitesToDelete.push(site);
        }
      });
      
      // Find sites to insert (in user object but not in database)
      // Use flattened array to avoid nested structures
      const sitesToInsert = [];
      flattenedPendingSites.forEach(ps => {
        const siteName = (ps.site || ps.site_domain || '').toLowerCase().trim();
        if (siteName && !currentPendingSites.has(siteName)) {
          sitesToInsert.push(ps);
        }
      });
      
      console.log(`[saveUserByEmail] Sites to insert: ${sitesToInsert.length}, Sites to delete: ${sitesToDelete.length}`);
      
      // Delete sites that are in database but not in user object
      for (const siteToDelete of sitesToDelete) {
        const deleteResult = await env.DB.prepare(
          'DELETE FROM pending_sites WHERE user_email = ? AND LOWER(TRIM(site_domain)) = ?'
        ).bind(normalizedEmail, siteToDelete).run();
        console.log(`[saveUserByEmail] 🗑️ Deleted pending site: ${siteToDelete}`, deleteResult.success ? '✅' : '❌');
      }
      
      // Insert sites that are in user object but not in database
      for (const pendingSite of sitesToInsert) {
        const siteName = pendingSite.site || pendingSite.site_domain;
        const sitePrice = pendingSite.price || pendingSite.price_id;
        try {
          const insertResult = await env.DB.prepare(
            'INSERT INTO pending_sites (user_email, subscription_id, site_domain, price_id, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).bind(
            normalizedEmail,
            pendingSite.subscription_id || null,
            siteName,
            sitePrice,
            pendingSite.quantity || 1,
            pendingSite.created_at || timestamp
          ).run();
          
          if (insertResult.success) {
            console.log(`[saveUserByEmail] ✅ Inserted pending site: ${siteName} with price: ${sitePrice}`);
          } else {
            console.error(`[saveUserByEmail] ❌ Failed to insert pending site: ${siteName}`, insertResult);
          }
        } catch (insertErr) {
          console.error(`[saveUserByEmail] ❌ Error inserting pending site ${siteName}:`, insertErr);
        }
      }
      
      if (sitesToDelete.length > 0 || sitesToInsert.length > 0) {
        console.log(`[saveUserByEmail] ✅ Pending sites sync complete: ${sitesToInsert.length} inserted, ${sitesToDelete.length} deleted`);
      }
    } else {
      console.log(`[saveUserByEmail] ⚠️ Skipping pending sites sync: pendingSites is ${userData.pendingSites === undefined ? 'undefined' : 'not an array'}`);
    }
    // If userData.pendingSites is undefined, don't modify the database - keep existing pending sites
    
  } catch (error) {
    console.error('Error saving user to database:', error);
    throw error;
  }
}

async function addOrUpdateCustomerInUser(env, email, customerId, subscriptionId, items, billingPeriod = null) {
  console.log(`[addOrUpdateCustomerInUser] 🔍 Starting database update for subscription...`);
  console.log(`[addOrUpdateCustomerInUser]   - Email: ${email}`);
  console.log(`[addOrUpdateCustomerInUser]   - Customer ID: ${customerId}`);
  console.log(`[addOrUpdateCustomerInUser]   - Subscription ID: ${subscriptionId}`);
  console.log(`[addOrUpdateCustomerInUser]   - Items count: ${items.length}`);
  console.log(`[addOrUpdateCustomerInUser]   - Billing period: ${billingPeriod || 'not set'}`);
  
  let user = await getUserByEmail(env, email);
  
  if (!user) {
    console.log(`[addOrUpdateCustomerInUser]   - Creating new user structure...`);
    // Create new user structure with email as primary key
    user = {
      email: email.toLowerCase().trim(),
      customers: [],
      licenses: [],
      pendingSites: [],
      created_at: Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000)
    };
  } else {
    console.log(`[addOrUpdateCustomerInUser]   - User exists with ${user.customers?.length || 0} customer(s)`);
  }
  
  // Find or create customer
  let customer = user.customers.find(c => c.customerId === customerId);
  if (!customer) {
    console.log(`[addOrUpdateCustomerInUser]   - Creating new customer: ${customerId}`);
    customer = {
      customerId: customerId,
      subscriptions: [],
      created_at: Math.floor(Date.now() / 1000)
    };
    user.customers.push(customer);
  } else {
    console.log(`[addOrUpdateCustomerInUser]   - Customer exists with ${customer.subscriptions?.length || 0} subscription(s)`);
  }
  
  // Find or create subscription
  let subscription = customer.subscriptions.find(s => s.subscriptionId === subscriptionId);
  if (!subscription) {
    console.log(`[addOrUpdateCustomerInUser]   - Creating new subscription: ${subscriptionId}`);
    subscription = {
      subscriptionId: subscriptionId,
      status: 'active',
      items: [],
      billingPeriod: billingPeriod, // Add billing period if provided
      created_at: Math.floor(Date.now() / 1000)
    };
    customer.subscriptions.push(subscription);
  } else {
    console.log(`[addOrUpdateCustomerInUser]   - Subscription exists with ${subscription.items?.length || 0} item(s)`);
    // Update billing period if provided and not already set
    if (billingPeriod && !subscription.billingPeriod) {
      console.log(`[addOrUpdateCustomerInUser]   - Updating billing period: ${billingPeriod}`);
      subscription.billingPeriod = billingPeriod;
    }
  }
  
  // Add/update items (merge with existing, avoid duplicates)
  let newItemsCount = 0;
  let updatedItemsCount = 0;
  items.forEach((item, idx) => {
    const existingItem = subscription.items.find(i => i.item_id === item.item_id);
    if (existingItem) {
      // Update existing item
      console.log(`[addOrUpdateCustomerInUser]   - Updating existing item ${idx + 1}: ${item.item_id} (site: ${item.site || 'N/A'})`);
      Object.assign(existingItem, item);
      updatedItemsCount++;
    } else {
      // Add new item
      console.log(`[addOrUpdateCustomerInUser]   - Adding new item ${idx + 1}: ${item.item_id} (site: ${item.site || 'N/A'})`);
      subscription.items.push(item);
      newItemsCount++;
    }
  });
  console.log(`[addOrUpdateCustomerInUser]   - Items summary: ${newItemsCount} new, ${updatedItemsCount} updated`);
  
  // Update subscription status and timestamp
  subscription.status = 'active';
  subscription.updated_at = Math.floor(Date.now() / 1000);
  
  console.log(`[addOrUpdateCustomerInUser]   - Saving user object to database...`);
  await saveUserByEmail(env, email, user);
  console.log(`[addOrUpdateCustomerInUser] ✅ Database update complete for subscription ${subscriptionId}`);
  return user;
}

// Helper function to get user by customerId (uses database)
async function getUserByCustomerId(env, customerId) {
  if (!env.DB) {
    console.warn('Database not configured, cannot get user by customerId');
    return null;
  }
  
  try {
    // Find email for this customerId
    const customerRes = await env.DB.prepare(
      'SELECT user_email FROM customers WHERE customer_id = ? LIMIT 1'
    ).bind(customerId).first();
    
    if (!customerRes || !customerRes.user_email) {
      return null;
    }
    
    // Get user by email
    return await getUserByEmail(env, customerRes.user_email);
  } catch (error) {
    console.error('Error getting user by customerId from database:', error);
    return null;
  }
}

// Helper function to save or update site details in database
async function saveOrUpdateSiteInDB(env, siteData) {
  if (!env.DB) {
    return;
  }
  
  try {
    const {
      customerId,
      subscriptionId,
      itemId,
      siteDomain,
      priceId,
      amountPaid,
      currency = 'usd',
      status = 'active',
      currentPeriodStart,
      currentPeriodEnd,
      renewalDate,
      cancelAtPeriodEnd = false,
      canceledAt = null
    } = siteData;
    
    const timestamp = Math.floor(Date.now() / 1000);
    
    // Check if site already exists
    const existing = await env.DB.prepare(
      'SELECT id FROM sites WHERE customer_id = ? AND subscription_id = ? AND site_domain = ?'
    ).bind(customerId, subscriptionId, siteDomain).first();
    
    if (existing) {
      // Update existing site
      await env.DB.prepare(
        `UPDATE sites SET
          item_id = ?,
          price_id = ?,
          amount_paid = ?,
          currency = ?,
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          renewal_date = ?,
          cancel_at_period_end = ?,
          canceled_at = ?,
          updated_at = ?
        WHERE customer_id = ? AND subscription_id = ? AND site_domain = ?`
      ).bind(
        itemId,
        priceId,
        amountPaid,
        currency,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        renewalDate,
        cancelAtPeriodEnd ? 1 : 0,
        canceledAt,
        timestamp,
        customerId,
        subscriptionId,
        siteDomain
      ).run();
    } else {
      // Insert new site
      await env.DB.prepare(
        `INSERT INTO sites (
          customer_id, subscription_id, item_id, site_domain, price_id,
          amount_paid, currency, status, current_period_start, current_period_end,
          renewal_date, cancel_at_period_end, canceled_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        customerId,
        subscriptionId,
        itemId,
        siteDomain,
        priceId,
        amountPaid,
        currency,
        status,
        currentPeriodStart,
        currentPeriodEnd,
        renewalDate,
        cancelAtPeriodEnd ? 1 : 0,
        canceledAt,
        timestamp,
        timestamp
      ).run();
    }
  } catch (error) {
    console.error('Error saving site to database:', error);
    // Don't throw - database save failure shouldn't break the flow
  }
}

/**
 * Helper function to extract billing_period from Stripe subscription
 * @param {Object} subscription - Stripe subscription object
 * @returns {string|null} - 'monthly', 'yearly', 'weekly', 'daily', or null
 */
function extractBillingPeriodFromStripe(subscription) {
  if (!subscription || !subscription.items || !subscription.items.data || subscription.items.data.length === 0) {
    return null;
  }
  
  const firstItem = subscription.items.data[0];
  if (firstItem.price && firstItem.price.recurring) {
    const interval = firstItem.price.recurring.interval;
    if (interval === 'month') {
      return 'monthly';
    } else if (interval === 'year') {
      return 'yearly';
    } else if (interval === 'week') {
      return 'weekly';
    } else if (interval === 'day') {
      return 'daily';
    } else {
      return interval; // fallback to raw value
    }
  }
  
  return null;
}

// Helper function to fetch license for a specific site
async function getLicenseForSite(env, siteDomain, customerId, subscriptionId) {
  if (!env.DB || !siteDomain) {
    return null;
  }
  
  try {
    // Try to find license by site_domain and subscription_id first (most specific)
    let license = await env.DB.prepare(
      'SELECT license_key, status, created_at FROM licenses WHERE site_domain = ? AND subscription_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(siteDomain, subscriptionId, 'active').first();
    
    // If not found, try with customer_id
    if (!license) {
      license = await env.DB.prepare(
        'SELECT license_key, status, created_at FROM licenses WHERE site_domain = ? AND customer_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1'
      ).bind(siteDomain, customerId, 'active').first();
    }
    
    if (license && license.license_key) {
      return {
        license_key: license.license_key,
        status: license.status || 'active',
        created_at: license.created_at
      };
    }
  } catch (error) {
    console.error('Error fetching license for site:', error);
  }
  
  return null;
}

// Helper function to fetch all licenses for multiple sites
async function getLicensesForSites(env, sites, customerId, subscriptionId) {
  if (!env.DB || !sites || sites.length === 0) {
    return {};
  }
  
  const licenseMap = {};
  
  try {
    // Fetch all licenses for this subscription
    const licenses = await env.DB.prepare(
      'SELECT license_key, site_domain, status, created_at FROM licenses WHERE subscription_id = ? AND status = ?'
    ).bind(subscriptionId, 'active').all();
    
    if (licenses && licenses.results) {
      licenses.results.forEach(license => {
        if (license.site_domain && license.license_key) {
          licenseMap[license.site_domain] = {
            license_key: license.license_key,
            status: license.status || 'active',
            created_at: license.created_at
          };
        }
      });
    }
  } catch (error) {
    console.error('Error fetching licenses for sites:', error);
  }
  
  return licenseMap;
}

// ============================================
// HIGH-SECURITY MAGIC LINK FUNCTIONS
// ============================================

// Generate cryptographically secure token (256 bits = 64 hex characters)
// REMOVED: Magic link utility functions - Not needed (Memberstack handles login)
// - generateSecureMagicLinkToken
// - checkRateLimit  
// - saveMagicLinkToken
// - verifyAndUseMagicLinkToken
// - logTokenAttempt
// - sendCustomMagicLinkEmail

// Utility: simple HMAC token (not a full JWT) for magic links
async function signToken(env, payload, expiresInSeconds = 60 * 60) {
  const secret = getEnvVar(env, 'JWT_SECRET');
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  payload.exp = exp;
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  ).then(key => crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigBase64}`;
}

async function verifyToken(env, token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, bodyB64, sigB64] = parts;
    const data = `${headerB64}.${bodyB64}`;
    const secret = getEnvVar(env, 'JWT_SECRET');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const sig = Uint8Array.from(atob(sigB64).split('').map(c => c.charCodeAt(0)));
    const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload = JSON.parse(atob(bodyB64));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// Fetch customer email from Stripe customer object
/**
 * Get price ID by billing period (monthly or yearly)
 * Checks database first, then falls back to environment variables
 */
// Get price_id and product_id from price_config table (optimized - no Stripe API call)
async function getPriceConfigByBillingPeriod(env, billingPeriod) {
  try {
    // Normalize billing period
    const normalizedPeriod = billingPeriod?.toLowerCase().trim();
    if (!normalizedPeriod || (normalizedPeriod !== 'monthly' && normalizedPeriod !== 'yearly')) {
      console.warn(`[getPriceConfigByBillingPeriod] Invalid billing period: ${billingPeriod}`);
      return null;
    }
    
    // Map to database price_type format
    const priceType = normalizedPeriod === 'monthly' ? 'monthly' : 'yearly';
    
    // Try database first
    if (env.DB) {
      try {
        // Get all available columns from price_config table
        // This handles cases where some columns might not exist yet
        const result = await env.DB.prepare(
          'SELECT * FROM price_config WHERE price_type = ? AND is_active = 1 LIMIT 1'
        ).bind(priceType).first();
        
        if (result) {
          // Extract available fields (handle missing columns gracefully)
          const config = {
            price_id: result.price_id || null,
            product_id: result.product_id || null,
            unit_amount: result.unit_amount || null,
            currency: result.currency || 'usd',
            discount_allowance: result.discount_allowance || null,
            discount_type: result.discount_type || null,
            coupon_code: result.coupon_code || null
          };
          
          // If price_id exists, return the config
          if (config.price_id) {
            console.log(`[getPriceConfigByBillingPeriod] Found config from database for ${priceType}:`, config);
            return config;
              } else {
            console.warn(`[getPriceConfigByBillingPeriod] Record found for ${priceType} but price_id is missing`);
          }
        }
      } catch (dbError) {
        console.warn(`[getPriceConfigByBillingPeriod] Database query failed:`, dbError);
        // If error is due to missing columns, try with basic query
        try {
          const basicResult = await env.DB.prepare(
            'SELECT price_id FROM price_config WHERE price_type = ? AND is_active = 1 LIMIT 1'
          ).bind(priceType).first();
          
          if (basicResult && basicResult.price_id) {
            console.log(`[getPriceConfigByBillingPeriod] Found price_id using basic query: ${basicResult.price_id}`);
            return {
              price_id: basicResult.price_id,
              product_id: null,
              unit_amount: null,
              currency: 'usd'
            };
          }
        } catch (basicError) {
          console.warn(`[getPriceConfigByBillingPeriod] Basic query also failed:`, basicError);
        }
      }
    }
    
    // Fallback to environment variables
    const fallbackPriceId = env.LICENSE_PRICE_ID || env.DEFAULT_PRICE_ID;
    if (fallbackPriceId) {
      console.log(`[getPriceConfigByBillingPeriod] Using fallback price_id from environment: ${fallbackPriceId}`);
      return { price_id: fallbackPriceId, product_id: null, unit_amount: null };
    }
    
    return null;
  } catch (error) {
    console.error(`[getPriceConfigByBillingPeriod] Error:`, error);
    return null;
  }
}

// Legacy function for backward compatibility
async function getPriceIdByBillingPeriod(env, billingPeriod) {
  const config = await getPriceConfigByBillingPeriod(env, billingPeriod);
  return config ? config.price_id : null;
}

async function getCustomerEmail(env, customerId) {
  try {
    const customerRes = await stripeFetch(env, `/customers/${customerId}`);
    if (customerRes.status === 200 && customerRes.body && customerRes.body.email) {
      return customerRes.body.email;
    } else {
      console.error(`[getCustomerEmail] Failed to fetch customer or email missing:`, customerRes.status);
      return null;
    }
  } catch (error) {
    console.error(`[getCustomerEmail] Error fetching customer:`, error);
    return null;
  }
}

// Basic auth cookie helper
// REMOVED: createSessionCookie - Only used by removed /auth/callback endpoint
function createSessionCookie_UNUSED(token, maxAge = 60 * 60 * 24 * 7) {
  const cookie = `sb_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  return cookie;
}

// Stripe helper using fetch
/**
 * Verify that payment was actually successful before marking invoice as paid
 * @param {Object} session - Stripe checkout session object
 * @param {Object} paymentIntent - Stripe payment intent object (optional, for payment mode)
 * @returns {boolean} - true if payment is verified as successful, false otherwise
 */
// Helper function to format site name with https:// prefix if needed
function formatSiteName(siteName) {
  if (!siteName) return null;
  const trimmed = siteName.trim();
  if (!trimmed) return null;
  
  // If already has http:// or https://, return as is
  if (trimmed.toLowerCase().startsWith('http://') || trimmed.toLowerCase().startsWith('https://')) {
    return trimmed;
  }
  
  // Otherwise, add https://
  return `https://${trimmed}`;
}

/**
 * Log Stripe webhook events to database for debugging and tracking
 * Stores logs in stripe_logs table in D1 database
 * @param {Object} env - Environment variables
 * @param {Object} event - Stripe webhook event object
 * @param {string} subscriptionId - Subscription ID (if available)
 * @param {string} customerId - Customer ID (if available)
 * @param {Object} additionalData - Additional data to log (status changes, etc.)
 */
async function logStripeEvent(env, event, subscriptionId = null, customerId = null, additionalData = {}) {
  try {
    if (!env.DB) {
      console.warn('[Stripe Log] Database not configured, skipping log storage');
      return;
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().split('T')[0]; // YYYY-MM-DD
    const eventId = event.id || `evt_${timestamp}`;
    const eventType = event.type || 'unknown';
    
    // Extract subscription ID from event if not provided
    if (!subscriptionId && event.data?.object) {
      subscriptionId = event.data.object.subscription || 
                       event.data.object.id || 
                       event.data.object.subscription_id || 
                       null;
    }
    
    // Extract customer ID from event if not provided
    if (!customerId && event.data?.object) {
      customerId = event.data.object.customer || 
                   event.data.object.customer_id || 
                   null;
    }

    // Prepare event data for storage (store as JSON string)
    const eventData = {
      id: event.id,
      type: event.type,
      created: event.created,
      livemode: event.livemode,
      object: event.data?.object ? {
        id: event.data.object.id,
        object: event.data.object.object,
        status: event.data.object.status,
        cancel_at_period_end: event.data.object.cancel_at_period_end,
        canceled_at: event.data.object.canceled_at,
        current_period_end: event.data.object.current_period_end,
        current_period_start: event.data.object.current_period_start,
      } : null
    };

    // Store additional data as JSON string
    const additionalDataJson = JSON.stringify(additionalData);
    const eventDataJson = JSON.stringify(eventData);

    // Insert into stripe_logs table
    // Table schema: id (AUTOINCREMENT), timestamp, date, event_id, event_type, subscription_id, customer_id, event_data (TEXT/JSON), additional_data (TEXT/JSON), created_at
    await env.DB.prepare(
      `INSERT INTO stripe_logs 
       (timestamp, date, event_id, event_type, subscription_id, customer_id, event_data, additional_data, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timestamp,
      date,
      eventId,
      eventType,
      subscriptionId,
      customerId,
      eventDataJson,
      additionalDataJson,
      timestamp
    ).run();
    
    console.log(`[Stripe Log] ✅ Logged event ${eventType} for subscription ${subscriptionId || 'N/A'} at ${date} ${new Date(timestamp * 1000).toISOString()}`);
  } catch (error) {
    console.error('[Stripe Log] ❌ Error logging Stripe event:', error);
    // Don't throw - logging failures shouldn't break webhook processing
    // If table doesn't exist, log warning but continue
    if (error.message && error.message.includes('no such table: stripe_logs')) {
      console.warn('[Stripe Log] ⚠️ stripe_logs table does not exist. Please run the migration to create it.');
    }
  }
}

// Helper function to save subscription data to KV storage
async function saveSubscriptionToKV(env, customerId, subscriptionId, email, siteName, subscriptionStatus = 'complete', paymentStatus = 'paid', cancelAtPeriodEnd = false) {
  try {
    if (!env.ACTIVE_SITES_CONSENTBIT || !env.SUBSCRIPTION_CONSENTBIT) {
      console.warn('[KV] KV namespaces not configured, skipping KV storage');
      return;
    }
    
    const now = new Date().toISOString();
    const formattedSiteName = formatSiteName(siteName);
    
    if (!formattedSiteName) {
      console.warn('[KV] No site name provided, skipping KV storage');
      return;
    }
    
    // Save to ACTIVE_SITES_CONSENTBIT with fixed ID: 66c7aa5c7fcb4c2a8dfec5463e86a293
    const activeSitesData = {
      active: subscriptionStatus === 'complete' || subscriptionStatus === 'active',
      subscriptionId: subscriptionId,
      customerId: customerId,
      email: email,
      status: subscriptionStatus,
      lastUpdated: now,
      cancelAtPeriodEnd: cancelAtPeriodEnd
    };
    
    await env.ACTIVE_SITES_CONSENTBIT.put('66c7aa5c7fcb4c2a8dfec5463e86a293', JSON.stringify(activeSitesData));
    console.log('[KV] ✅ Saved to ACTIVE_SITES_CONSENTBIT with ID: 66c7aa5c7fcb4c2a8dfec5463e86a293');
    
    // Save to SUBSCRIPTION_CONSENTBIT with key: customerId-subscriptionId
    const subscriptionKey = `${customerId}-${subscriptionId}`;
    const subscriptionData = {
      email: email,
      connectDomain: formattedSiteName,
      isSubscribed: subscriptionStatus === 'complete' || subscriptionStatus === 'active',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      subscriptionStatus: subscriptionStatus,
      paymentStatus: paymentStatus,
      created: now,
      lastUpdated: now
    };
    
    await env.SUBSCRIPTION_CONSENTBIT.put(subscriptionKey, JSON.stringify(subscriptionData));
    console.log(`[KV] ✅ Saved to SUBSCRIPTION_CONSENTBIT with key: ${subscriptionKey}`);
    
  } catch (error) {
    console.error('[KV] ❌ Error saving to KV storage:', error);
    // Don't throw - KV storage is optional, don't fail the main operation
  }
}

// Helper function to save license key data to KV storage (for quantity purchases)
async function saveLicenseKeyToKV(env, licenseKey, customerId, subscriptionId, email, subscriptionStatus = 'complete', cancelAtPeriodEnd = false, siteName = null) {
  try {
    if (!env.ACTIVE_SITES_CONSENTBIT) {
      console.warn('[KV] ACTIVE_SITES_CONSENTBIT namespace not configured, skipping KV storage');
      return;
    }
    
    const now = new Date().toISOString();
    
    const activeSitesData = {
      active: subscriptionStatus === 'complete' || subscriptionStatus === 'active',
      subscriptionId: subscriptionId,
      customerId: customerId,
      email: email,
      status: subscriptionStatus,
      lastUpdated: now,
      cancelAtPeriodEnd: cancelAtPeriodEnd
    };
    
    // If site name is provided (license key is activated), use connectDomain as the KV key
    if (siteName) {
      const formattedSiteName = formatSiteName(siteName);
      if (formattedSiteName) {
        activeSitesData.connectDomain = formattedSiteName;
        
        // Use connectDomain as the KV key instead of license key
        await env.ACTIVE_SITES_CONSENTBIT.put(formattedSiteName, JSON.stringify(activeSitesData));
        console.log(`[KV] ✅ Saved license key to ACTIVE_SITES_CONSENTBIT with key: ${formattedSiteName} (connectDomain)`);
        
        // Delete old KV entry if it was keyed by license key (for backward compatibility)
        // Note: This is a safety check - the activate-license endpoint also deletes old entries
        try {
          const oldEntry = await env.ACTIVE_SITES_CONSENTBIT.get(licenseKey);
          if (oldEntry) {
            await env.ACTIVE_SITES_CONSENTBIT.delete(licenseKey);
            console.log(`[KV] 🗑️ Deleted old KV entry keyed by license key: ${licenseKey}`);
          }
        } catch (deleteErr) {
          // Entry might not exist or already deleted - that's okay
          // Non-critical, continue
        }
      } else {
        // If formatting failed, fall back to license key as the key
        await env.ACTIVE_SITES_CONSENTBIT.put(licenseKey, JSON.stringify(activeSitesData));
        console.log(`[KV] ✅ Saved license key to ACTIVE_SITES_CONSENTBIT with key: ${licenseKey} (fallback)`);
      }
    } else {
      // If no site name, use license key as the key (license not activated yet)
      await env.ACTIVE_SITES_CONSENTBIT.put(licenseKey, JSON.stringify(activeSitesData));
      console.log(`[KV] ✅ Saved license key to ACTIVE_SITES_CONSENTBIT with key: ${licenseKey} (not activated)`);
    }
    
  } catch (error) {
    console.error('[KV] ❌ Error saving license key to KV storage:', error);
    // Don't throw - KV storage is optional, don't fail the main operation
  }
}

function verifyPaymentSuccess(session, paymentIntent = null) {
  // Verify checkout session payment status
  if (session.payment_status !== 'paid') {
    console.warn(`[verifyPaymentSuccess] ❌ Session payment_status is '${session.payment_status}', not 'paid'`);
    return false;
  }
  
  // Verify checkout session status
  if (session.status !== 'complete') {
    console.warn(`[verifyPaymentSuccess] ❌ Session status is '${session.status}', not 'complete'`);
    return false;
  }
  
  // For payment mode, also verify payment intent status
  if (session.mode === 'payment' && paymentIntent) {
    if (paymentIntent.status !== 'succeeded') {
      console.warn(`[verifyPaymentSuccess] ❌ PaymentIntent status is '${paymentIntent.status}', not 'succeeded'`);
      return false;
    }
  }
  
  // All checks passed
  return true;
}

// ========================================
// QUEUE-BASED PROCESSING FUNCTIONS
// ========================================

/**
 * Add subscription creation task to queue
 * Used for large quantity purchases to prevent webhook timeouts
 */
async function addToSubscriptionQueue(env, queueData) {
  const {
    customerId,
    userEmail,
    paymentIntentId,
    priceId,
    licenseKey,
    quantity,
    trialEnd
  } = queueData;
  
  const queueId = `queue_${paymentIntentId}_${licenseKey}_${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  
  try {
    // CRITICAL: Check if a queue item with the same payment_intent_id and license_key already exists
    // This prevents duplicate queue entries if the webhook is called multiple times
    const existingQueueItem = await env.DB.prepare(
      `SELECT queue_id, status FROM subscription_queue 
       WHERE payment_intent_id = ? AND license_key = ? 
       AND status IN ('pending', 'processing', 'completed')
       LIMIT 1`
    ).bind(paymentIntentId, licenseKey).first();
    
    if (existingQueueItem) {
      console.log(`[QUEUE] ⚠️ Queue item already exists for payment_intent_id=${paymentIntentId}, license_key=${licenseKey} (status: ${existingQueueItem.status}, queue_id: ${existingQueueItem.queue_id}). Skipping duplicate entry.`);
      return { success: true, queueId: existingQueueItem.queue_id, skipped: true, reason: 'duplicate' };
    }
    
    await env.DB.prepare(
      `INSERT INTO subscription_queue 
       (queue_id, customer_id, user_email, payment_intent_id, price_id, license_key, quantity, trial_end, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      queueId,
      customerId,
      userEmail,
      paymentIntentId,
      priceId,
      licenseKey,
      quantity,
      trialEnd || null,
      timestamp,
      timestamp
    ).run();
    
    return { success: true, queueId };
  } catch (error) {
    console.error(`[QUEUE] ❌ Error adding to queue:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Process a single subscription from the queue
 */
async function processQueueItem(env, queueItem) {
  const {
    queue_id,
    customer_id,
    user_email,
    payment_intent_id,
    price_id,
    license_key: originalLicenseKey,
    trial_end
  } = queueItem;
  
  // STEP: Replace temporary license key with real unique key if needed
  let license_key = originalLicenseKey;
  if (isTemporaryLicenseKey(originalLicenseKey)) {
    console.log(`[USE CASE 3 - QUEUE] 🔄 Replacing temporary license key "${originalLicenseKey}" with real unique key...`);
    license_key = await generateUniqueLicenseKey(env);
    console.log(`[USE CASE 3 - QUEUE] ✅ Replaced temporary key "${originalLicenseKey}" with real key "${license_key}"`);
    
    // Update the queue item with the real license key
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      await env.DB.prepare(
        `UPDATE subscription_queue SET license_key = ?, updated_at = ? WHERE queue_id = ?`
      ).bind(license_key, timestamp, queue_id).run();
      console.log(`[USE CASE 3 - QUEUE] ✅ Updated queue item with real license key`);
    } catch (updateErr) {
      console.warn(`[USE CASE 3 - QUEUE] ⚠️ Could not update queue item with real license key:`, updateErr);
      // Continue anyway - we'll use the real key for subscription creation
    }
  }
  
  console.log(`[USE CASE 3 - QUEUE] 🔍 Processing queue item for license: ${license_key}`);
  console.log(`[USE CASE 3 - QUEUE] 📋 Queue Details:`, {
    queue_id,
    customer_id,
    user_email,
    payment_intent_id,
    price_id,
    license_key,
    original_license_key: originalLicenseKey !== license_key ? originalLicenseKey : null,
    trial_end: trial_end ? new Date(trial_end * 1000).toISOString() : null
  });
  
  try {
    // CRITICAL: Check if subscription already exists for this license (may have been created immediately)
    // Also check if another queue item for this license_key has already been processed
    // This prevents race conditions when multiple queue items exist for the same license_key
    let existingSubscriptionId = null;
    let existingItemId = null;
    try {
      // First check: Look for existing license with subscription in licenses table
      const existingLicense = await env.DB.prepare(
        `SELECT subscription_id, item_id FROM licenses WHERE license_key = ? AND subscription_id IS NOT NULL LIMIT 1`
      ).bind(license_key).first();
      
      if (existingLicense && existingLicense.subscription_id) {
        existingSubscriptionId = existingLicense.subscription_id;
        existingItemId = existingLicense.item_id || null;
        console.log(`[USE CASE 3 - QUEUE] ✅ Subscription already exists for license ${license_key}: ${existingSubscriptionId}`);
      } else {
        // Second check: Look for completed queue items for this license_key (to catch race conditions)
        const completedQueueItem = await env.DB.prepare(
          `SELECT subscription_id, item_id FROM subscription_queue 
           WHERE license_key = ? AND status = 'completed' AND subscription_id IS NOT NULL
           ORDER BY processed_at DESC LIMIT 1`
        ).bind(license_key).first();
        
        if (completedQueueItem && completedQueueItem.subscription_id) {
          existingSubscriptionId = completedQueueItem.subscription_id;
          existingItemId = completedQueueItem.item_id || null;
          console.log(`[USE CASE 3 - QUEUE] ✅ Another queue item for license ${license_key} already completed with subscription: ${existingSubscriptionId}`);
        } else {
          console.log(`[USE CASE 3 - QUEUE] ℹ️ No existing subscription found for license ${license_key}, creating new one`);
        }
      }
    } catch (checkErr) {
      console.warn(`[USE CASE 3 - QUEUE] ⚠️ Could not check for existing subscription:`, checkErr);
    }
    
    // If subscription already exists, mark queue item as completed and return
    if (existingSubscriptionId) {
      const timestamp = Math.floor(Date.now() / 1000);
      
      // OPTIMIZATION: Single UPDATE query instead of separate SELECT + UPDATE
      await env.DB.prepare(
        `UPDATE subscription_queue 
         SET status = 'completed', subscription_id = ?, item_id = ?, processed_at = ?, updated_at = ?
         WHERE queue_id = ?`
      ).bind(existingSubscriptionId, existingItemId, timestamp, timestamp, queue_id).run();
      
      console.log(`[USE CASE 3 - QUEUE] ✅ Queue item ${queue_id} marked as completed (subscription already existed)`);
      return { success: true, subscriptionId: existingSubscriptionId, itemId: existingItemId, skipped: true };
    }
    
    // CRITICAL: Final duplicate check right before creating subscription
    // Double-check that no subscription was created while we were processing
    // This is a last line of defense against race conditions
    try {
      const finalCheck = await env.DB.prepare(
        `SELECT subscription_id, item_id FROM licenses WHERE license_key = ? AND subscription_id IS NOT NULL LIMIT 1`
      ).bind(license_key).first();
      
      if (finalCheck && finalCheck.subscription_id) {
        console.log(`[USE CASE 3 - QUEUE] ⚠️ Subscription was created for license ${license_key} while processing (race condition detected): ${finalCheck.subscription_id}`);
        // Mark queue item as completed with existing subscription
        const timestamp = Math.floor(Date.now() / 1000);
        await env.DB.prepare(
          `UPDATE subscription_queue 
           SET status = 'completed', subscription_id = ?, item_id = ?, processed_at = ?, updated_at = ?
           WHERE queue_id = ?`
        ).bind(finalCheck.subscription_id, finalCheck.item_id || null, timestamp, timestamp, queue_id).run();
        
        return { success: true, subscriptionId: finalCheck.subscription_id, itemId: finalCheck.item_id || null, skipped: true, reason: 'duplicate_detected' };
      }
    } catch (finalCheckErr) {
      console.warn(`[USE CASE 3 - QUEUE] ⚠️ Final duplicate check failed (continuing anyway):`, finalCheckErr);
    }
    
    // Create subscription
    console.log(`[USE CASE 3 - QUEUE] 🚀 Creating individual subscription for license ${license_key}...`);
    const createSubRes = await stripeFetch(env, '/subscriptions', 'POST', {
      'customer': customer_id,
      'items[0][price]': price_id,
      'items[0][quantity]': 1,
      'metadata[license_key]': license_key,
      'metadata[usecase]': '3',
      'metadata[purchase_type]': 'quantity',
      'proration_behavior': 'none',
      'collection_method': 'charge_automatically',
      'trial_end': trial_end ? trial_end.toString() : undefined
    }, true);
    
    if (createSubRes.status === 200) {
      const subscription = createSubRes.body;
      const subscriptionId = subscription.id;
      const itemId = subscription.items?.data?.[0]?.id || null;
      
      console.log(`[USE CASE 3 - QUEUE] ✅ Individual subscription created successfully!`);
      console.log(`[USE CASE 3 - QUEUE] 📊 Subscription Details:`, {
        license_key,
        subscription_id: subscriptionId,
        item_id: itemId,
        customer_id,
        status: subscription.status,
        current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
        current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null,
        trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
      });
      
      const timestamp = Math.floor(Date.now() / 1000);
      
      // Fetch billing_period and renewal_date from Stripe subscription
      let billingPeriod = null;
      // Stripe automatically calculates current_period_end correctly:
      // - If trial_end exists: current_period_end = trial_end + billing_interval
      // - If no trial: current_period_end = now + billing_interval
      // So we can use current_period_end directly - it's already the correct renewal date
      let renewalDate = subscription.current_period_end || null;
      
      // Get billing period from subscription items
      if (subscription.items && subscription.items.data && subscription.items.data.length > 0) {
        const firstItem = subscription.items.data[0];
        if (firstItem.price && firstItem.price.recurring) {
          const interval = firstItem.price.recurring.interval;
          if (interval === 'month') {
            billingPeriod = 'monthly';
          } else if (interval === 'year') {
            billingPeriod = 'yearly';
          } else if (interval === 'week') {
            billingPeriod = 'weekly';
          } else if (interval === 'day') {
            billingPeriod = 'daily';
          } else {
            billingPeriod = interval;
          }
          
          // Stripe sets current_period_end = billing_cycle_anchor + billing_interval
          // When trial_end is set, billing_cycle_anchor = trial_end
          // So current_period_end = trial_end + billing_interval (already correct!)
          // No need to calculate manually - use Stripe's value directly
        }
      }
      
      // CRITICAL: Save license and subscription records FIRST before marking as completed
      // If database save fails, we should retry, not mark as completed
      let licenseSaved = false;
      let subscriptionSaved = false;
      
      // Save license to database (for dashboard display)
      try {
        const insertResult = await env.DB.prepare(
          `INSERT INTO licenses 
           (license_key, customer_id, subscription_id, item_id, site_domain, used_site_domain, status, purchase_type, billing_period, renewal_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          license_key,
          customer_id,
          subscriptionId,
          itemId || null,
          null,
          null,
          'active',
          'quantity',
          billingPeriod,
          renewalDate,
          timestamp,
          timestamp
        ).run();
        
        if (insertResult.success) {
          licenseSaved = true;
          console.log(`[USE CASE 3 - QUEUE] ✅ License saved to database:`, {
            license_key,
            subscription_id: subscriptionId,
            item_id: itemId,
            customer_id,
            purchase_type: 'quantity',
            billing_period: billingPeriod,
            renewal_date: renewalDate ? new Date(renewalDate * 1000).toISOString() : null,
            created_at: new Date(timestamp * 1000).toISOString()
          });
          
          // Verify the license was saved correctly
          const verifyLicense = await env.DB.prepare(
            `SELECT license_key, subscription_id, item_id, customer_id, purchase_type, billing_period, renewal_date 
             FROM licenses WHERE license_key = ? LIMIT 1`
          ).bind(license_key).first();
          
          if (verifyLicense) {
            console.log(`[USE CASE 3 - QUEUE] ✅ Verified license in database:`, {
              license_key: verifyLicense.license_key,
              subscription_id: verifyLicense.subscription_id,
              item_id: verifyLicense.item_id,
              customer_id: verifyLicense.customer_id,
              purchase_type: verifyLicense.purchase_type,
              billing_period: verifyLicense.billing_period,
              renewal_date: verifyLicense.renewal_date ? new Date(verifyLicense.renewal_date * 1000).toISOString() : null
            });
        } else {
            console.error(`[USE CASE 3 - QUEUE] ❌ License verification failed - license not found in database after insert!`);
          }
        } else {
          console.error(`[USE CASE 3 - QUEUE] ❌ Database insert returned success=false for license ${license_key}`);
          throw new Error(`Database insert failed for license ${license_key}`);
        }
      } catch (licenseErr) {
        if (licenseErr.message && licenseErr.message.includes('UNIQUE constraint')) {
          console.warn(`[USE CASE 3 - QUEUE] ⚠️ License ${license_key} already exists in database, skipping`);
          licenseSaved = true; // Already exists, consider it saved
        } else {
          console.error(`[USE CASE 3 - QUEUE] ❌ Error saving license ${license_key}:`, licenseErr);
          // If license save fails, throw error to trigger retry
          throw new Error(`Failed to save license to database: ${licenseErr.message || String(licenseErr)}`);
        }
      }
      
      // Save subscription record to subscriptions table (for dashboard)
      console.log(`[USE CASE 3 - QUEUE] 💾 Saving subscription record to subscriptions table...`);
      try {
        const subInsertResult = await env.DB.prepare(
          `INSERT OR REPLACE INTO subscriptions 
           (user_email, customer_id, subscription_id, status, cancel_at_period_end, cancel_at, 
            current_period_start, current_period_end, billing_period, created_at, updated_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          user_email,
          customer_id,
          subscriptionId,
          subscription.status || 'active',
          0, // cancel_at_period_end
          null, // cancel_at
          subscription.current_period_start || null,
          subscription.current_period_end || null,
          billingPeriod, // billing_period from Stripe subscription
          timestamp,
          timestamp
        ).run();
        
        if (subInsertResult.success) {
        subscriptionSaved = true;
          console.log(`[USE CASE 3 - QUEUE] ✅ Subscription record saved to database:`, {
            subscription_id: subscriptionId,
            customer_id,
            user_email,
            status: subscription.status || 'active',
            billing_period: billingPeriod,
            current_period_start: subscription.current_period_start ? new Date(subscription.current_period_start * 1000).toISOString() : null,
            current_period_end: subscription.current_period_end ? new Date(subscription.current_period_end * 1000).toISOString() : null
          });
          
          // Verify the subscription was saved correctly
          const verifySub = await env.DB.prepare(
            `SELECT subscription_id, customer_id, user_email, status, billing_period, current_period_end 
             FROM subscriptions WHERE subscription_id = ? LIMIT 1`
          ).bind(subscriptionId).first();
          
          if (verifySub) {
            console.log(`[USE CASE 3 - QUEUE] ✅ Verified subscription in database:`, {
              subscription_id: verifySub.subscription_id,
              customer_id: verifySub.customer_id,
              user_email: verifySub.user_email,
              status: verifySub.status,
              billing_period: verifySub.billing_period,
              current_period_end: verifySub.current_period_end ? new Date(verifySub.current_period_end * 1000).toISOString() : null
            });
          } else {
            console.error(`[USE CASE 3 - QUEUE] ❌ Subscription verification failed - subscription not found in database after insert!`);
          }
        } else {
          console.error(`[USE CASE 3 - QUEUE] ❌ Subscription record insert returned success=false`);
          throw new Error(`Subscription record insert failed`);
        }
      } catch (subErr) {
        console.error(`[USE CASE 3 - QUEUE] ❌ Error saving subscription record:`, subErr);
        // If subscription record save fails, throw error to trigger retry
        throw new Error(`Failed to save subscription record to database: ${subErr.message || String(subErr)}`);
      }
      
      // Only mark as completed AFTER all critical database operations succeed
      if (licenseSaved && subscriptionSaved) {
        await env.DB.prepare(
          `UPDATE subscription_queue 
           SET status = 'completed', subscription_id = ?, item_id = ?, processed_at = ?, updated_at = ?
           WHERE queue_id = ?`
        ).bind(subscriptionId, itemId, timestamp, timestamp, queue_id).run();
        
        console.log(`[USE CASE 3 - QUEUE] ✅ Queue item ${queue_id} marked as completed`);
        console.log(`[USE CASE 3 - QUEUE] 📊 Final Summary for License ${license_key}:`, {
          license_key,
          subscription_id: subscriptionId,
          item_id: itemId,
          customer_id,
          user_email,
          billing_period: billingPeriod,
          renewal_date: renewalDate ? new Date(renewalDate * 1000).toISOString() : null,
          queue_status: 'completed',
          processed_at: new Date(timestamp * 1000).toISOString()
        });
        
        // Verify one-to-one relationship: Each license has exactly one subscription
        const verifyRelationship = await env.DB.prepare(
          `SELECT l.license_key, l.subscription_id, l.item_id, s.subscription_id as sub_id, s.status as sub_status
           FROM licenses l
           LEFT JOIN subscriptions s ON l.subscription_id = s.subscription_id
           WHERE l.license_key = ? LIMIT 1`
        ).bind(license_key).first();
        
        if (verifyRelationship && verifyRelationship.subscription_id === verifyRelationship.sub_id) {
          console.log(`[USE CASE 3 - QUEUE] ✅ Verified one-to-one relationship: License ${license_key} → Subscription ${verifyRelationship.subscription_id}`);
        } else {
          console.error(`[USE CASE 3 - QUEUE] ❌ Relationship verification failed! License ${license_key} subscription mismatch.`);
        }
        
        // Save to KV storage (for license key purchase - queue processing)
        try {
          console.log(`[USE CASE 3 - QUEUE] 💾 Saving license key to KV storage: ${license_key}`);
          await saveLicenseKeyToKV(
            env,
            license_key,
            customer_id,
            subscriptionId,
            user_email,
            'complete', // License keys start as complete/active
            false, // cancelAtPeriodEnd (will be updated when subscription status changes)
            null // No site name yet (not activated)
          );
        } catch (kvErr) {
          console.error(`[USE CASE 3 - QUEUE] ⚠️ Error saving license key to KV storage (non-blocking):`, kvErr);
          // Don't fail the whole operation if KV save fails
        }
      } else {
        throw new Error('License or subscription record was not saved successfully');
      }
      
      // Save payment record (for dashboard payment history)
      // OPTIMIZATION: Make payment record saving non-blocking to prevent timeouts
      // Use a separate async operation that doesn't block the main flow
      (async () => {
        try {
          // Get price amount for payment record
          let amountPerSubscription = 0;
          let currency = 'usd';
          try {
            const priceRes = await stripeFetch(env, `/prices/${price_id}`);
            if (priceRes.status === 200) {
              amountPerSubscription = priceRes.body.unit_amount || 0;
              currency = priceRes.body.currency || 'usd';
            }
          } catch (priceErr) {
            console.warn(`[QUEUE] ⚠️ Could not fetch price for payment record:`, priceErr);
          }
          
          await env.DB.prepare(
            `INSERT INTO payments (
              customer_id, subscription_id, email, amount, currency, 
              status, site_domain, magic_link, magic_link_generated, 
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            customer_id,
            subscriptionId,
            user_email,
            amountPerSubscription,
            currency,
            'succeeded',
            null, // site_domain (null for quantity purchases)
            null, // magic_link
            0, // magic_link_generated
            timestamp,
            timestamp
          ).run();
        } catch (paymentErr) {
          console.error(`[QUEUE] ⚠️ Error saving payment record (non-blocking):`, paymentErr);
          // Don't fail the whole operation if payment record save fails
        }
      })(); // Fire and forget - don't await to prevent timeout
      
      return { success: true, subscriptionId, itemId };
    } else {
      throw new Error(`Subscription creation failed: ${createSubRes.status} - ${JSON.stringify(createSubRes.body)}`);
    }
  } catch (error) {
    // Update queue item as failed and schedule retry
    const attempts = (queueItem.attempts || 0) + 1;
    const maxAttempts = queueItem.max_attempts || 3;
    const nextRetryAt = attempts < maxAttempts 
      ? Math.floor(Date.now() / 1000) + (Math.pow(2, attempts) * 60) // Exponential backoff: 2min, 4min, 8min
      : null;
    const status = attempts >= maxAttempts ? 'failed' : 'pending';
    
    const timestamp = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE subscription_queue 
       SET status = ?, attempts = ?, error_message = ?, next_retry_at = ?, updated_at = ?
       WHERE queue_id = ?`
    ).bind(status, attempts, error.message || String(error), nextRetryAt, timestamp, queue_id).run();
    
    console.error(`[QUEUE] ❌ Failed to process queue item ${queue_id} (attempt ${attempts}/${maxAttempts}):`, error);
    
    if (attempts >= maxAttempts) {
      console.error(`[QUEUE] 🚨 Queue item ${queue_id} has exceeded max attempts (${maxAttempts}). Marking as failed - refund will be processed after 12 hours if still incomplete.`);
      console.error(`[QUEUE] 🚨 License: ${license_key}, Customer: ${customer_id}, Payment Intent: ${payment_intent_id}`);
      
      // Don't refund immediately - refund will be processed by scheduled job after 12 hours
      // This gives the system time to retry and allows for manual intervention if needed
    } else {
    }
    
    return { success: false, error: error.message, attempts };
  }
}

/**
 * Process refund for a permanently failed queue item
 */
async function processRefundForFailedQueueItem(env, queueItem) {
  const {
    queue_id,
    payment_intent_id,
    price_id,
    license_key
  } = queueItem;
  
  try {
    // Get payment intent to find charge ID
    const piRes = await stripeFetch(env, `/payment_intents/${payment_intent_id}`);
    if (piRes.status !== 200) {
      console.error(`[QUEUE] ❌ Could not fetch payment intent ${payment_intent_id} for refund`);
      return { success: false, error: 'payment_intent_not_found' };
    }
    
    const paymentIntent = piRes.body;
    
    // Get charge ID from payment intent
    let chargeId = null;
    if (paymentIntent.latest_charge) {
      chargeId = typeof paymentIntent.latest_charge === 'string' 
        ? paymentIntent.latest_charge 
        : paymentIntent.latest_charge.id;
    } else if (paymentIntent.charges?.data?.length > 0) {
      chargeId = paymentIntent.charges.data[0].id;
    }
    
    if (!chargeId) {
      console.error(`[QUEUE] ❌ Could not find charge ID for refund. Payment Intent: ${payment_intent_id}`);
      return { success: false, error: 'charge_not_found' };
    }
    
    // Get price details to calculate refund amount
    let refundAmount = 0;
    let currency = 'usd';
    
    try {
      const priceRes = await stripeFetch(env, `/prices/${price_id}`);
      if (priceRes.status === 200) {
        const price = priceRes.body;
        refundAmount = price.unit_amount || 0;
        currency = price.currency || 'usd';
      } else {
        // Fallback: Use payment intent amount divided by quantity
        // We need to get the total quantity from the payment intent metadata
        const quantity = parseInt(paymentIntent.metadata?.quantity) || 1;
        if (paymentIntent.amount && quantity > 0) {
          refundAmount = Math.round(paymentIntent.amount / quantity);
          currency = paymentIntent.currency || 'usd';
        }
      }
    } catch (priceErr) {
      console.warn(`[QUEUE] ⚠️ Could not get price for refund calculation:`, priceErr);
      // Fallback: Use payment intent amount divided by quantity
      const quantity = parseInt(paymentIntent.metadata?.quantity) || 1;
      if (paymentIntent.amount && quantity > 0) {
        refundAmount = Math.round(paymentIntent.amount / quantity);
        currency = paymentIntent.currency || 'usd';
      }
    }
    
    if (refundAmount > 0) {
      // Create refund
      const refundRes = await stripeFetch(env, '/refunds', 'POST', {
        'charge': chargeId,
        'amount': refundAmount,
        'metadata[reason]': 'subscription_creation_failed_after_retries',
        'metadata[queue_id]': queue_id,
        'metadata[license_key]': license_key,
        'metadata[payment_intent_id]': payment_intent_id,
        'metadata[attempts]': queueItem.attempts?.toString() || '3'
      }, true);
      
      if (refundRes.status === 200) {
        const refund = refundRes.body;
        
        const timestamp = Math.floor(Date.now() / 1000);
        
        // Save refund record to database
        try {
          await env.DB.prepare(
            `INSERT INTO refunds (
              refund_id, payment_intent_id, charge_id, customer_id, user_email,
              amount, currency, status, reason, queue_id, license_key,
              subscription_id, attempts, metadata, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).bind(
            refund.id,
            payment_intent_id,
            chargeId,
            queueItem.customer_id,
            queueItem.user_email || null,
            refundAmount,
            currency,
            refund.status || 'succeeded',
            'subscription_creation_failed_after_retries',
            queue_id,
            license_key,
            null, // subscription_id (not created)
            queueItem.attempts || 3,
            JSON.stringify({
              reason: 'subscription_creation_failed_after_retries',
              queue_id: queue_id,
              license_key: license_key,
              payment_intent_id: payment_intent_id,
              attempts: queueItem.attempts || 3
            }),
            timestamp,
            timestamp
          ).run();
        } catch (refundDbErr) {
          if (refundDbErr.message && refundDbErr.message.includes('UNIQUE constraint')) {
            console.warn(`[QUEUE] ⚠️ Refund ${refund.id} already exists in database, skipping`);
          } else {
            console.error(`[QUEUE] ⚠️ Error saving refund record:`, refundDbErr);
            // Don't fail the whole operation if refund record save fails
          }
        }
        
        // Update queue item with refund information
        await env.DB.prepare(
          `UPDATE subscription_queue 
           SET error_message = ?, updated_at = ?
           WHERE queue_id = ?`
        ).bind(
          `${queueItem.error_message || 'Subscription creation failed'} | REFUNDED: ${refund.id} (${refundAmount} ${currency})`,
          timestamp,
          queue_id
        ).run();
        
        return { success: true, refundId: refund.id, amount: refundAmount, currency };
      } else {
        console.error(`[QUEUE] ❌ Failed to create refund:`, refundRes.status, refundRes.body);
        return { success: false, error: 'refund_creation_failed', details: refundRes.body };
      }
    } else {
      console.warn(`[QUEUE] ⚠️ Refund amount is 0, skipping refund creation`);
      return { success: false, error: 'zero_refund_amount' };
    }
  } catch (refundErr) {
    console.error(`[QUEUE] ❌ Error processing refund for queue item ${queue_id}:`, refundErr);
    return { success: false, error: refundErr.message || String(refundErr) };
  }
}

/**
 * Process refunds for failed queue items that are older than 12 hours
 * Only refunds items that have exhausted all retry attempts and are still failed
 */
async function processRefundsForOldFailedItems(env, limit = 50) {
  const timestamp = Math.floor(Date.now() / 1000);
  const twelveHoursAgo = timestamp - (12 * 60 * 60); // 12 hours in seconds
  
  try {
    // Get failed items that are older than 12 hours and haven't been refunded yet
    const failedItems = await env.DB.prepare(
      `SELECT * FROM subscription_queue 
       WHERE status = 'failed' 
       AND created_at <= ?
       AND error_message NOT LIKE '%REFUNDED:%'
       ORDER BY created_at ASC
       LIMIT ?`
    ).bind(twelveHoursAgo, limit).all();
    
    if (failedItems.results.length === 0) {
      return { processed: 0, refunded: 0, message: 'No old failed items to refund' };
    }
    
    
    let refundedCount = 0;
    let errorCount = 0;
    
    for (const item of failedItems.results) {
      try {
        const refundResult = await processRefundForFailedQueueItem(env, item);
        if (refundResult.success) {
          refundedCount++;
        } else {
          errorCount++;
          console.error(`[REFUND] ❌ Failed to refund queue item ${item.queue_id}: ${refundResult.error}`);
        }
      } catch (refundErr) {
        errorCount++;
        console.error(`[REFUND] ❌ Error processing refund for queue item ${item.queue_id}:`, refundErr);
      }
      
      // Small delay between refunds to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    
    return { processed: failedItems.results.length, refunded: refundedCount, errors: errorCount };
  } catch (error) {
    console.error(`[REFUND] ❌ Error processing refunds for old failed items:`, error);
    return { processed: 0, refunded: 0, error: error.message };
  }
}

/**
 * Process pending queue items
 * Can be called via endpoint or scheduled worker
 */
async function processSubscriptionQueue(env, limit = 100) {
  const timestamp = Math.floor(Date.now() / 1000);
  const fiveMinutesAgo = timestamp - (5 * 60); // 5 minutes in seconds
  
  try {
    // First, reset items stuck in 'processing' status for more than 5 minutes back to 'pending'
    // This handles cases where the worker crashed or timed out while processing
    try {
      const resetResult = await env.DB.prepare(
        `UPDATE subscription_queue 
         SET status = 'pending', updated_at = ?
         WHERE status = 'processing' 
         AND updated_at < ?`
      ).bind(timestamp, fiveMinutesAgo).run();
      
      if (resetResult.meta.changes > 0) {
        console.log(`[QUEUE] 🔄 Reset ${resetResult.meta.changes} stuck 'processing' items back to 'pending'`);
      }
    } catch (resetErr) {
      console.warn(`[QUEUE] ⚠️ Could not reset stuck processing items:`, resetErr);
    }
    
    // Get pending items that are ready to process (next_retry_at is null or in the past)
    const queueItems = await env.DB.prepare(
      `SELECT * FROM subscription_queue 
       WHERE status = 'pending' 
       AND (next_retry_at IS NULL OR next_retry_at <= ?)
       ORDER BY created_at ASC
       LIMIT ?`
    ).bind(timestamp, limit).all();
    
    if (queueItems.results.length === 0) {
      return { processed: 0, message: 'No pending queue items' };
    }
    
    console.log(`[QUEUE] 📋 Processing ${queueItems.results.length} queue items...`);
    
    let successCount = 0;
    let failCount = 0;
    let skippedCount = 0;
    
    for (const item of queueItems.results) {
      // CRITICAL: Atomic lock mechanism - only update if status is still 'pending'
      // This prevents concurrent processes from processing the same queue item
      // The WHERE clause acts as a lock - only one process can successfully update
      const lockResult = await env.DB.prepare(
        `UPDATE subscription_queue 
         SET status = 'processing', updated_at = ? 
         WHERE queue_id = ? AND status = 'pending'`
      ).bind(timestamp, item.queue_id).run();
      
      // Check if we successfully acquired the lock (rows affected > 0)
      if (lockResult.meta.changes === 0) {
        // Another process already acquired the lock or item is no longer pending
        console.log(`[QUEUE] ⚠️ Could not acquire lock for queue item ${item.queue_id} - already being processed by another worker or status changed`);
        skippedCount++;
        continue;
      }
      
      // Lock acquired successfully - proceed with processing
      const result = await processQueueItem(env, item);
      if (result.success) {
        successCount++;
        console.log(`[QUEUE] ✅ Successfully processed queue item ${item.queue_id} for license ${item.license_key}`);
      } else {
        failCount++;
        console.error(`[QUEUE] ❌ Failed to process queue item ${item.queue_id} for license ${item.license_key}: ${result.error}`);
      }
      
      // Small delay between processing to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    if (skippedCount > 0) {
      console.log(`[QUEUE] ⚠️ Skipped ${skippedCount} queue items (lock already acquired by another process)`);
    }
    
    console.log(`[QUEUE] ✅ Queue processing complete: ${successCount} succeeded, ${failCount} failed, ${skippedCount} skipped (lock conflict) out of ${queueItems.results.length} total`);
    
    return { processed: queueItems.results.length, successCount, failCount, skippedCount };
  } catch (error) {
    console.error(`[QUEUE] ❌ Error processing queue:`, error);
    return { processed: 0, error: error.message };
  }
}

async function stripeFetch(env, path, method = 'GET', body = null, form = false) {
  try {
  const key = getEnvVar(env, 'STRIPE_SECRET_KEY');
  const url = `${STRIPE_BASE}${path}`;
  const headers = {
    Authorization: `Bearer ${key}`
  };
  let init = { method, headers };
  if (body) {
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      // Build URLSearchParams manually to properly handle bracket notation
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(body)) {
        params.append(key, String(value));
      }
      init.body = params.toString();
      // Debug: Log line items count in encoded data
      const lineItemMatches = init.body.match(/line_items\[\d+\]\[price\]/g);
      if (lineItemMatches) {
      }
    } else {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  const res = await fetch(url, init);
  const text = await res.text();
  try {
      const parsed = JSON.parse(text);
      if (res.status >= 400) {
        console.error(`Stripe API error (${res.status}):`, parsed);
      }
      return { status: res.status, body: parsed };
  } catch (e) {
      console.error(`Stripe API error - failed to parse response:`, text);
    return { status: res.status, body: text };
    }
  } catch (e) {
    console.error('Stripe fetch error:', e);
    throw e;
  }
}

if (request.method === 'POST' && pathname === '/webhook') {
  // Stripe webhook handler - verifies signature and processes checkout.session.completed
  const raw = await request.text();
  const sig = request.headers.get('stripe-signature');
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  // Verify Stripe webhook signature (mandatory for security)
  let event;
  try {
    if (webhookSecret && sig) {
      // Use proper webhook verification - call method from export default object
      event = await this.verifyStripeWebhookForMemberstack(raw, sig, webhookSecret);
    } else {
      // Fallback for development (not recommended for production)
      console.warn('⚠️ Webhook verification skipped - STRIPE_WEBHOOK_SECRET or signature missing');
      event = JSON.parse(raw);
    }
  } catch (e) {
    console.error('Webhook verification failed:', e);
    return new Response('Invalid signature or payload', { status: 400 });
  }

  // Log all webhook events for debugging and tracking
  const subscriptionId = event.data?.object?.subscription || event.data?.object?.id || null;
  const customerId = event.data?.object?.customer || null;
  await logStripeEvent(env, event, subscriptionId, customerId, {
    action: 'webhook_received',
    note: 'Initial webhook event received'
  });

  try {
    // Handle checkout.session.completed - save payment details and generate magic link
    if (event.type === 'checkout.session.completed') {
      // CRITICAL: Declare ALL variables IMMEDIATELY at the start of the handler
      // This ensures they're always defined, even if an error occurs early
      let email = null;
      let customerId = null;
      let subscriptionId = null;
      let operationId = null;
      let failedOperations = [];
      let purchaseType = 'site';
      let addToExisting = false;
      let existingSubscriptionId = null;
      let isDirectLink = false;
      let paymentBy = null;
      let totalAmount = 0;
      let currency = 'usd';
      let customFieldSiteUrl = null;
      let billingPeriod = null;
      let billingInterval = null;

      const session = event.data.object;
      // Note: subscriptionId and customerId are already declared at the top of the handler
      subscriptionId = session.subscription;
      customerId = session.customer;

      // ========================================
      // STEP 1: IDENTIFY USE CASE
      // ========================================
      // First, determine which use case this is based on session properties
      // This ensures clean separation and prevents conflicts
      const sessionMode = session.mode;
      let sessionUseCase = session.metadata?.usecase; // Check session metadata first

      // For payment mode, we need to check customer metadata or payment intent metadata
      // session.payment_intent is just an ID string, not an object, so we can't access .metadata directly
      if (sessionMode === 'payment' && !sessionUseCase && customerId) {
        try {
          // Check customer metadata (we store usecase: '3' there)
          const customerRes = await stripeFetch(env, `/customers/${customerId}`);
          if (customerRes.status === 200 && customerRes.body?.metadata?.usecase) {
            sessionUseCase = customerRes.body.metadata.usecase;
          }
        } catch (customerErr) {
          console.warn(`[checkout.session.completed] Could not fetch customer metadata:`, customerErr);
        }

        // If still not found, check payment intent metadata
        if (!sessionUseCase && session.payment_intent && typeof session.payment_intent === 'string') {
          try {
            const piRes = await stripeFetch(env, `/payment_intents/${session.payment_intent}`);
            if (piRes.status === 200 && piRes.body?.metadata?.usecase) {
              sessionUseCase = piRes.body.metadata.usecase;
            }
          } catch (piErr) {
            console.warn(`[checkout.session.completed] Could not fetch payment intent metadata:`, piErr);
          }
        }
      }

      // Determine use case based on mode and metadata
      let identifiedUseCase = null;
      console.log('[checkout.session.completed] 🔍 Determining use case:', {
        sessionMode,
        sessionUseCase,
        sessionId: session.id
      });

      if (sessionMode === 'payment' && sessionUseCase === '3') {
        identifiedUseCase = '3'; // Use Case 3: Quantity purchase
      } else if (sessionMode === 'payment' && sessionUseCase === '2') {
        identifiedUseCase = '2'; // ✅ Use Case 2: Site purchase (now handled here)
      } else if (sessionMode === 'subscription') {
        identifiedUseCase = '1'; // Use Case 1: Direct payment link
      } else {
        console.warn(
          `[checkout.session.completed] ⚠️ Unknown use case - mode: ${sessionMode}, usecase: ${
            sessionUseCase || 'not set'
          }. Defaulting to Use Case 1.`,
        );
        identifiedUseCase = '1';
      }

      console.log('[checkout.session.completed] ✅ Identified use case:', identifiedUseCase);

      // === USE CASE 2: Site purchase (inside checkout.session.completed) ===
      // USE CASE 2: Site purchase (identifiedUseCase from your mode/usecase logic)
      if (identifiedUseCase === '2') {
        console.log('[USE CASE 2] 🚀 Processing Use Case 2 checkout session');

        const paymentIntentId = session.payment_intent;
        let paymentIntent = null;
        if (paymentIntentId) {
          const piRes = await stripeFetch(env, `/payment_intents/${paymentIntentId}`);
          if (piRes.status === 200) {
            paymentIntent = piRes.body;
          }
        }

        const metadata = (paymentIntent && paymentIntent.metadata) || session.metadata || {};
        console.log('[USE CASE 2 - CS COMPLETED] metadata:', metadata);

        const useCase2CustomerId = metadata.customer_id || customerId;
        const userEmail = await getCustomerEmail(env, useCase2CustomerId);
        if (!userEmail) {
          console.warn('[USE CASE 2] No user email, exiting');
          return new Response('ok');
        }

        // Parse sites
        let siteNames = [];
        try {
          const rawSites = metadata.sites_json || metadata.sites;
          if (rawSites) {
            siteNames = JSON.parse(rawSites);
          }
        } catch (e) {
          console.error('[USE CASE 2] Error parsing sites_json:', e);
        }

        const productId = metadata.product_id;

        // Check product metadata to verify it's for dashboard
        if (productId) {
          try {
            const productRes = await stripeFetch(env, `/products/${productId}`);
            if (productRes.status === 200 && productRes.body?.metadata?.usedfor) {
              const productUsedFor = productRes.body.metadata.usedfor;
              console.log(`[USE CASE 2] 🏷️ Product metadata usedfor: ${productUsedFor}`);

              // Only process if product is for dashboard
              if (productUsedFor !== 'dashboard') {
                console.log(
                  `[USE CASE 2] ⏭️ Skipping - Product usedfor is "${productUsedFor}", not "dashboard"`
                );
                return new Response('ok'); // Skip processing
              }
            }
          } catch (productErr) {
            console.warn(`[USE CASE 2] ⚠️ Could not fetch product metadata:`, productErr);
            // Continue processing if product fetch fails (backward compatibility)
          }
        }

        const rawPeriod = metadata.billing_period || '';
        const billingPeriod = rawPeriod.toLowerCase().trim(); // "monthly" / "yearly"
        const currency = metadata.currency || 'usd';

        // Derive per-site unit amount
        let unitAmount = null;
        try {
          if (siteNames.length > 0 && typeof session.amount_total === 'number') {
            unitAmount = Math.round(session.amount_total / siteNames.length);
          }
        } catch (_) {}

        // Fallback if needed
        if (!unitAmount) {
          unitAmount = 800; // from your monthly config
        }

        // Create or get dynamic price
        const priceId = await getOrCreateDynamicPrice(env, {
          productId,
          billingPeriod,
          currency,
          unitAmount,
        });

        if (!priceId || siteNames.length === 0) {
          console.warn('[USE CASE 2] Missing priceId or sites after dynamic price create, skipping enqueue', {
            productId,
            billingPeriod,
            priceId,
            siteNamesLength: siteNames.length,
          });
          return new Response('ok');
        }

        // 🆕 DETECT PLATFORM FOR EACH SITE
        const sitesForQueue = [];
        for (const siteName of siteNames) {
          const platform = await detectPlatform(siteName);
          console.log(`[USE CASE 2] 🔍 Site: ${siteName} → Platform: ${platform}`);
          
          sitesForQueue.push({
            site: siteName,
            price: priceId,
            billing_period: billingPeriod,
            platform: platform // 🆕 Add platform
          });
        }

        const queueId = await enqueueSiteQueueItem(env, {
          customerId: useCase2CustomerId,
          userEmail,
          subscriptionId: null,
          sites: sitesForQueue,
          billingPeriod,
          priceId,
          paymentIntentId: paymentIntentId || null,
        });

        console.log('[USE CASE 2] ✅ Enqueued sites job (checkout.session.completed)', {
          queueId,
          sites: siteNames.length,
          siteNames: siteNames,
          paymentIntentId: paymentIntentId,
          customerId: useCase2CustomerId,
          userEmail: userEmail
        });

        return new Response('ok');
      }

      // ========================================
      // STEP 2: ROUTE TO APPROPRIATE HANDLER
      // ========================================
      // Route to Use Case 3 handler
      if (identifiedUseCase === '3') {
        // ========================================
        // USE CASE 3 HANDLER: Quantity Purchase
        // ALWAYS QUEUE, NEVER IMMEDIATE
        // ========================================
        const paymentIntentId = session.payment_intent;
        if (paymentIntentId && typeof paymentIntentId === 'string') {
          try {
            // 1) Fetch payment intent + metadata
            const piRes = await stripeFetch(env, `/payment_intents/${paymentIntentId}`);
            if (piRes.status === 200) {
              const paymentIntent = piRes.body;
              let metadata = paymentIntent.metadata || {};

              // Also merge charge metadata if needed
              if (!metadata.usecase && paymentIntent.latest_charge) {
                try {
                  const chargeRes = await stripeFetch(env, `/charges/${paymentIntent.latest_charge}`);
                  if (chargeRes.status === 200 && chargeRes.body.metadata) {
                    metadata = { ...metadata, ...chargeRes.body.metadata };
                  }
                } catch (chargeErr) {
                  console.warn(`[checkout.session.completed] Could not fetch charge metadata:`, chargeErr);
                }
              }

              // Only handle Use Case 3
              if (metadata.usecase === '3') {
                // 2) Resolve customer id for this use case
                const useCase3CustomerId = session.customer || metadata.customer_id || paymentIntent.customer;

                // 3) Load license keys (temporary) from metadata / customer
                let licenseKeys = [];
                try {
                  if (metadata.license_keys) {
                    // Stored directly on payment_intent metadata
                    licenseKeys = JSON.parse(metadata.license_keys);
                  } else if (
                    metadata.license_keys_source === 'customer_metadata' ||
                    metadata.license_keys_count
                  ) {
                    // For large quantity, keys are on customer metadata
                    try {
                      const customerRes = await stripeFetch(env, `/customers/${useCase3CustomerId}`);
                      if (
                        customerRes.status === 200 &&
                        customerRes.body.metadata?.license_keys_pending
                      ) {
                        licenseKeys = JSON.parse(
                          customerRes.body.metadata.license_keys_pending
                        );
                        console.log(
                          `[checkout.session.completed] ✅ Retrieved ${licenseKeys.length} license keys from customer metadata`
                        );
                      }
                    } catch (customerErr) {
                      console.error(
                        `[checkout.session.completed] ❌ Error fetching license keys from customer metadata:`,
                        customerErr
                      );
                    }
                  }
                } catch (e) {
                  console.error(
                    `[checkout.session.completed] Error parsing license_keys:`,
                    e
                  );
                }

                // If still empty, try again (same logic, but keep as is for idempotency)
                if (licenseKeys.length === 0) {
                  console.warn(
                    `[checkout.session.completed] ⚠️ No license_keys found in metadata. Available keys: ${Object.keys(
                      metadata
                    ).join(', ')}`
                  );
                }

                // 4) Enhanced idempotency check: check payment_intent_id in queue to prevent duplicate processing
                if (env.DB && paymentIntentId) {
                  try {
                    // Check if queue items already exist for this payment_intent_id
                    const queueCheck = await env.DB.prepare(
                      `SELECT COUNT(*) as count FROM subscription_queue 
                       WHERE payment_intent_id = ? 
                       AND status IN ('pending', 'processing', 'completed')`
                    ).bind(paymentIntentId).first();

                    if (queueCheck && queueCheck.count > 0) {
                      console.log(
                        `[checkout.session.completed] ℹ️ Use Case 3 already processed (${queueCheck.count} queue item(s) exist for payment_intent_id=${paymentIntentId}), returning early to prevent duplicates.`
                      );
                      return new Response('ok');
                    }

                    // Also check if licenses already exist for this payment_intent_id (via queue)
                    if (licenseKeys.length > 0) {
                      const existingLicenseCheck = await env.DB.prepare(
                        `SELECT license_key FROM licenses WHERE license_key = ? LIMIT 1`
                      ).bind(licenseKeys[0]).first();

                      if (existingLicenseCheck) {
                        console.log(
                          `[checkout.session.completed] ℹ️ Use Case 3 already processed (license ${licenseKeys[0]} exists), returning early.`
                        );
                        return new Response('ok');
                      }
                    }
                  } catch (checkErr) {
                    console.warn(
                      `[checkout.session.completed] Could not check for existing queue items/licenses:`,
                      checkErr
                    );
                  }
                }

                // 5) Resolve user email
                const userEmail = await getCustomerEmail(env, useCase3CustomerId);
                if (!userEmail) {
                  console.warn(
                    '[checkout.session.completed] User email not found for Use Case 3'
                  );
                  return new Response('ok');
                }

                // 6) Resolve priceId (from metadata → product → billing_period)
                let priceId = null;
                let quantity = parseInt(metadata.quantity) || licenseKeys.length || 1;
                const productIdFromMetadata = metadata.product_id || null;
                let productIdFromCustomer = null;

                console.log(
                  `[checkout.session.completed] 📋 Metadata keys: ${Object.keys(metadata).join(
                    ', '
                  )}`
                );
                if (productIdFromMetadata) {
                  console.log(
                    `[checkout.session.completed] 🆔 Product ID from metadata: ${productIdFromMetadata}`
                  );
                }

                try {
                  // Re-load keys if needed (same as above, safe)
                  if (metadata.license_keys) {
                    licenseKeys = JSON.parse(metadata.license_keys);
                  } else if (
                    metadata.license_keys_source === 'customer_metadata' ||
                    metadata.license_keys_count
                  ) {
                    if (licenseKeys.length === 0) {
                      try {
                        const customerRes = await stripeFetch(env, `/customers/${useCase3CustomerId}`);
                        if (
                          customerRes.status === 200 &&
                          customerRes.body.metadata?.license_keys_pending
                        ) {
                          licenseKeys = JSON.parse(
                            customerRes.body.metadata.license_keys_pending
                          );
                          console.log(
                            `[checkout.session.completed] ✅ Retrieved ${licenseKeys.length} license keys from customer metadata`
                          );
                        }

                        if (!productIdFromMetadata && customerRes.body.metadata?.product_id) {
                          productIdFromCustomer = customerRes.body.metadata.product_id;
                          console.log(
                            `[checkout.session.completed] 🆔 Product ID from customer metadata: ${productIdFromCustomer}`
                          );
                        }
                      } catch (customerErr) {
                        console.error(
                          `[checkout.session.completed] ❌ Error fetching license keys from customer metadata:`,
                          customerErr
                        );
                      }
                    }
                  } else {
                    console.warn(
                      `[checkout.session.completed] ⚠️ No license_keys found in metadata.`
                    );
                  }

                  priceId = metadata.price_id || null;
                  quantity = parseInt(metadata.quantity) || licenseKeys.length || 0;

                  const productIdToUse = productIdFromMetadata || productIdFromCustomer;

                  // Check product metadata to verify it's for dashboard
                  let productUsedFor = null;
                  if (productIdToUse) {
                    try {
                      const productRes = await stripeFetch(env, `/products/${productIdToUse}`);
                      if (productRes.status === 200 && productRes.body?.metadata?.usedfor) {
                        productUsedFor = productRes.body.metadata.usedfor;
                        console.log(
                          `[checkout.session.completed] 🏷️ Product metadata usedfor: ${productUsedFor}`
                        );

                        // Only process if product is for dashboard
                        if (productUsedFor !== 'dashboard') {
                          console.log(
                            `[checkout.session.completed] ⏭️ Skipping - Product usedfor is "${productUsedFor}", not "dashboard"`
                          );
                          return new Response('ok'); // Skip processing
                        }
                      }
                    } catch (productErr) {
                      console.warn(
                        `[checkout.session.completed] ⚠️ Could not fetch product metadata:`,
                        productErr
                      );
                      // Continue processing if product fetch fails (backward compatibility)
                    }
                  }

                  // If price_id not in metadata, try via product
                  if (!priceId && productIdToUse) {
                    console.log(
                      `[checkout.session.completed] 🔍 price_id not found, fetching from product_id: ${productIdToUse}`
                    );
                    try {
                      const productRes = await stripeFetch(env, `/products/${productIdToUse}`);
                      if (productRes.status === 200 && productRes.body) {
                        const pricesRes = await stripeFetch(
                          env,
                          `/prices?product=${productIdToUse}&active=true&limit=1`
                        );
                        if (pricesRes.status === 200 && pricesRes.body?.data?.length > 0) {
                          priceId = pricesRes.body.data[0].id;
                          console.log(
                            `[checkout.session.completed] ✅ Found price_id from product: ${priceId}`
                          );
                        } else {
                          console.warn(
                            `[checkout.session.completed] ⚠️ No active prices found for product: ${productIdToUse}`
                          );
                        }
                      }
                    } catch (productErr) {
                      console.error(
                        `[checkout.session.completed] ❌ Error fetching price_id from product_id:`,
                        productErr
                      );
                    }
                  }

                  // Fallback: by billing_period
                  if (!priceId && metadata.billing_period) {
                    console.log(
                      `[checkout.session.completed] 🔍 Trying to get price_id from billing_period: ${metadata.billing_period}`
                    );
                    try {
                      priceId = await getPriceIdByBillingPeriod(env, metadata.billing_period);
                      if (priceId) {
                        console.log(
                          `[checkout.session.completed] ✅ Found price_id from billing_period: ${priceId}`
                        );
                      }
                    } catch (billingErr) {
                      console.error(
                        `[checkout.session.completed] ❌ Error getting price_id from billing_period:`,
                        billingErr
                      );
                    }
                  }
                } catch (parseErr) {
                  console.error(
                    '[checkout.session.completed] ❌ Error parsing metadata:',
                    parseErr
                  );
                }

                // 7) Save payment method to customer (unchanged)
                let paymentMethodId = paymentIntent.payment_method;
                if (!paymentMethodId && paymentIntent.latest_charge) {
                  try {
                    const chargeRes = await stripeFetch(env, `/charges/${paymentIntent.latest_charge}`);
                    if (chargeRes.status === 200 && chargeRes.body.payment_method) {
                      paymentMethodId = chargeRes.body.payment_method;
                    }
                  } catch (chargeErr) {
                    console.warn(
                      `[checkout.session.completed] Could not fetch charge for payment method:`,
                      chargeErr
                    );
                  }
                }

                const customerIdForPaymentMethod = session.customer || paymentIntent.customer || useCase3CustomerId;
                let paymentMethodSaved = false;
                if (paymentMethodId && customerIdForPaymentMethod) {
                  try {
                    const attachRes = await stripeFetch(
                      env,
                      `/payment_methods/${paymentMethodId}/attach`,
                      'POST',
                      { customer: customerIdForPaymentMethod },
                      true
                    );

                    if (attachRes.status === 200) {
                      const setDefaultRes = await stripeFetch(
                        env,
                        `/customers/${customerIdForPaymentMethod}`,
                        'POST',
                        { 'invoice_settings[default_payment_method]': paymentMethodId },
                        true
                      );

                      if (setDefaultRes.status === 200) {
                        paymentMethodSaved = true;
                      } else {
                        console.warn(
                          `[checkout.session.completed] ⚠️ Payment method attached but failed to set as default:`,
                          setDefaultRes.status,
                          setDefaultRes.body
                        );
                      }
                    } else {
                      const errorMessage = attachRes.body?.error?.message || '';
                      if (
                        errorMessage.includes('already attached') ||
                        errorMessage.includes('already been attached')
                      ) {
                        const setDefaultRes = await stripeFetch(
                          env,
                          `/customers/${customerIdForPaymentMethod}`,
                          'POST',
                          { 'invoice_settings[default_payment_method]': paymentMethodId },
                          true
                        );

                        if (setDefaultRes.status === 200) {
                          paymentMethodSaved = true;
                        } else {
                          console.warn(
                            `[checkout.session.completed] ⚠️ Failed to set payment method as default:`,
                            setDefaultRes.status,
                            setDefaultRes.body
                          );
                        }
                      } else {
                        console.error(
                          `[checkout.session.completed] ❌ STEP 1 FAILED: Failed to attach payment method:`,
                          attachRes.status,
                          attachRes.body
                        );
                      }
                    }
                  } catch (attachErr) {
                    console.error(
                      `[checkout.session.completed] ❌ STEP 1 FAILED: Error attaching payment method:`,
                      attachErr
                    );
                  }
                } else {
                  console.error(
                    `[checkout.session.completed] ❌ STEP 1 FAILED: Missing payment_method or customer. payment_method: ${paymentMethodId}, customer: ${customerIdForPaymentMethod}`
                  );
                }

                // 8) ALWAYS QUEUE: no immediate subscription creation, no thresholds
                const customerIdForSubscriptions = customerIdForPaymentMethod || session.customer || useCase3CustomerId;

                if (paymentMethodSaved && priceId && quantity > 0 && customerIdForSubscriptions) {
                  try {
                    // Calculate single trial_end for all future subscriptions
                    const now = Math.floor(Date.now() / 1000);
                    let trialPeriodDays = null;
                    if (env.TRIAL_PERIOD_DAYS) {
                      trialPeriodDays = parseInt(env.TRIAL_PERIOD_DAYS);
                    } else if (session.metadata?.trial_period_days) {
                      trialPeriodDays = parseInt(session.metadata.trial_period_days);
                    }

                    let trialPeriodSeconds = 30 * 24 * 60 * 60;
                    let billingInterval = 'month';

                    if (trialPeriodDays) {
                      trialPeriodSeconds = trialPeriodDays * 24 * 60 * 60;
                    } else {
                      try {
                        const priceRes = await stripeFetch(env, `/prices/${priceId}`);
                        if (priceRes.status === 200 && priceRes.body.recurring) {
                          billingInterval = priceRes.body.recurring.interval;
                          const intervalCount = priceRes.body.recurring.interval_count || 1;

                          if (billingInterval === 'week') {
                            trialPeriodSeconds = 7 * 24 * 60 * 60 * intervalCount;
                          } else if (billingInterval === 'month') {
                            trialPeriodSeconds = 30 * 24 * 60 * 60 * intervalCount;
                          } else if (billingInterval === 'year') {
                            trialPeriodSeconds = 365 * 24 * 60 * 60 * intervalCount;
                          } else if (billingInterval === 'day') {
                            trialPeriodSeconds = 24 * 60 * 60 * intervalCount;
                          }
                        }
                      } catch (priceErr) {
                        console.warn(
                          `[checkout.session.completed] ⚠️ Could not fetch price details, using default 30 days:`,
                          priceErr
                        );
                      }
                    }

                    const trialEndTime = now + trialPeriodSeconds;
                    const minimumTrialEnd = billingInterval === 'day' ? now + 7 * 24 * 60 * 60 : now + 3600;
                    const trialEnd = Math.max(trialEndTime, minimumTrialEnd);

                    // LICENSE KEYS: if for some reason metadata had count but not actual array,
                    // generate temporary keys so queue has one per subscription.
                    if (!licenseKeys || licenseKeys.length === 0) {
                      const count = quantity || 0;
                      licenseKeys = generateTempLicenseKeys(count);
                      console.log(
                        `[USE CASE 3] Generated ${licenseKeys.length} temporary license keys because none were found in metadata`
                      );
                    }

                    if (licenseKeys.length !== quantity) {
                      console.warn(
                        `[USE CASE 3] ⚠️ licenseKeys.length (${licenseKeys.length}) != quantity (${quantity}). Will queue min(count) items.`
                      );
                    }

                    const toQueue = Math.min(licenseKeys.length, quantity);
                    let queuedCount = 0;
                    let queueErrors = 0;

                    console.log(
                      `[USE CASE 3 - QUEUE ONLY] 📋 Adding ${toQueue} items to subscription_queue...`
                    );

                    for (let i = 0; i < toQueue; i++) {
                      const queueResult = await addToSubscriptionQueue(env, {
                        customerId: customerIdForSubscriptions,
                        userEmail,
                        paymentIntentId: paymentIntent.id,
                        priceId,
                        licenseKey: licenseKeys[i],
                        quantity: 1,
                        trialEnd,
                      });

                      if (queueResult.success) {
                        queuedCount++;
                        if ((i + 1) % 10 === 0 || i === toQueue - 1) {
                          console.log(
                            `[USE CASE 3 - QUEUE ONLY] ✅ Queued ${i + 1}/${toQueue} items (${queuedCount} successful, ${queueErrors} errors)`
                          );
                        }
                      } else {
                        queueErrors++;
                        console.error(
                          `[USE CASE 3 - QUEUE ONLY] ❌ Failed to queue item ${i + 1}/${toQueue} for license ${licenseKeys[i]}:`,
                          queueResult.error
                        );
                      }
                    }

                    console.log(
                      `[USE CASE 3 - QUEUE ONLY] 📊 Queue Summary: ${queuedCount} queued successfully, ${queueErrors} failed out of ${toQueue} planned`
                    );

                    // No subscription creation here. Background worker / cron will call processQueueItem()
                    // for each pending row and:
                    // - generate real license key if temporary
                    // - create subscription in Stripe
                    // - create license row in DB
                    // - mark queue row as completed or delete it
                  } catch (queueErr) {
                    console.error(
                      '[checkout.session.completed] ❌ Error queuing subscriptions for Use Case 3:',
                      queueErr
                    );
                  }
                } else {
                  // Explain why nothing was queued
                  if (!paymentMethodSaved) {
                    console.error(
                      `[checkout.session.completed] ❌ QUEUE STEP SKIPPED: Payment method was not saved successfully`
                    );
                  }
                  if (!priceI) {
console.error(`
[checkout.session.completed] ❌ QUEUE STEP SKIPPED: Missing priceId
`);
}
if (!quantity || quantity <= 0) {
console.error(
`[checkout.session.completed] ❌ QUEUE STEP SKIPPED: Invalid quantity: ${quantity}
`);
}
if (!customerIdForSubscriptions) {
console.error(`
[checkout.session.completed] ❌ QUEUE STEP SKIPPED: Missing customerId
`);
}
}
            // IMPORTANT: no immediate creation, no license DB writes here.
            // Everything happens in queue processor.
            return new Response('ok');
          }
        }
      } catch (piErr) {
        console.error(
          `[checkout.session.completed] Error fetching payment_intent for Use Case 3:`,
          piErr
        );
      }
    }

    // If payment_intent fetch failed or metadata.usecase is not '3', return early
    // This ensures Use Case 3 doesn't fall through to Use Case 1 processing
    return new Response('ok');
  }

  // ========================================
  // USE CASE 1 HANDLER: Direct Payment Links
  // ========================================
  // This section ONLY processes Use Case 1
  // Use Case 3 is handled above and returns early, so it never reaches here
  if (identifiedUseCase === '1') {
    console.log('[USE CASE 1] 🚀 ========================================');
    console.log('[USE CASE 1] 🚀 STARTING USE CASE 1 PROCESSING');
    console.log('[USE CASE 1] 🚀 ========================================');
    console.log('[USE CASE 1] 📋 Session ID:', session.id);
    console.log('[USE CASE 1] 📋 Customer ID:', customerId);
    console.log('[USE CASE 1] 📋 Subscription ID:', subscriptionId);

    // ========================================
    // USE CASE 1 DEBUG: Extract Basic Info
    // ========================================
    // Extract email from multiple possible locations (Payment Links vs Checkout Sessions)
    // Note: email variable is already declared at the top of the handler
    email = session.customer_details?.email;

    if (!subscriptionId || !customerId) {
      console.log('[USE CASE 1] ❌ Missing subscriptionId or customerId - exiting');
      return new Response('ok');
    }

    // If email not found in session, fetch from customer object
    if (!email) {
      console.log('[USE CASE 1] 🔍 Email not in session, fetching from customer...');
      email = await getCustomerEmail(env, customerId);
      if (!email) {
        console.log('[USE CASE 1] ❌ Could not get email from customer - exiting');
        return new Response('ok');
      }
    }
    console.log('[USE CASE 1] ✅ Email found:', email);

    // Generate operation ID for tracking (used throughout payment processing)
    // Note: Variables are already declared at the top of the handler
    operationId = `payment_${customerId}_${subscriptionId}_${Date.now()}`;
    console.log('[USE CASE 1] 🆔 Operation ID:', operationId);

    // Extract site URL from custom field - support multiple field key variations
    // Note: customFieldSiteUrl is already declared at the top of the handler
    customFieldSiteUrl = null;
    if (session.custom_fields && session.custom_fields.length > 0) {
      // Look for site URL field with various possible keys
      // Support: "adddomain", "customdomain", "enteryourlivesiteurl", "enteryourlivesiteur", "enteryourlivedomain"
      // Also check for any field with "domain" or "site" in the key, or any text field with a value
      const siteUrlField = session.custom_fields.find(field =>
        field.key === 'adddomain' ||
        field.key === 'customdomain' ||
        field.key === 'enteryourlivedomain' ||
        field.key === 'enteryourlivesiteurl' ||
        field.key === 'enteryourlivesiteur' ||
        field.key?.toLowerCase().includes('domain') ||
        field.key?.toLowerCase().includes('site') ||
        (field.type === 'text' && field.text && field.text.value)
      );

      if (siteUrlField) {
        if (siteUrlField.type === 'text' && siteUrlField.text && siteUrlField.text.value) {
          customFieldSiteUrl = siteUrlField.text.value.trim();
          console.log(`[USE CASE 1] ✅ Extracted site from custom field (key: ${siteUrlField.key}): ${customFieldSiteUrl}`);
        }
      } else {
        console.log(`[USE CASE 1] ⚠️ No site URL found in custom fields. Available fields:`, session.custom_fields.map(f => f.key));
      }
    }

    // Retrieve the subscription and its items
    console.log('[USE CASE 1] 🔍 Fetching subscription from Stripe...');
    const subRes = await stripeFetch(env, `/subscriptions/${subscriptionId}`);
    if (subRes.status !== 200) {
      console.log('[USE CASE 1] ❌ Failed to fetch subscription:', subRes.status);
      return new Response('ok');
    }
    const sub = subRes.body;
    console.log('[USE CASE 1] ✅ Subscription fetched:', {
      id: sub.id,
      status: sub.status,
      items_count: sub.items?.data?.length || 0
    });

    // ========================================
    // USE CASE 1: Cleanup "site_1" placeholders
    // ========================================
    // For direct payments, if same subscription_id exists with "site_1" in licenses/sites tables,
    // remove/update them before processing the new payment with actual site name
    if (env.DB && subscriptionId) {
      try {
        console.log(`[USE CASE 1] 🧹 Checking for existing "site_1" entries for subscription ${subscriptionId}...`);

        // Check and clean up licenses table - match "site_1", "site_2", etc. pattern
        const licensesWithSite1 = await env.DB.prepare(
          'SELECT license_key, site_domain, item_id FROM licenses WHERE subscription_id = ? AND site_domain IS NOT NULL AND site_domain LIKE "site_%"'
        ).bind(subscriptionId).all();

        if (licensesWithSite1.success && licensesWithSite1.results.length > 0) {
          console.log(`[USE CASE 1] 🗑️ Found ${licensesWithSite1.results.length} license(s) with placeholder site names - removing them`);
          for (const lic of licensesWithSite1.results) {
            // Only remove if it matches the pattern site_1, site_2, etc.
            if (lic.site_domain && /^site_\d+$/.test(lic.site_domain)) {
              try {
                await env.DB.prepare(
                  'DELETE FROM licenses WHERE subscription_id = ? AND license_key = ?'
                ).bind(subscriptionId, lic.license_key).run();
                console.log(`[USE CASE 1] ✅ Removed license with placeholder site: "${lic.site_domain}" (key: ${lic.license_key?.substring(0, 15)}...)`);
              } catch (delErr) {
                console.error(`[USE CASE 1] ❌ Error removing license ${lic.license_key}:`, delErr);
              }
            }
          }
        }

        // Check and clean up sites table - match "site_1", "site_2", etc. pattern
        const sitesWithSite1 = await env.DB.prepare(
          'SELECT id, site_domain, item_id FROM sites WHERE subscription_id = ? AND site_domain IS NOT NULL AND site_domain LIKE "site_%"'
        ).bind(subscriptionId).all();

        if (sitesWithSite1.success && sitesWithSite1.results.length > 0) {
          console.log(`[USE CASE 1] 🗑️ Found ${sitesWithSite1.results.length} site(s) with placeholder site names - removing them`);
          for (const site of sitesWithSite1.results) {
            // Only remove if it matches the pattern site_1, site_2, etc.
            if (site.site_domain && /^site_\d+$/.test(site.site_domain)) {
              try {
                await env.DB.prepare(
                  'DELETE FROM sites WHERE subscription_id = ? AND id = ?'
                ).bind(subscriptionId, site.id).run();
                console.log(`[USE CASE 1] ✅ Removed site with placeholder: "${site.site_domain}" (id: ${site.id})`);
              } catch (delErr) {
                console.error(`[USE CASE 1] ❌ Error removing site ${site.id}:`, delErr);
              }
            }
          }
        }

        if ((licensesWithSite1.success && licensesWithSite1.results.length > 0) ||
            (sitesWithSite1.success && sitesWithSite1.results.length > 0)) {
          console.log(`[USE CASE 1] ✅ Cleanup complete - removed placeholder entries`);
        } else {
          console.log(`[USE CASE 1] ℹ️ No placeholder entries found - proceeding normally`);
        }
      } catch (cleanupErr) {
        console.error(`[USE CASE 1] ❌ Error during cleanup:`, cleanupErr);
        // Don't fail the whole operation if cleanup fails
      }
    }

    // Check product metadata to verify it's for dashboard
    if (sub.items && sub.items.data && sub.items.data.length > 0) {
      const firstItem = sub.items.data[0];
      if (firstItem.price && firstItem.price.product) {
        const productId = typeof firstItem.price.product === 'string' ? firstItem.price.product : firstItem.price.product.id;
        
        try {
          console.log(`[USE CASE 1] 🔍 Fetching product metadata for product: ${productId}`);
          const productRes = await stripeFetch(env, `/products/${productId}`);
          if (productRes.status === 200 && productRes.body?.metadata?.usedfor) {
            const productUsedFor = productRes.body.metadata.usedfor;
            console.log(`[USE CASE 1] 🏷️ Product metadata usedfor: ${productUsedFor}`);
            console.log(`[USE CASE 1] 📦 Product details:`, {
              id: productRes.body.id,
              name: productRes.body.name,
              metadata: productRes.body.metadata
            });

            // Only process if product is for dashboard
            if (productUsedFor !== 'dashboard') {
              console.log(
                `[USE CASE 1] ⏭️ SKIPPING PROCESSING - Product usedfor is "${productUsedFor}", not "dashboard"`
              );
              return new Response('ok'); // Skip processing
            }
            console.log(`[USE CASE 1] ✅ Product metadata check PASSED - proceeding with processing`);
          } else {
            console.log(`[USE CASE 1] ⚠️ Product metadata 'usedfor' not found - continuing (backward compatibility)`);
          }
        } catch (productErr) {
          console.warn(`[USE CASE 1] ⚠️ Could not fetch product metadata:`, productErr);
          // Continue processing if product fetch fails (backward compatibility)
        }
      }
    }

    // ... [REST OF USE CASE 1 CONTINUES - Keep all existing logic but add platform detection where sites are saved] ...

    // 🆕 DETECT PLATFORM when saving payments/sites/licenses
    // Find the section where you save payments (around line 1850)
    // REPLACE the payment saving loop with:

    if (env.DB && (allSites.length > 0 || purchaseType === 'quantity')) {
      console.log(`[${operationId}] 🔍 STEP 5.2: Saving payment records to database...`);
      let paymentSaved = false;
      
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          console.log(`[${operationId}] - Payment save attempt ${attempt + 1}/3...`);
          const timestamp = Math.floor(Date.now() / 1000);

          // For quantity purchases, save one payment record without site
          if (purchaseType === 'quantity' && allSites.length === 0) {
            console.log(`[${operationId}] - Creating payment record for quantity purchase (no site)...`);
            
            const paymentResult = await env.DB.prepare(
              `INSERT INTO payments (
                customer_id, subscription_id, email, amount, currency, 
                status, site_domain, magic_link, magic_link_generated, 
                platform, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
              customerId, subscriptionId, email, totalAmount, currency,
              'succeeded', null, null, 0,
              'pending', // No site, so platform is pending
              timestamp, timestamp
            ).run();
            
            console.log(`[${operationId}] ✅ Payment record created for quantity purchase`);
          } else {
            // Create payment record for each site WITH PLATFORM DETECTION
            console.log(`[${operationId}] - Creating payment records for ${allSites.length} site(s)...`);
            let paymentCount = 0;
            
            for (const siteDomain of allSites) {
              console.log(`[${operationId}] - Processing payment for site: ${siteDomain}`);
              
              // 🆕 DETECT PLATFORM FOR THIS SITE
              const platform = await detectPlatform(siteDomain);
              console.log(`[${operationId}] 🔍 Platform detected: ${platform}`);
              
              // Get appropriate KV namespace
              const { activeSitesKv } = getKvNamespaces(env, platform);
              
              // Try to get the actual price for this site
              let siteAmount = amountPerSite;
              if (sub.items && sub.items.data) {
                const item = sub.items.data.find(i => 
                  (i.metadata?.site || '').toLowerCase().trim() === siteDomain.toLowerCase().trim()
                );
                if (item && item.price) {
                  try {
                    const priceRes = await stripeFetch(env, `/prices/${item.price.id}`);
                    if (priceRes.status === 200) {
                      siteAmount = priceRes.body.unit_amount || amountPerSite;
                    }
                  } catch (priceError) {
                    console.warn(`[${operationId}] ⚠️ Failed to fetch price details`);
                  }
                }
              }

              // Save payment to database WITH PLATFORM
              const paymentResult = await env.DB.prepare(
                `INSERT INTO payments (
                  customer_id, subscription_id, email, amount, currency,
                  status, site_domain, magic_link, magic_link_generated,
                  platform, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              ).bind(
                customerId, subscriptionId, email, siteAmount, currency,
                'succeeded', siteDomain, null, 0,
                platform, // 🆕 Store detected platform
                timestamp, timestamp
              ).run();

              if (paymentResult.success) {
                paymentCount++;
                console.log(`[${operationId}] ✅ Payment saved for ${siteDomain} (${platform})`);
                
                // 🆕 SAVE TO PLATFORM-SPECIFIC KV
                if (activeSitesKv) {
                  await saveSubscriptionToKV(
                    env,
                    customerId,
                    subscriptionId,
                    email,
                    siteDomain,
                    sub.status === 'active' ? 'complete' : sub.status,
                    'paid',
                    sub.cancel_at_period_end || false
                  );
                  console.log(`[${operationId}] ✅ Saved to ${platform} KV namespace`);
                }
              }
            }
            
            console.log(`[${operationId}] ✅ Created ${paymentCount}/${allSites.length} payment record(s)`);
          }
          
          paymentSaved = true;
          break;
        } catch (dbError) {
          console.error(`[${operationId}] ❌ Payment save attempt ${attempt + 1}/3 failed:`, dbError);
          if (attempt === 2) {
            failedOperations.push({
              type: 'save_payment',
              error: dbError.message
            });
          } else {
            await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
          }
        }
      }
    }

    // ... [Continue with rest of Use Case 1 logic - add platform detection in license generation and site saving sections similarly] ...

    console.log(`[USE CASE 1] ✅ Returning 'ok' to Stripe webhook`);
    return new Response('ok', { status: 200 });
  }

  // If we reach here, use case was not identified (shouldn't happen)
  console.warn(`[checkout.session.completed] ⚠️ Unhandled use case - returning ok`);
  return new Response('ok', { status: 200 });
}

// ... [Rest of webhook handlers for other event types] ...

return new Response('ok');
} catch (error) {
// Safely log error without referencing variables that might not be in scope
const errorMessage = error?.message || 'Unknown error';
const errorStack = error?.stack || 'No stack trace';
console.error('Handler error:', errorMessage);
console.error('Error stack:', errorStack);
return new Response(
  JSON.stringify({
    error: 'Internal server error',
    message: errorMessage
  }),
  {
    status: 500,
    headers: { 'Content-Type': 'application/json' }
  }
);
}
}

