import { useState, useRef, useEffect, useMemo } from "react";
import "./Dashboard.css";
import total from '../assets/wff.png';
import webflow from '../assets/webflow.png';
import Framer from '../assets/Framer.png';
import www from '../assets/WWW.png';
import { useNotification } from '../hooks/useNotification';
import { cancelSubscription } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/useDashboardQueries';
import { useMemberstack } from '../hooks/useMemberstack';

// Status color mapping
const statusColors = {
  Active: { dot: "#118A41", bg: "#B6F5CF", text: "#118A41" },
  Cancelled: { dot: "#8A1111", bg: "#F5B6B6", text: "#8A1111" },
  Cancelling: { dot: "#8A1111", bg: "#F5B6B6", text: "#8A1111" },
  Expired: { dot: "#717171", bg: "#EEECEC", text: "#717171" },
};

// Source color mapping
const sourceColors = {
  "Direct payment": { bg: "#FEF3C7", text: "#92400E" },
  "License Key": { bg: "#E9D5FF", text: "#6B21A8" },
};

export default function Dashboard({ sites = {}, subscriptions = {}, licenses = [], isPolling = false }) {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef(null);
  const [copiedKey, setCopiedKey] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail } = useMemberstack();

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
      
      const subscriptionId = subscription.subscriptionId || subscription.id;
      
      subscription.items.forEach((item, itemIndex) => {
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
        
        // Use subscription ID as primary key, with item index for uniqueness
        allItems.push({
          id: subscriptionId ? `${subscriptionId}_${itemIndex}` : `sub_${itemIndex}_${siteDomain}`,
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
          subscriptionId: subscriptionId, // Store subscription ID for easy handling
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
    if (e.target.value === "") {
      // Keep expanded if there's text, collapse when empty
    }
  };

  const handleSearchBlur = () => {
    if (searchQuery === "") {
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
          // Fallback copy failed
        }
        document.body.removeChild(textArea);
      }
      
      // Show feedback
      setCopiedKey(licenseKey);
      setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
    } catch (err) {
      // Failed to copy license key
      showError('Failed to copy license key');
    }
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [contextMenu]);

  const handleContextMenu = (e, domainId, subscriptionId) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();

    setContextMenu({
      domainId,
      subscriptionId,
      top: rect.bottom + 6,
      left: rect.left - 180,
    });
  };

  const handleCancelSubscription = async (subscriptionId, domainName, siteDomain) => {
    if (isCancelling) {
      return; // Prevent multiple clicks
    }

    if (!userEmail) {
      showError('User email not found. Please refresh the page.');
      return;
    }

    if (!subscriptionId) {
      showError('Subscription ID not found.');
      return;
    }

    if (!siteDomain) {
      showError('Site domain not found.');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to cancel the subscription for "${domainName}"? This will cancel the entire subscription and all sites in it. The subscription will remain active until the end of the current billing period.`
    );

    if (!confirmed) {
      setContextMenu(null);
      return;
    }

    setIsCancelling(true);
    setContextMenu(null); // Close menu immediately

    try {
      const response = await cancelSubscription(userEmail, siteDomain, subscriptionId);
      const message = response.message || 'Subscription cancelled successfully. The subscription will remain active until the end of the current billing period.';
      showSuccess(message);
      
      // Refresh dashboard data
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
    } catch (error) {
      const errorMessage = error.message || error.error || 'Unknown error';
      showError('Failed to cancel subscription: ' + errorMessage);
    } finally {
      setIsCancelling(false);
    }
  };

return (
    <div className="dashboard-section">
      {/* Summary Statistics */}
      <div className="dashboard-stats">
        <div className="stat-card total-domains">
          <div className="stat-label">Total Domains</div>
          <div className="stat-value" style={{ fontSize:"80px",fontWeight:"200" }}>{dashboardStats.totalDomains}</div>
          <div className="stat-icons">
            <img src={total} alt="total" />
            {/* <div className="stat-icon webflow-icon">W</div>
            <span className="stat-icon-separator">+</span>
            <div className="stat-icon generic-icon"></div> */}
          </div>
        </div>
        <div className="stat-card webflow-card">
          <div className="stat-label">Webflow</div>
          <div className="stat-value">
            <span >
              {dashboardStats.webflow.count}
            </span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{dashboardStats.webflow.totalDomains}
            </span>
          </div>
          <div className="stat-background-icon webflow-bg"><img src={webflow} alt="webflow" /></div>
        </div>
        <div className="stat-card license-card">
          <div className="stat-label">Activated license keys</div>
          <div className="stat-value" style={{color:"#5C577D"}}>
            {dashboardStats.activatedLicenseKeys}
          </div>
                   <div className="stat-background-icon webflow-bg"><img style={{width:"auto"}} src={www} alt="webflow" /></div>
        </div>
        <div className="stat-card framer-card">
          <div className="stat-label">Framer</div>
          <div className="stat-value">
            <span >
              {dashboardStats.framer.count }
            </span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{dashboardStats.framer.totalDomains}
            </span>
          </div>
          <div className="stat-background-icon framer-bg"><img src={Framer} alt="framer" /></div>
        </div>
        <div className="stat-card not-assigned-card">
          <div className="stat-label"><span>Unassigned </span>license keys</div>
          <div className="stat-value not-assigned-value" style={{color:"#5C577D"}}>
            {dashboardStats.notAssignedLicenseKeys}
          </div>
        </div>
      </div>
      {/* Recent Domains Table */}
      <div className="recent-domains-section">
        <div className="recent-domains-header">
          <h3 className="recent-domains-title">Recent domains</h3>
          <div
            className={`search-container ${searchExpanded ? "expanded" : ""}`}
          >
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
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 20 20"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
                    stroke="#666"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="recent-domains-table-container">
          <table className="recent-domains-table">
            <thead>
              <tr>
                <th>Active</th>
                {/* <th>Source</th> */}
                <th>Status</th>
                <th>Billing Period</th>
                <th>Expiration Date</th>
                <th>License Key</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredDomains.map((domain) => (
                <tr key={domain.id}>
                  <td className="black">
                    {/* <div
                      className={`active-indicator ${
                        domain.active ? "active" : "inactive"
                      }`}
                    ></div> */}
                    {domain.domain}
                  </td>
                  {/* <td>
                    <span
                      className={`source-tag ${domain.source
                        .toLowerCase()
                        .replace(" ", "-")}`}
                    >
                      {domain.source}
                    </span>
                  </td> */}
                  <td>
                    <span
                      className="status-tag"
                      style={{
                        backgroundColor:
                          statusColors[domain.status]?.bg || "#F3F4F6",
                        color: statusColors[domain.status]?.text || "#374151",
                      }}
                    >
                      <span
                        className="status-dot"
                        style={{
                          backgroundColor:
                            statusColors[domain.status]?.dot || "#6B7280",
                        }}
                      ></span>
                      {domain.status}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        domain.billingPeriod === "Monthly"
                          ? "billing-monthly"
                          : ""
                      }
                    >
                      {domain.billingPeriod}
                    </span>
                  </td>
                  <td className="black">{domain.expirationDate}</td>
                  <td className="black">
                    <div className="license-key-cell">
                      <span>{domain.licenseKey}</span>
                      <button
                        className="copy-icon-btn"
                        onClick={() => handleCopyLicenseKey(domain.licenseKey)}
                        title="Copy license key"
                      >
                       <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="16" height="16" rx="3" fill="#DEE8F4"/>
<path d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z" stroke="#292D32" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
                      </button>
                    </div>
                  </td>
                  <td className="black">{domain.created}</td>
                  <td>
                    <button className="actions-btn" title="Actions">
              <svg width="17" height="3" viewBox="0 0 17 3">
  <circle cx="1.5" cy="1.5" r="1.5" />
  <circle cx="8.5" cy="1.5" r="1.5" />
  <circle cx="15.5" cy="1.5" r="1.5" />
</svg>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );



  // return (
  //   <div className="dashboard-section">
  //     {/* Summary Statistics */}
  //     <div className="dashboard-stats">
  //       <div className="stat-card total-domains">
  //         <div className="stat-label">Total Domains</div>
  //         <div className="stat-value">{dashboardStats.totalDomains}</div>
  //         <div className="stat-icons">
  //           <img src={total} alt="total" />
  //           {/* <div className="stat-icon webflow-icon">W</div>
  //           <span className="stat-icon-separator">+</span>
  //           <div className="stat-icon generic-icon"></div> */}
  //         </div>
  //       </div>

  //       <div className="stat-card webflow-card">
  //         <div className="stat-label">Webflow</div>
  //         <div className="stat-value">
  //           <span style={{ fontWeight: 700 }}>{dashboardStats.webflow.count}</span>
  //           <span style={{ fontWeight: 400, color: '#999' }}>/{dashboardStats.webflow.total}</span>
  //         </div>
  //         <div className="stat-background-icon webflow-bg"><img src={webflow} alt="webflow" /></div>
  //       </div>

  //       <div className="stat-card license-card">
  //         <div className="stat-label">Activated license keys</div>
  //         <div className="stat-value" style={{color:"#5C577D"}}>
  //           {dashboardStats.activatedLicenseKeys}
  //         </div>
  //                  <div className="stat-background-icon webflow-bg"><img style={{width:"auto"}} src={www} alt="webflow" /></div>

  //       </div>
  //       <div className="stat-card framer-card">
  //         <div className="stat-label">Framer</div>
  //         <div className="stat-value">
  //           <span style={{ fontWeight: 700 }}>{dashboardStats.framer.count}</span>
  //           <span style={{ fontWeight: 400, color: '#999' }}>/{dashboardStats.framer.total}</span>
  //         </div>
  //         <div className="stat-background-icon framer-bg">F</div>
  //       </div>

  //       <div className="stat-card license-card">
  //         <div className="stat-label">Activated license keys</div>
  //         <div className="stat-value">{dashboardStats.activatedLicenseKeys}</div>
  //         <div className="stat-background-icon globe-bg">
  //           <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
  //             <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="2" opacity="0.15"/>
  //             <text x="40" y="48" textAnchor="middle" fontSize="24" fill="currentColor" opacity="0.15" fontWeight="600">www</text>
  //           </svg>
  //         </div>
  //       </div>
  //       <div className="stat-card not-assigned-card">
  //         <div className="stat-label">Not assigned license keys</div>
  //         <div className="stat-value not-assigned-value">{dashboardStats.notAssignedLicenseKeys}</div>
  //       </div>
  //     </div>

  //     {/* Recent Domains Table */}
  //     <div className="recent-domains-section">
  //       <div className="recent-domains-header">
  //         <h3 className="recent-domains-title">
  //           Recent domains
  //           {isPolling && (
  //             <span style={{ 
  //               marginLeft: '10px', 
  //               fontSize: '14px', 
  //               color: '#666', 
  //               fontWeight: 'normal',
  //               fontStyle: 'italic'
  //             }}>
  //               (Processing new domains...)
  //             </span>
  //           )}
  //         </h3>
  //         <div
  //           className={`search-container ${searchExpanded ? "expanded" : ""}`}
  //         >
  //           {searchExpanded ? (
  //             <input
  //               ref={searchInputRef}
  //               type="text"
  //               className="search-input"
  //               placeholder="Search domains..."
  //               value={searchQuery}
  //               onChange={handleSearchChange}
  //               onBlur={handleSearchBlur}
  //             />
  //           ) : (
  //             <button className="search-icon-btn" onClick={handleSearchClick}>
  //               <svg
  //                 width="20"
  //                 height="20"
  //                 viewBox="0 0 20 20"
  //                 fill="none"
  //                 xmlns="http://www.w3.org/2000/svg"
  //               >
  //                 <path
  //                   d="M9 17A8 8 0 1 0 9 1a8 8 0 0 0 0 16zM19 19l-4.35-4.35"
  //                   stroke="#666"
  //                   strokeWidth="2"
  //                   strokeLinecap="round"
  //                   strokeLinejoin="round"
  //                 />
  //               </svg>
  //             </button>
  //           )}
  //         </div>
  //       </div>

  //       <div className="recent-domains-table-container">
  //         <table className="recent-domains-table">
  //           <thead>
  //             <tr>
  //               <th>Active</th>
  //               {/* <th>Source</th> */}
  //               <th>Status</th>
  //               <th>Billing Period</th>
  //               <th>Expiration Date</th>
  //               <th>License Key</th>
  //               <th>Created</th>
  //               <th></th>
  //             </tr>
  //           </thead>
  //           <tbody>
  //             {filteredDomains.length === 0 ? (
  //               <tr>
  //                 <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: '#666' }}>
  //                   {searchQuery ? 'No domains found matching your search' : 'No recent domains found'}
  //                 </td>
  //               </tr>
  //             ) : (
  //               filteredDomains.map((domain) => (
  //               <tr key={domain.id}>
  //                 <td className="black">
  //                   {/* <div
  //                     className={`active-indicator ${
  //                       domain.active ? "active" : "inactive"
  //                     }`}
  //                   ></div> */}
  //                   {domain.domain}
  //                 </td>
  //                 {/* <td>
  //                   <span
  //                     className={`source-tag ${domain.source
  //                       .toLowerCase()
  //                       .replace(" ", "-")}`}
  //                   >
  //                     {domain.source}
  //                   </span>
  //                 </td> */}
  //                 <td>
  //                   <span
  //                     className="status-tag"
  //                     style={{
  //                       backgroundColor:
  //                         statusColors[domain.status]?.bg || "#F3F4F6",
  //                       color: statusColors[domain.status]?.text || "#374151",
  //                     }}
  //                   >
  //                     <span
  //                       className="status-dot"
  //                       style={{
  //                         backgroundColor:
  //                           statusColors[domain.status]?.dot || "#6B7280",
  //                       }}
  //                     ></span>
  //                     {domain.status}
  //                   </span>
  //                 </td>
  //                 <td>
  //                   <span
  //                     className={
  //                       domain.billingPeriod === "Monthly"
  //                         ? "billing-monthly"
  //                         : ""
  //                     }
  //                   >
  //                     {domain.billingPeriod}
  //                   </span>
  //                 </td>
  //                 <td className="black">{domain.expirationDate}</td>
  //                 <td className="black">
  //                   <div className="license-key-cell">
  //                     <span>{domain.licenseKey}</span>
  //                     <button
  //                       className="copy-icon-btn"
  //                       onClick={() => handleCopyLicenseKey(domain.licenseKey)}
  //                       title={copiedKey === domain.licenseKey ? "Copied!" : "Copy license key"}
  //                       style={{ 
  //                         opacity: copiedKey === domain.licenseKey ? 0.6 : 1,
  //                         cursor: domain.licenseKey === 'N/A' ? 'not-allowed' : 'pointer'
  //                       }}
  //                       disabled={domain.licenseKey === 'N/A'}
  //                     >
  //                       {copiedKey === domain.licenseKey ? (
  //                         <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  //                           <rect width="16" height="16" rx="3" fill="#10B981" />
  //                           <path d="M4 8L6.5 10.5L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  //                         </svg>
  //                       ) : (
  //                         <svg
  //                           width="16"
  //                           height="16"
  //                           viewBox="0 0 16 16"
  //                           fill="none"
  //                           xmlns="http://www.w3.org/2000/svg"
  //                         >
  //                           <rect width="16" height="16" rx="3" fill="#DEE8F4" />
  //                           <path
  //                             d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z"
  //                             stroke="#292D32"
  //                             strokeWidth="1.5"
  //                             strokeLinecap="round"
  //                             strokeLinejoin="round"
  //                           />
  //                           <path
  //                             d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z"
  //                             stroke="#292D32"
  //                             strokeWidth="1.5"
  //                             strokeLinecap="round"
  //                             strokeLinejoin="round"
  //                           />
  //                         </svg>
  //                       )}
  //                     </button>
  //                   </div>
  //                 </td>
  //                 <td className="black">{domain.created}</td>
  //                 <td>
  //                   <div style={{ position: 'relative' }}>
  //                     <button 
  //                       className="actions-btn" 
  //                       title="Actions"
  //                       onClick={(e) => handleContextMenu(e, domain.id, domain.subscriptionId)}
  //                     >
  //                       <svg width="17" height="3" viewBox="0 0 17 3">
  //                         <circle cx="1.5" cy="1.5" r="1.5" />
  //                         <circle cx="8.5" cy="1.5" r="1.5" />
  //                         <circle cx="15.5" cy="1.5" r="1.5" />
  //                       </svg>
  //                     </button>
  //                     {contextMenu?.domainId === domain.id && (
  //                       <div
  //                         ref={contextMenuRef}
  //                         className="domain-context-menu"
  //                         style={{
  //                           position: 'fixed',
  //                           top: contextMenu.top,
  //                           left: contextMenu.left,
  //                         }}
  //                       >
  //                         {domain.source === 'Direct payment' && 
  //                          domain.subscriptionId && 
  //                          domain.status !== 'Cancelled' && 
  //                          domain.status !== 'Expired' && 
  //                          domain.status !== 'Cancelling' && (
  //                           <button
  //                             className="context-menu-item context-menu-item-danger"
  //                             onClick={() => handleCancelSubscription(domain.subscriptionId, domain.siteName || domain.domain, domain.domain)}
  //                             disabled={isCancelling}
  //                           >
  //                             <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  //                               <path d="M12 4L4 12M4 4L12 12" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  //                             </svg>
  //                             <span>{isCancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
  //                           </button>
  //                         )}
  //                       </div>
  //                     )}
  //                   </div>
  //                 </td>
  //               </tr>
  //             )))}
  //           </tbody>
  //         </table>
  //       </div>
  //     </div>
  //   </div>
  // );
}
