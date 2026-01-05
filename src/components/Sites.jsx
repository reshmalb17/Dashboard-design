import { useState, useRef, useEffect, useMemo } from 'react';
import { useAddSite, useRemoveSite } from '../hooks/useDashboardQueries';
import { useNotification } from '../hooks/useNotification';
import { cancelSubscription } from '../services/api';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../hooks/useDashboardQueries';
import { useMemberstack } from '../hooks/useMemberstack';
import './Sites.css';

// Status dropdown options with colors
const statusOptions = [
  { value: "Active", label: "Active", color: "#10B981" },
  { value: "Cancelled", label: "Cancelled", color: "#EF4444" },
  { value: "Cancelling", label: "Cancelling", color: "#EF4444" },
  { value: "Expired", label: "Expired", color: "#6B7280" },
];

// Custom Status Dropdown Component
function StatusDropdown({ value, onChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const selectedOption = statusOptions.find((opt) => opt.value === value) || {
    label: "Status",
    color: "#666",
  };

  return (
    <div
      className={`status-dropdown-wrapper ${isOpen ? "open" : ""}`}
      ref={dropdownRef}
    >
      <button
        className="status-dropdown-button"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <span className="status-dropdown-selected">
          {value ? (
            <>
              <span
                className="status-dropdown-dot"
                style={{ backgroundColor: selectedOption.color }}
              />
              <span>{selectedOption.label}</span>
            </>
          ) : (
            "Status"
          )}
        </span>
        <svg
          className="status-dropdown-chevron"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
        >
          <path
            d="M3 4.5L6 7.5L9 4.5"
            stroke="#666"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="status-dropdown-menu">
          <button
            className="status-dropdown-option"
            onClick={() => {
              onChange("");
              setIsOpen(false);
            }}
          >
            Status
          </button>
          <div className="status-dropdown-separator" />
          {statusOptions.map((option) => (
            <button
              key={option.value}
              className={`status-dropdown-option ${
                value === option.value ? "selected" : ""
              }`}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              <span
                className="status-dropdown-dot"
                style={{ backgroundColor: option.color }}
              />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sites({ sites, subscriptions = {}, licenses = [], userEmail, isPolling = false }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [filters, setFilters] = useState({
    source: "",
    status: "",
    billingPeriod: "",
    expirationDate: "",
    created: "",
  });
  const [contextMenu, setContextMenu] = useState(null);
  const [visibleLicenseKeys, setVisibleLicenseKeys] = useState({});
  const [isCancelling, setIsCancelling] = useState(false);
  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const { userEmail: memberstackEmail } = useMemberstack();
  const effectiveUserEmail = userEmail || memberstackEmail;

  // Convert sites object and subscriptions to domains array format
  // Process both sites object and subscriptions (like Dashboard does)
  // Only show Direct payment and Site payment (exclude License Key)
  const domains = useMemo(() => {
    const allDomains = [];
    
    // Process subscriptions first (like Dashboard does)
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
        
        // Skip License Key items in Domain section
        if (source === 'License Key') {
          return;
        }
        
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
          if (period.endsWith('ly')) {
            billingPeriod = period.charAt(0).toUpperCase() + period.slice(1);
          } else {
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
        
        allDomains.push({
          id: subscriptionId ? `${subscriptionId}_${itemIndex}` : `sub_${itemIndex}_${siteDomain}`,
          domain: siteDomain,
          siteName: siteName,
          source: source,
          status: status,
          billingPeriod: billingPeriod,
          expirationDate: expirationDate,
          licenseKey: item.license_key || 'N/A',
          created: created,
          subscriptionId: subscriptionId,
        });
      });
    });
    
    // Also process sites object (for any sites not in subscriptions)
    if (sites && Object.keys(sites).length > 0) {
      const processedDomains = Object.entries(sites)
      .map(([domain, siteData]) => {
      // Get site name from site data
      const siteName = siteData?.name || siteData?.site_name || domain;
      
      // Format dates
      let expirationDate = 'N/A';
      if (siteData.expiration_date || siteData.renewal_date) {
        try {
          const timestamp = typeof (siteData.expiration_date || siteData.renewal_date) === 'number' 
            ? (siteData.expiration_date || siteData.renewal_date)
            : parseInt(siteData.expiration_date || siteData.renewal_date);
          const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
          expirationDate = new Date(dateInMs).toLocaleDateString();
        } catch (e) {
          expirationDate = 'N/A';
        }
      }

      let created = 'N/A';
      if (siteData.created_at) {
        try {
          const timestamp = typeof siteData.created_at === 'number' 
            ? siteData.created_at 
            : parseInt(siteData.created_at);
          const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
          created = new Date(dateInMs).toLocaleDateString();
        } catch (e) {
          created = 'N/A';
        }
      }

      // Format billing period
      let billingPeriod = 'N/A';
      if (siteData.billing_period) {
        const period = siteData.billing_period.toLowerCase().trim();
        if (period.endsWith('ly')) {
          billingPeriod = period.charAt(0).toUpperCase() + period.slice(1);
        } else {
          billingPeriod = period.charAt(0).toUpperCase() + period.slice(1) + 'ly';
        }
      }

      // Determine status - prioritize expired, then cancelled, then check expiration date
      let status = 'Active';
      if (siteData.status) {
        const statusLower = siteData.status.toLowerCase().trim();
        
        // Check for expired first
        if (statusLower === 'expired') {
          status = 'Expired';
        } 
        // Check for cancelled/canceling
        else if (statusLower === 'cancelled' || statusLower === 'canceled' || statusLower === 'cancelling' || statusLower === 'canceling') {
          // Check if it's actually expired based on expiration date
          if (siteData.expiration_date || siteData.renewal_date) {
            try {
              const timestamp = typeof (siteData.expiration_date || siteData.renewal_date) === 'number' 
                ? (siteData.expiration_date || siteData.renewal_date)
                : parseInt(siteData.expiration_date || siteData.renewal_date);
              const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
              const expirationDateObj = new Date(dateInMs);
              const now = new Date();
              if (expirationDateObj < now) {
                status = 'Expired';
              } else if (statusLower === 'cancelling' || statusLower === 'canceling') {
                status = 'Cancelling';
              } else {
                status = 'Cancelled';
              }
            } catch (e) {
              // If date parsing fails, use the status from backend
              if (statusLower === 'cancelling' || statusLower === 'canceling') {
                status = 'Cancelling';
              } else {
                status = 'Cancelled';
              }
            }
          } else {
            // No expiration date, use status from backend
            if (statusLower === 'cancelling' || statusLower === 'canceling') {
              status = 'Cancelling';
            } else {
              status = 'Cancelled';
            }
          }
        }
        // Check for inactive - might be expired or cancelled
        else if (statusLower === 'inactive') {
          // Check if it's actually expired based on expiration date
          if (siteData.expiration_date || siteData.renewal_date) {
            try {
              const timestamp = typeof (siteData.expiration_date || siteData.renewal_date) === 'number' 
                ? (siteData.expiration_date || siteData.renewal_date)
                : parseInt(siteData.expiration_date || siteData.renewal_date);
              const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
              const expirationDateObj = new Date(dateInMs);
              const now = new Date();
              if (expirationDateObj < now) {
                status = 'Expired';
              } else {
                // Inactive but not expired - check if it's cancelled
                // If there's a cancel_at or canceled_at field, it's cancelled
                if (siteData.cancel_at || siteData.canceled_at || siteData.cancel_at_period_end) {
                  status = 'Cancelled';
                } else {
                  status = 'Inactive';
                }
              }
            } catch (e) {
              // If date parsing fails, check for cancel indicators
              if (siteData.cancel_at || siteData.canceled_at || siteData.cancel_at_period_end) {
                status = 'Cancelled';
              } else {
                status = 'Inactive';
              }
            }
          } else {
            // No expiration date, check for cancel indicators
            if (siteData.cancel_at || siteData.canceled_at || siteData.cancel_at_period_end) {
              status = 'Cancelled';
            } else {
              status = 'Inactive';
            }
          }
        } 
        // For other statuses, capitalize first letter
        else {
          status = siteData.status.charAt(0).toUpperCase() + siteData.status.slice(1);
        }
      } else {
        // If no status, check expiration date
        if (siteData.expiration_date || siteData.renewal_date) {
          try {
            const timestamp = typeof (siteData.expiration_date || siteData.renewal_date) === 'number' 
              ? (siteData.expiration_date || siteData.renewal_date)
              : parseInt(siteData.expiration_date || siteData.renewal_date);
            const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
            const expirationDateObj = new Date(dateInMs);
            const now = new Date();
            if (expirationDateObj < now) {
              status = 'Expired';
            }
          } catch (e) {
            // Keep as Active if date parsing fails
          }
        }
      }

      return {
        id: domain,
        domain: domain,
        siteName: siteName, // Add site name from response
        source: siteData.source || 'Direct payment',
        status: status,
        billingPeriod: billingPeriod,
        expirationDate: expirationDate,
        licenseKey: siteData.license_key || 'N/A',
        created: created,
        subscriptionId: siteData.subscription_id || siteData.subscriptionId || null,
      };
      })
      .filter(domain => {
        // Show Direct payment, Site payment, and Site purchase - exclude License Key
        const source = domain.source || '';
        
        // Exclude License Key items - check multiple conditions
        if (source === 'License Key' || 
            source.toLowerCase().includes('license') ||
            (domain.licenseKey && domain.licenseKey !== 'N/A' && domain.licenseKey.startsWith('KEY-'))) {
          return false;
        }
        
        // Show Direct payment, Site payment, Site purchase, or empty source
        // Include all statuses (Active, Cancelled, Expired, etc.)
        return source === 'Direct payment' || 
               source === 'Site payment' || 
               source === 'Site purchase' ||
               source.toLowerCase().includes('site purchase') ||
               source === '';
      })
      .forEach(domain => {
        // Check if domain already exists from subscriptions
        const exists = allDomains.some(d => d.domain.toLowerCase().trim() === domain.domain.toLowerCase().trim());
        if (!exists) {
          allDomains.push(domain);
        }
      });
    }
    
    // Remove duplicates based on domain name (case-insensitive)
    const uniqueDomains = [];
    const seenDomains = new Set();
    allDomains.forEach(domain => {
      const domainKey = domain.domain.toLowerCase().trim();
      if (!seenDomains.has(domainKey)) {
        seenDomains.add(domainKey);
        uniqueDomains.push(domain);
      }
    });
    
    return uniqueDomains;
  }, [sites, subscriptions, licenses]);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(event.target)
      ) {
        setContextMenu(null);
      }
    };

    if (contextMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [contextMenu]);

  const toggleLicenseKeyVisibility = (domainId) => {
    setVisibleLicenseKeys((prev) => ({
      ...prev,
      [domainId]: !prev[domainId],
    }));
  };

  const handleContextMenu = (e, domainId) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = e.currentTarget.getBoundingClientRect();

    setContextMenu({
      domainId,
      top: rect.bottom + 6, // below button
      left: rect.left - 180, // open to the left
    });
  };

  const [copiedKey, setCopiedKey] = useState(null);

  const handleCopyLicenseKey = async (licenseKey) => {
    if (!licenseKey || licenseKey === 'N/A' || String(licenseKey).trim() === '') {
      showError('No license key to copy');
      return;
    }
    
    const keyToCopy = String(licenseKey).trim();
    
    try {
      // Use modern clipboard API
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(keyToCopy);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = keyToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          const success = document.execCommand('copy');
          if (!success) {
            throw new Error('execCommand copy returned false');
          }
        } catch (err) {
          throw err;
        }
        document.body.removeChild(textArea);
      }
      
      // Show feedback
      setCopiedKey(keyToCopy);
      showSuccess("License key copied to clipboard");
      setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
      if (contextMenu) {
        setContextMenu(null);
      }
    } catch (err) {
      showError('Failed to copy license key');
    }
  };

  const handleDeleteDomain = (domainId) => {
    if (window.confirm("Are you sure you want to delete this domain?")) {
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
      showSuccess("Domain deleted successfully");
      setContextMenu(null);
    }
  };

  const handleClearFilters = () => {
    setFilters({
      source: "",
      status: "",
      billingPeriod: "",
      expirationDate: "",
      created: "",
    });
  };

  const filteredDomains = useMemo(() => {
    const filtered = domains.filter(domain => {
      // Search filter - search in both domain and site name
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesDomain = domain.domain.toLowerCase().includes(query);
        const matchesSiteName = (domain.siteName || '').toLowerCase().includes(query);
        if (!matchesDomain && !matchesSiteName) {
          return false;
        }
      }
      // Other filters
      if (filters.source && domain.source !== filters.source) return false;
      // Only filter by status if a status is explicitly selected (not empty string)
      if (filters.status && filters.status.trim() !== '' && domain.status !== filters.status) return false;
      if (filters.billingPeriod && domain.billingPeriod !== filters.billingPeriod) return false;
      if (filters.expirationDate && domain.expirationDate !== filters.expirationDate) return false;
      if (filters.created && domain.created !== filters.created) return false;
      return true;
    });
    
    return filtered;
  }, [domains, searchQuery, filters]);

  const hasActiveFilters = Object.values(filters).some((v) => v !== "");

  const handleSearchIconClick = () => {
    setIsSearchExpanded(true);
    // Focus the input after a short delay to ensure it's rendered
    setTimeout(() => {
      searchInputRef.current?.focus();
    }, 100);
  };

  const handleSearchBlur = () => {
    // Only collapse if search query is empty
    if (!searchQuery.trim()) {
      setIsSearchExpanded(false);
    }
  };

  const handleCancelSubscription = async (subscriptionId, domainName, siteDomain) => {
    if (isCancelling) {
      return; // Prevent multiple clicks
    }

    if (!effectiveUserEmail) {
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
      const response = await cancelSubscription(effectiveUserEmail, siteDomain, subscriptionId);
      const message = response.message || 'Subscription cancelled successfully. The subscription will remain active until the end of the current billing period.';
      showSuccess(message);
      
      // Refresh dashboard data
      await queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(effectiveUserEmail) });
    } catch (error) {
      const errorMessage = error.message || error.error || 'Unknown error';
      showError('Failed to cancel subscription: ' + errorMessage);
    } finally {
      setIsCancelling(false);
    }
  };

  // Keep search expanded if there's a query
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsSearchExpanded(true);
    }
  }, [searchQuery]);

  return (
    <div className="domains-container">
      {/* Header */}
      <div className="domains-header">
        <h1 className="domains-title">
          Domains
          {isPolling && (
            <span style={{ 
              marginLeft: '10px', 
              fontSize: '14px', 
              color: '#666', 
              fontWeight: 'normal',
              fontStyle: 'italic'
            }}>
              (Processing new domains...)
            </span>
          )}
        </h1>
        <div
          className={`domains-search-wrapper ${
            isSearchExpanded ? "expanded" : ""
          }`}
        >
          <input
            ref={searchInputRef}
            type="text"
            className="domains-search-input"
            placeholder="Caspian"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onBlur={handleSearchBlur}
          />
          <button
            className="domains-search-icon-btn"
            onClick={handleSearchIconClick}
            type="button"
            title="Search"
          >
            <svg
              className="domains-search-icon"
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M9 17C13.4183 17 17 13.4183 17 9C17 4.58172 13.4183 1 9 1C4.58172 1 1 4.58172 1 9C1 13.4183 4.58172 17 9 17Z"
                stroke="#666"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M19 19L14.65 14.65"
                stroke="#666"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="domains-filters">
        <select
          className="domains-filter-select"
          value={filters.source}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, source: e.target.value }))
          }
        >
          <option value="">Source</option>
          <option value="Direct payment">Direct payment</option>
          <option value="Site payment">Site payment</option>
        </select>

        <StatusDropdown
          value={filters.status}
          onChange={(value) =>
            setFilters((prev) => ({ ...prev, status: value }))
          }
        />

        <select
          className="domains-filter-select"
          value={filters.billingPeriod}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, billingPeriod: e.target.value }))
          }
        >
          <option value="">Billing Period</option>
          <option value="Monthly">Monthly</option>
          <option value="Yearly">Yearly</option>
        </select>

        <select
          className="domains-filter-select"
          value={filters.expirationDate}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, expirationDate: e.target.value }))
          }
        >
          <option value="">Expiration Date</option>
          <option value="N/A">N/A</option>
          <option value="12/12/26">12/12/26</option>
        </select>

        <select
          className="domains-filter-select"
          value={filters.created}
          onChange={(e) =>
            setFilters((prev) => ({ ...prev, created: e.target.value }))
          }
        >
          <option value="">Created</option>
          <option value="12/12/26">12/12/26</option>
        </select>

        {hasActiveFilters && (
          <button
            className="domains-filter-clear"
            onClick={handleClearFilters}
            title="Clear filters"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="#666"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Table */}
      <div className="domains-table-wrapper">
        <table className="domains-table">
          <thead>
            <tr>
              <th>Active</th>
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
            {filteredDomains.map((domain) => (
              <tr key={domain.id}>
                <td>
                  <div className="domain-cell-content">
                    {domain.siteName || domain.domain}
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content">
                    <span
                      className={`source-tag source-tag-${
                        domain.source === "Direct payment"
                          ? "direct"
                          : "license"
                      }`}
                    >
                      {domain.source}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content">
                    <span className={`status-tag status-tag-${(domain.status || 'active').toLowerCase().trim()}`}>
                      <span className="status-dot" />
                      <span className="status-text">{domain.status}</span>
                    </span>
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content">
                    <span
                      className={
                        domain.billingPeriod === "Monthly"
                          ? "billing-monthly"
                          : "yearly"
                      }
                    >
                      {domain.billingPeriod}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content">
                    {domain.expirationDate}
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content domain-license-key">
                    <span className="license-key-text">
                      {domain.licenseKey}
                    </span>
                    <button
                      type="button"
                      className="license-key-copy"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (domain.licenseKey && domain.licenseKey !== 'N/A') {
                          handleCopyLicenseKey(domain.licenseKey);
                        }
                      }}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onMouseUp={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      title={copiedKey === domain.licenseKey ? "Copied!" : "Copy license key"}
                      disabled={domain.licenseKey === 'N/A' || !domain.licenseKey}
                      style={{
                        opacity: copiedKey === domain.licenseKey ? 0.6 : (domain.licenseKey === 'N/A' || !domain.licenseKey ? 0.5 : 1),
                        cursor: (domain.licenseKey === 'N/A' || !domain.licenseKey) ? 'not-allowed' : 'pointer',
                        pointerEvents: (domain.licenseKey === 'N/A' || !domain.licenseKey) ? 'none' : 'auto',
                        minWidth: '24px',
                        minHeight: '24px',
                        position: 'relative',
                        zIndex: 100
                      }}
                    >
                      {copiedKey === domain.licenseKey ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect width="16" height="16" rx="3" fill="#10B981" />
                          <path d="M4 8L6.5 10.5L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      ) : (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 16 16"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <rect width="16" height="16" rx="3" fill="#DEE8F4" />
                          <path
                            d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z"
                            stroke="#292D32"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          <path
                            d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z"
                            stroke="#292D32"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </button>
                  </div>
                </td>
                <td>
                  <div className="domain-cell-content">{domain.created}</div>
                </td>
                <td>
                  <div className="domain-cell-content domain-actions">
                    <button
                      className="domain-actions-btn"
                      onClick={(e) => handleContextMenu(e, domain.id)}
                      title="Actions"
                    >
                       <svg width="17" height="3" viewBox="0 0 17 3">
  <circle cx="1.5" cy="1.5" r="1.5" />
  <circle cx="8.5" cy="1.5" r="1.5" />
  <circle cx="15.5" cy="1.5" r="1.5" />
</svg>
                    </button>
                    {contextMenu?.domainId === domain.id && (
                      <div
                        ref={contextMenuRef}
                        className="domain-context-menu"
                        style={{
                          position: "fixed",
                          top: contextMenu.top,
                          left: contextMenu.left,
                        }}
                      >
                        <button
                          className="context-menu-item"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleCopyLicenseKey(domain.licenseKey);
                            setContextMenu(null);
                          }}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <rect
                              width="16"
                              height="16"
                              rx="3"
                              fill="#DEE8F4"
                            />
                            <path
                              d="M9.7333 8.46752V10.1825C9.7333 11.6117 9.16163 12.1834 7.73245 12.1834H6.01745C4.58827 12.1834 4.0166 11.6117 4.0166 10.1825V8.46752C4.0166 7.03834 4.58827 6.46667 6.01745 6.46667H7.73245C9.16163 6.46667 9.7333 7.03834 9.7333 8.46752Z"
                              stroke="#292D32"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                            <path
                              d="M12.1835 6.01751V7.73251C12.1835 9.16169 11.6118 9.73336 10.1826 9.73336H9.73348V8.46752C9.73348 7.03834 9.16181 6.46667 7.73264 6.46667H6.4668V6.01751C6.4668 4.58833 7.03847 4.01666 8.46764 4.01666H10.1826C11.6118 4.01666 12.1835 4.58833 12.1835 6.01751Z"
                              stroke="#292D32"
                              stroke-width="1.5"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </svg>
                          Copy License key
                        </button>
                        {domain.source === 'Direct payment' && domain.subscriptionId && 
                         domain.status !== 'Cancelled' && 
                         domain.status !== 'Expired' && 
                         domain.status !== 'Cancelling' && (
                          <button
                            className="context-menu-item context-menu-item-danger"
                            onClick={() => handleCancelSubscription(domain.subscriptionId, domain.siteName || domain.domain, domain.domain)}
                            disabled={isCancelling}
                          >
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12 4L4 12M4 4L12 12" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            <span>{isCancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
                          </button>
                        )}
                        <button
                        style={{color:"#0A091F80"}}
                          className="context-menu-item context-menu-item-danger"
                          onClick={() => handleDeleteDomain(domain.id)}
                        >
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 16 16"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <g opacity="0.5">
                              <rect
                                width="16"
                                height="16"
                                rx="3"
                                fill="#DEE8F4"
                              />
                              <path
                                d="M11.125 6.74422C10.1537 6.64797 9.17667 6.59839 8.2025 6.59839C7.625 6.59839 7.0475 6.62756 6.47 6.68589L5.875 6.74422"
                                stroke="#505057"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                              <path
                                d="M7.47925 6.44962L7.54341 6.06754C7.59008 5.79046 7.62508 5.58337 8.118 5.58337H8.88216C9.37508 5.58337 9.413 5.80212 9.45675 6.07046L9.52091 6.44962"
                                stroke="#505057"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                              <path
                                d="M10.498 7.66589L10.3084 10.603C10.2764 11.0609 10.2501 11.4167 9.43636 11.4167H7.56386C6.75011 11.4167 6.72386 11.0609 6.69178 10.603L6.5022 7.66589"
                                stroke="#505057"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                              <path
                                d="M8.01294 9.8125H8.98419"
                                stroke="#505057"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                              <path
                                d="M7.77075 8.64587H9.22909"
                                stroke="#505057"
                                stroke-linecap="round"
                                stroke-linejoin="round"
                              />
                            </g>
                          </svg>
                          Delete Domain
                        </button>
                      </div>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
