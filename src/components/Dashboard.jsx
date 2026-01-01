import { useState, useRef, useEffect, useMemo } from 'react';
import './Dashboard.css';

// Status color mapping
const statusColors = {
  Active: { dot: '#10B981', bg: '#D1FAE5', text: '#065F46' },
  Cancelled: { dot: '#EF4444', bg: '#FEE2E2', text: '#991B1B' },
  Cancelling: { dot: '#F97316', bg: '#FFEDD5', text: '#9A3412' },
  Expired: { dot: '#6B7280', bg: '#F3F4F6', text: '#374151' },
};

// Source color mapping
const sourceColors = {
  'Direct payment': { bg: '#FEF3C7', text: '#92400E' },
  'License Key': { bg: '#E9D5FF', text: '#6B21A8' },
};

export default function Dashboard({ sites = {}, subscriptions = {}, licenses = [] }) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);
  const [copiedKey, setCopiedKey] = useState(null);

  // Calculate stats from real data
  const dashboardStats = useMemo(() => {
    const totalDomains = Object.keys(sites).length;
    const activeSites = Object.values(sites).filter(site => 
      site.status === 'active' || site.status === 'pending'
    ).length;
    
    // Count Webflow and Framer sites (you may need to adjust based on your data)
    const webflowCount = Object.values(sites).filter(site => 
      site.platform === 'webflow' || site.source === 'webflow'
    ).length;
    const framerCount = Object.values(sites).filter(site => 
      site.platform === 'framer' || site.source === 'framer'
    ).length;
    
    // Count activated and unassigned license keys
    const activatedLicenseKeys = licenses.filter(lic => 
      lic.status === 'active' && (lic.used_site_domain || lic.site_domain)
    ).length;
    const notAssignedLicenseKeys = licenses.filter(lic => 
      lic.status === 'active' && !lic.used_site_domain && !lic.site_domain
    ).length;
    
    return {
      totalDomains,
      webflow: { count: webflowCount, total: totalDomains },
      framer: { count: framerCount, total: totalDomains },
      activatedLicenseKeys,
      notAssignedLicenseKeys,
    };
  }, [sites, licenses]);

  // Process and combine data from subscriptions and activated licenses
  // Get maximum 20 most recent items
  const recentDomains = useMemo(() => {
    const allItems = [];
    
    // Process subscriptions - get all items from all subscriptions
    const subscriptionsArray = Array.isArray(subscriptions) 
      ? subscriptions 
      : Object.values(subscriptions || {});
    
    subscriptionsArray.forEach(subscription => {
      if (!subscription || !subscription.items || !Array.isArray(subscription.items)) {
        return;
      }
      
      subscription.items.forEach(item => {
        const siteDomain = item.site || item.site_domain;
        if (!siteDomain || siteDomain.trim() === '') {
          return;
        }
        
        // Skip placeholder sites
        if (siteDomain.startsWith('site_') && /^site_\d+$/.test(siteDomain)) {
          return;
        }
        if ((siteDomain.startsWith('license_') || siteDomain.startsWith('quantity_')) && !item.isActivated) {
          return;
        }
        
        // Determine source
        const source = item.purchase_type === 'quantity' && item.isActivated 
          ? 'License Key' 
          : 'Direct payment';
        
        // Determine status
        let status = 'Active';
        if (item.status === 'inactive' || item.status === 'cancelled') {
          status = 'Cancelled';
        } else if (subscription.status === 'cancelled' || subscription.cancel_at_period_end) {
          if (subscription.current_period_end && subscription.current_period_end < Math.floor(Date.now() / 1000)) {
            status = 'Cancelled';
          } else {
            status = 'Cancelling';
          }
        } else if (item.status === 'expired') {
          status = 'Expired';
        }
        
        // Get billing period
        let billingPeriod = 'N/A';
        if (subscription.billingPeriod) {
          const period = subscription.billingPeriod.toLowerCase().trim();
          // If already ends with 'ly', use as is (capitalize first letter)
          if (period.endsWith('ly')) {
            billingPeriod = period.charAt(0).toUpperCase() + period.slice(1);
          } else {
            // Otherwise add 'ly' (e.g., 'month' -> 'Monthly', 'year' -> 'Yearly')
            billingPeriod = period.charAt(0).toUpperCase() + period.slice(1) + 'ly';
          }
        }
        
        // Get expiration date
        let expirationDate = 'N/A';
        const renewalDate = item.renewal_date || subscription.current_period_end;
        if (renewalDate) {
          try {
            const timestamp = typeof renewalDate === 'number' ? renewalDate : parseInt(renewalDate);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            expirationDate = new Date(dateInMs).toLocaleDateString();
          } catch (e) {
            expirationDate = 'N/A';
          }
        }
        
        // Get created date
        let created = 'N/A';
        const createdAt = item.created_at || subscription.created_at;
        if (createdAt) {
          try {
            const timestamp = typeof createdAt === 'number' ? createdAt : parseInt(createdAt);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            created = new Date(dateInMs).toLocaleDateString();
          } catch (e) {
            created = 'N/A';
          }
        }
        
        // Get site name from sites object if available
        const siteData = sites[siteDomain];
        const siteName = siteData?.name || siteData?.site_name || siteDomain;
        
        allItems.push({
          id: `${subscription.subscriptionId || subscription.id || 'sub'}_${item.item_id || siteDomain}`,
          domain: siteDomain,
          siteName: siteName, // Add site name from response
          active: status === 'Active' || status === 'Cancelling',
          source: source,
          status: status,
          billingPeriod: billingPeriod,
          expirationDate: expirationDate,
          licenseKey: item.license_key || 'N/A',
          created: created,
          createdTimestamp: createdAt || 0,
        });
      });
    });
    
    // Process licenses - get only activated sites (used_site_domain)
    licenses.forEach(license => {
      // Only include activated licenses
      if (license.status === 'active' && license.used_site_domain) {
        const activatedSite = license.used_site_domain;
        
        // Skip if already added from subscriptions
        const alreadyAdded = allItems.some(item => 
          item.domain.toLowerCase().trim() === activatedSite.toLowerCase().trim()
        );
        
        if (alreadyAdded) {
          return;
        }
        
        // Skip placeholder sites
        if (activatedSite.startsWith('license_') || 
            activatedSite.startsWith('quantity_') || 
            activatedSite === 'N/A' ||
            activatedSite.startsWith('KEY-')) {
          return;
        }
        
        // Get expiration date from license
        let expirationDate = 'N/A';
        if (license.renewal_date) {
          try {
            const timestamp = typeof license.renewal_date === 'number' 
              ? license.renewal_date 
              : parseInt(license.renewal_date);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            expirationDate = new Date(dateInMs).toLocaleDateString();
          } catch (e) {
            expirationDate = 'N/A';
          }
        }
        
        // Get created date
        let created = 'N/A';
        if (license.created_at) {
          try {
            const timestamp = typeof license.created_at === 'number' 
              ? license.created_at 
              : parseInt(license.created_at);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            created = new Date(dateInMs).toLocaleDateString();
          } catch (e) {
            created = 'N/A';
          }
        }
        
        // Get billing period
        let billingPeriod = 'N/A';
        if (license.billing_period) {
          const period = license.billing_period.toLowerCase().trim();
          // If already ends with 'ly', use as is (capitalize first letter)
          if (period.endsWith('ly')) {
            billingPeriod = period.charAt(0).toUpperCase() + period.slice(1);
          } else {
            // Otherwise add 'ly' (e.g., 'month' -> 'Monthly', 'year' -> 'Yearly')
            billingPeriod = period.charAt(0).toUpperCase() + period.slice(1) + 'ly';
          }
        }
        
        // Get site name from sites object if available
        const siteData = sites[activatedSite];
        const siteName = siteData?.name || siteData?.site_name || activatedSite;
        
        allItems.push({
          id: `license_${license.license_key || activatedSite}`,
          domain: activatedSite,
          siteName: siteName, // Add site name from response
          active: true,
          source: 'License Key',
          status: 'Active',
          billingPeriod: billingPeriod,
          expirationDate: expirationDate,
          licenseKey: license.license_key || 'N/A',
          created: created,
          createdTimestamp: license.created_at || 0,
        });
      }
    });
    
    // Sort by created timestamp (most recent first) and limit to 20
    return allItems
      .sort((a, b) => {
        if (a.createdTimestamp === 0) return 1;
        if (b.createdTimestamp === 0) return -1;
        return b.createdTimestamp - a.createdTimestamp;
      })
      .slice(0, 20); // Maximum 20 items
  }, [sites, subscriptions, licenses]);

  // Filter domains based on search query
  const filteredDomains = useMemo(() => {
    if (!searchQuery.trim()) return recentDomains;
    const query = searchQuery.toLowerCase();
    return recentDomains.filter(domain => 
      domain.domain.toLowerCase().includes(query) ||
      domain.licenseKey.toLowerCase().includes(query)
    );
  }, [recentDomains, searchQuery]);

  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchExpanded]);

  const handleSearchClick = () => {
    setSearchExpanded(true);
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    if (e.target.value === '') {
      // Keep expanded if there's text, collapse when empty
    }
  };

  const handleSearchBlur = () => {
    if (searchQuery === '') {
      setSearchExpanded(false);
    }
  };

  const handleCopyLicenseKey = async (licenseKey) => {
    if (!licenseKey || licenseKey === 'N/A') {
      return;
    }
    
    try {
      // Use modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(licenseKey);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = licenseKey;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
        } catch (err) {
          console.error('Fallback copy failed:', err);
        }
        document.body.removeChild(textArea);
      }
      
      // Show feedback
      setCopiedKey(licenseKey);
      setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy license key:', err);
    }
  };

  return (
    <div className="dashboard-section">
      {/* Summary Statistics */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">Total Domains</div>
          <div className="stat-value">{dashboardStats.totalDomains}</div>
          <div className="stat-icons">
            <div className="stat-icon webflow-icon">W</div>
            <span className="stat-icon-separator">+</span>
            <div className="stat-icon generic-icon"></div>
          </div>
        </div>

        <div className="stat-card webflow-card">
          <div className="stat-label">Webflow</div>
          <div className="stat-value">
            <span style={{ fontWeight: 700 }}>{dashboardStats.webflow.count}</span>
            <span style={{ fontWeight: 400, color: '#999' }}>/{dashboardStats.webflow.total}</span>
          </div>
          <div className="stat-background-icon webflow-bg">W</div>
        </div>

        <div className="stat-card framer-card">
          <div className="stat-label">Framer</div>
          <div className="stat-value">
            <span style={{ fontWeight: 700 }}>{dashboardStats.framer.count}</span>
            <span style={{ fontWeight: 400, color: '#999' }}>/{dashboardStats.framer.total}</span>
          </div>
          <div className="stat-background-icon framer-bg">F</div>
        </div>

        <div className="stat-card license-card">
          <div className="stat-label">Activated license keys</div>
          <div className="stat-value">{dashboardStats.activatedLicenseKeys}</div>
          <div className="stat-background-icon globe-bg">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="2" opacity="0.15"/>
              <text x="40" y="48" textAnchor="middle" fontSize="24" fill="currentColor" opacity="0.15" fontWeight="600">www</text>
            </svg>
          </div>
        </div>

        <div className="stat-card not-assigned-card">
          <div className="stat-label">Not assigned license keys</div>
          <div className="stat-value not-assigned-value">{dashboardStats.notAssignedLicenseKeys}</div>
        </div>
      </div>

      {/* Recent Domains Table */}
      <div className="recent-domains-section">
        <div className="recent-domains-header">
          <h3 className="recent-domains-title">Recent domains</h3>
          <div className={`search-container ${searchExpanded ? 'expanded' : ''}`}>
            {searchExpanded ? (
              <input
                ref={searchInputRef}
                type="text"
                className="search-input"
                placeholder="Search domains..."
                value={searchQuery}
                onChange={handleSearchChange}
                onBlur={handleSearchBlur}
              />
            ) : (
              <button className="search-icon-btn" onClick={handleSearchClick}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35" stroke="#666" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="recent-domains-table-container">
          <table className="recent-domains-table">
            <thead>
              <tr>
                <th>Domain</th>
                <th>Source</th>
                <th>Status</th>
                <th>Billing Period</th>
                <th>Expiration Date</th>
                <th>License Key</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDomains.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
                    {searchQuery ? 'No domains found matching your search' : 'No recent domains found'}
                  </td>
                </tr>
              ) : (
                filteredDomains.map((domain) => (
                <tr key={domain.id}>
                  <td>
                    <span style={{ fontWeight: '500', color: '#111827' }}>
                      {domain.siteName || domain.domain}
                    </span>
                  </td>
                  <td>
                    <span className={`source-tag ${domain.source.toLowerCase().replace(' ', '-')}`}>
                      {domain.source}
                    </span>
                  </td>
                  <td>
                    <span className="status-tag" style={{
                      backgroundColor: statusColors[domain.status]?.bg || '#F3F4F6',
                      color: statusColors[domain.status]?.text || '#374151',
                    }}>
                      <span className="status-dot" style={{
                        backgroundColor: statusColors[domain.status]?.dot || '#6B7280',
                      }}></span>
                      {domain.status}
                    </span>
                  </td>
                  <td>
                    <span className={domain.billingPeriod === 'Monthly' ? 'billing-monthly' : ''}>
                      {domain.billingPeriod}
                    </span>
                  </td>
                  <td>{domain.expirationDate}</td>
                  <td>
                    <div className="license-key-cell">
                      <span>{domain.licenseKey}</span>
                      <button
                        className="copy-icon-btn"
                        onClick={() => handleCopyLicenseKey(domain.licenseKey)}
                        title={copiedKey === domain.licenseKey ? "Copied!" : "Copy license key"}
                        style={{ 
                          opacity: copiedKey === domain.licenseKey ? 0.6 : 1,
                          cursor: domain.licenseKey === 'N/A' ? 'not-allowed' : 'pointer'
                        }}
                        disabled={domain.licenseKey === 'N/A'}
                      >
                        {copiedKey === domain.licenseKey ? (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M13.5 4.5L6 12L2.5 8.5" stroke="#10B981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M5.5 2H3.5C2.67157 2 2 2.67157 2 3.5V12.5C2 13.3284 2.67157 14 3.5 14H9.5C10.3284 14 11 13.3284 11 12.5V10.5M5.5 2C5.5 2.27614 5.72386 2.5 6 2.5H9.5M5.5 2V5.5C5.5 5.77614 5.72386 6 6 6H9.5M9.5 2.5V6H13M9.5 2.5L13 6M9.5 10.5H13M13 10.5V13.5M13 10.5H9.5M13 13.5H9.5M13 13.5V10.5" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                  <td>{domain.created}</td>
                  <td>
                    <button className="actions-btn" title="Actions">
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="10" cy="5" r="1.5" fill="#666"/>
                        <circle cx="10" cy="10" r="1.5" fill="#666"/>
                        <circle cx="10" cy="15" r="1.5" fill="#666"/>
                      </svg>
                    </button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

