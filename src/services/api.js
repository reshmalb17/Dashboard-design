/**
 * API service for dashboard endpoints
 * Handles all API communication with the backend
 */

// Using existing server - same as consentbit-dashboard-1
const API_BASE = import.meta.env.VITE_API_BASE || 'https://consentbit-dashboard-test.web-8fb.workers.dev';


// Request timeout (30 seconds for dashboard, 10 seconds for others)
// Dashboard API can take longer due to data processing
const REQUEST_TIMEOUT = 30000; // 30 seconds
const REQUEST_TIMEOUT_SHORT = 10000; // 10 seconds for faster endpoints

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
      
      // Handle specific error cases (matching reference dashboard)
      if (response.status === 401) {
        throw new Error('Not authenticated');
      } else if (response.status === 404) {
        throw new Error('User data not found for this email');
      }
      
      throw new Error(`Failed to load dashboard: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
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
      throw new Error(`Failed to load licenses: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
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
export async function activateLicense(licenseKey, siteDomain, email = null) {
  const body = {
    license_key: licenseKey,
    site_domain: siteDomain
  };

  if (email) {
    body.email = email;
  }
 const url = `${API_BASE}/activate-license`;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'include'
    });

    let data;

    // Try parsing JSON safely
    const text = await response.text();
    try {
      data = text ? JSON.parse(text) : {};
    } catch (jsonErr) {
      console.error('Failed to parse JSON response:', text);
      data = { error: 'invalid_response', message: 'Server returned invalid JSON' };
    }

    if (!response.ok) {
      console.error('License activation failed:', data);
      return data;
    }

    console.log('License activated successfully:', data);
    return data;

  } catch (err) {
    console.error('Error activating license:', err);
    return { error: 'network_error', message: err.message };
  }
}

export async function cancelSubscription(email = null, site = null, subscriptionId = null) {
  try {
    const body = { site };
    site = site.toLowerCase().trim()


    if (subscriptionId) body.subscription_id = subscriptionId;
    if (email) body.email = email;
 const url = `${API_BASE}/remove-site`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Include auth headers if needed, e.g., JWT token
        // 'Authorization': 'Bearer <token>'
      },
      body: JSON.stringify(body),
      credentials: 'include' // Include cookies if using session cookie auth
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Failed to remove site:', data);
      return data;
    }

    console.log('Site removed successfully:', data);
    return data;

  } catch (error) {
    console.error('Error calling remove-site:', error);
    return { error: 'network_error', message: error.message };
  }
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

// // Add sites in batch (for pending sites)
// export async function createSiteCheckout(email, sites, billingPeriod) {
//   console.log('Creating site checkout with:', { email, sites, billingPeriod });
//   return apiRequest('/create-site-checkout', {
//     method: 'POST',
//     body: JSON.stringify({
//       email,
//       sites,               // ['a.com', 'b.com']
//       billing_period: billingPeriod, // 'monthly' | 'yearly'
//     }),
//   });
// }


// Create checkout from pending sites
export async function createSiteCheckout(email, sites, billingPeriod) {
  const res = await fetch(`${API_BASE}/create-site-checkout`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, sites, billing_period: billingPeriod }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'Checkout failed');
  }

  return data; // { checkout_url, session_id, ... }
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

// // Cancel subscription (uses /remove-site endpoint)
// export async function cancelSubscription(userEmail, site, subscriptionId) {
//   return apiRequest('/remove-site', {
//     method: 'POST',
//     body: JSON.stringify({ 
//       email: userEmail,
//       site: site,
//       subscription_id: subscriptionId
//     }),
//   });
// }

// Purchase quantity of license keys
export async function purchaseQuantity(userEmail, quantity, billingPeriod) {
  return apiRequest('/purchase-quantity', {
    method: 'POST',
    body: JSON.stringify({
      email: userEmail,
      quantity: parseInt(quantity),
      billing_period: billingPeriod.toLowerCase() // 'monthly' or 'yearly'
    }),
  });
}

// Get user profile data from database
// COMMENTED OUT: Profile API endpoint doesn't exist yet
/*
export async function getUserProfile(userEmail) {
  try {
    // Validate email before making API call
    if (!userEmail || !userEmail.includes('@')) {
      console.error('[API] ❌ Invalid email for profile API call:', userEmail);
      throw new Error('Invalid email address. Please log out and log in again.');
    }
    
    // Normalize email (lowercase and trim)
    const normalizedEmail = userEmail.toLowerCase().trim();
    
    const url = `${API_BASE}/profile?email=${encodeURIComponent(normalizedEmail)}`;
    console.log('[API] Fetching user profile:', {
      url,
      userEmail: normalizedEmail,
      API_BASE
    });
    
    // Try profile endpoint first
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
        createTimeoutPromise(REQUEST_TIMEOUT_SHORT)
      ]);
    } catch (error) {
      if (error.message === 'Request timeout') {
        throw new Error('Request timeout - server took too long to respond');
      }
      throw error;
    }

    // If profile endpoint doesn't exist (404), try getting user data from dashboard endpoint
    if (!response.ok && response.status === 404) {
      console.log('[API] Profile endpoint not found, trying dashboard endpoint for user data...');
      const dashboardData = await getDashboard(userEmail);
      // Extract user info from dashboard response if available
      if (dashboardData.user) {
        return dashboardData.user;
      }
      // Fallback: return basic info from email
      return {
        email: normalizedEmail,
        name: normalizedEmail.split('@')[0],
        plan: dashboardData.plan || 'N/A',
        created_at: dashboardData.created_at || null,
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[API] Profile response not OK:', {
        status: response.status,
        statusText: response.statusText,
        errorText
      });
      throw new Error(`Failed to load profile: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('[API] Profile data received:', {
      hasName: !!data.name,
      hasEmail: !!data.email,
      hasPlan: !!data.plan,
      fullResponse: data
    });
    return data;
  } catch (error) {
    console.error('[API] Error loading profile:', error);
    throw error;
  }
}
*/
