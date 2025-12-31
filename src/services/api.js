/**
 * API service for dashboard endpoints
 * Handles all API communication with the backend
 */

// Using existing server - same as consentbit-dashboard-1
const API_BASE = import.meta.env.VITE_API_BASE || 'https://consentbit-dashboard-test.web-8fb.workers.dev';

// Request timeout (5 seconds)
const REQUEST_TIMEOUT = 5000;

// Helper to create timeout promise
function createTimeoutPromise(timeout) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), timeout);
  });
}

// Helper to make authenticated API requests with timeout
async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  };

  try {
    // Race between fetch and timeout
    const response = await Promise.race([
      fetch(url, config),
      createTimeoutPromise(REQUEST_TIMEOUT)
    ]);
    
    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || error.message || `API request failed: ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error.message === 'Request timeout') {
      throw new Error('Request timeout - server took too long to respond');
    }
    throw error;
  }
}

// Get dashboard data (sites and subscriptions)
export async function getDashboard(userEmail) {
  try {
    // Validate email before making API call (matching reference dashboard)
    if (!userEmail || !userEmail.includes('@')) {
      console.error('[API] ❌ Invalid email for API call:', userEmail);
      throw new Error('Invalid email address. Please log out and log in again.');
    }
    
    // Normalize email (lowercase and trim) - matching reference
    const normalizedEmail = userEmail.toLowerCase().trim();
    
    const url = `${API_BASE}/dashboard?email=${encodeURIComponent(normalizedEmail)}`;
    console.log('[API] Fetching dashboard data:', {
      url,
      userEmail: normalizedEmail,
      API_BASE,
      originalEmail: userEmail
    });
    
    // Try email-based endpoint first (for Memberstack users) with timeout
    let response;
    try {
      response = await Promise.race([
        fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        }),
        createTimeoutPromise(REQUEST_TIMEOUT)
      ]);
      
      console.log('[API] Dashboard response status:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
        headers: Object.fromEntries(response.headers.entries())
      });
    } catch (error) {
      if (error.message === 'Request timeout') {
        throw new Error('Request timeout - server took too long to respond');
      }
      throw error;
    }

    // If email endpoint doesn't work, try with session cookie
    if (!response.ok && response.status === 401) {
      try {
        const fallbackResponse = await Promise.race([
          fetch(`${API_BASE}/dashboard`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          }),
          createTimeoutPromise(REQUEST_TIMEOUT)
        ]);

        if (!fallbackResponse.ok) {
          throw new Error('Failed to load dashboard');
        }

        return await fallbackResponse.json();
      } catch (error) {
        if (error.message === 'Request timeout') {
          throw new Error('Request timeout - server took too long to respond');
        }
        throw error;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] ❌ Dashboard response not OK:', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      
      // Handle specific error cases (matching reference dashboard)
      if (response.status === 401) {
        throw new Error('Not authenticated');
      } else if (response.status === 404) {
        throw new Error('User data not found for this email');
      }
      
      throw new Error(`Failed to load dashboard: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[API] Dashboard data received:', {
      hasSites: !!data.sites,
      sitesCount: data.sites ? Object.keys(data.sites).length : 0,
      hasSubscriptions: !!data.subscriptions,
      subscriptionsType: Array.isArray(data.subscriptions) ? 'array' : typeof data.subscriptions,
      subscriptionsCount: Array.isArray(data.subscriptions) 
        ? data.subscriptions.length 
        : data.subscriptions ? Object.keys(data.subscriptions).length : 0,
      hasPendingSites: !!data.pendingSites,
      pendingSitesCount: data.pendingSites ? data.pendingSites.length : 0,
      fullResponse: data
    });
    return data;
  } catch (error) {
    console.error('[API] Error loading dashboard:', error);
    throw error;
  }
}

// Get user licenses
export async function getLicenses(userEmail) {
  try {
    // Validate email before making API call (matching reference dashboard)
    if (!userEmail || !userEmail.includes('@')) {
      console.error('[API] ❌ Invalid email for licenses API call:', userEmail);
      throw new Error('Invalid email address. Please log out and log in again.');
    }
    
    // Normalize email (lowercase and trim) - matching reference
    const normalizedEmail = userEmail.toLowerCase().trim();
    
    const url = `${API_BASE}/licenses?email=${encodeURIComponent(normalizedEmail)}`;
    console.log('[API] Fetching licenses:', {
      url,
      userEmail: normalizedEmail,
      API_BASE,
      originalEmail: userEmail
    });
    
    // Try email-based endpoint first with timeout
    let response;
    try {
      response = await Promise.race([
        fetch(url, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include'
        }),
        createTimeoutPromise(REQUEST_TIMEOUT)
      ]);
      
      console.log('[API] Licenses response status:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url
      });
    } catch (error) {
      if (error.message === 'Request timeout') {
        throw new Error('Request timeout - server took too long to respond');
      }
      throw error;
    }

    // If email endpoint doesn't work, try with session cookie
    if (!response.ok && response.status === 401) {
      try {
        response = await Promise.race([
          fetch(`${API_BASE}/licenses`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            },
            credentials: 'include'
          }),
          createTimeoutPromise(REQUEST_TIMEOUT)
        ]);
      } catch (error) {
        if (error.message === 'Request timeout') {
          throw new Error('Request timeout - server took too long to respond');
        }
        throw error;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Licenses response not OK:', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`Failed to load licenses: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[API] Licenses data received:', {
      hasLicenses: !!data.licenses,
      licensesCount: data.licenses ? data.licenses.length : 0,
      fullResponse: data
    });
    return data;
  } catch (error) {
    console.error('[API] Error loading licenses:', error);
    throw error;
  }
}

// Add a new site
export async function addSite(userEmail, site, price) {
  return apiRequest('/add-site', {
    method: 'POST',
    body: JSON.stringify({ 
      site, 
      price,
      email: userEmail 
    }),
  });
}

// Remove a site
export async function removeSite(userEmail, site) {
  return apiRequest('/remove-site', {
    method: 'POST',
    body: JSON.stringify({ 
      site,
      email: userEmail 
    }),
  });
}

// Add sites in batch (for pending sites)
export async function addSitesBatch(userEmail, sites, billingPeriod) {
  return apiRequest('/add-sites-batch', {
    method: 'POST',
    body: JSON.stringify({ 
      sites: sites.map(site => ({ site: typeof site === 'string' ? site : site.site || site.site_domain })),
      email: userEmail,
      billing_period: billingPeriod
    }),
  });
}

// Create checkout from pending sites
export async function createCheckoutFromPending(userEmail, billingPeriod) {
  return apiRequest('/create-checkout-from-pending', {
    method: 'POST',
    body: JSON.stringify({ 
      email: userEmail,
      billing_period: billingPeriod
    }),
  });
}

// Remove pending site
export async function removePendingSite(userEmail, site) {
  return apiRequest('/remove-pending-site', {
    method: 'POST',
    body: JSON.stringify({ 
      email: userEmail,
      site: typeof site === 'string' ? site : site.site || site.site_domain
    }),
  });
}

