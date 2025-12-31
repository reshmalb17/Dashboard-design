import { useState, useRef, useEffect } from 'react';
import './Dashboard.css';

// Mock data for dashboard
const mockDashboardStats = {
  totalDomains: 34,
  webflow: { count: 14, total: 34 },
  framer: { count: 14, total: 34 },
  activatedLicenseKeys: 14,
  notAssignedLicenseKeys: 6,
};

// Mock recent domains data
const mockRecentDomains = [
  {
    id: '1',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'Direct payment',
    status: 'Active',
    billingPeriod: 'Yearly',
    expirationDate: 'N/A',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '2',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'License Key',
    status: 'Active',
    billingPeriod: 'Monthly',
    expirationDate: '12/12/26',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '3',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'Direct payment',
    status: 'Cancelled',
    billingPeriod: 'Yearly',
    expirationDate: '12/12/26',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '4',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'License Key',
    status: 'Cancelling',
    billingPeriod: 'Monthly',
    expirationDate: 'N/A',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '5',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'Direct payment',
    status: 'Expired',
    billingPeriod: 'Yearly',
    expirationDate: '12/12/26',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '6',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'License Key',
    status: 'Active',
    billingPeriod: 'Monthly',
    expirationDate: '12/12/26',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
  {
    id: '7',
    domain: 'www.consentbit-test-dashboard.com/',
    active: true,
    source: 'Direct payment',
    status: 'Active',
    billingPeriod: 'Yearly',
    expirationDate: 'N/A',
    licenseKey: 'KEY-GN5B-PUHB-7NLK',
    created: '12/12/26',
  },
];

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

export default function Dashboard() {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);

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

  const handleCopyLicenseKey = (licenseKey) => {
    navigator.clipboard.writeText(licenseKey);
    // You can add a toast notification here
  };

  return (
    <div className="dashboard-section">
      {/* Summary Statistics */}
      <div className="dashboard-stats">
        <div className="stat-card">
          <div className="stat-label">Total Domains</div>
          <div className="stat-value">{mockDashboardStats.totalDomains}</div>
          <div className="stat-icons">
            <div className="stat-icon webflow-icon">W</div>
            <span className="stat-icon-separator">+</span>
            <div className="stat-icon generic-icon"></div>
          </div>
        </div>

        <div className="stat-card webflow-card">
          <div className="stat-label">Webflow</div>
          <div className="stat-value">
            <span style={{ fontWeight: 700 }}>{mockDashboardStats.webflow.count}</span>
            <span style={{ fontWeight: 400, color: '#999' }}>/{mockDashboardStats.webflow.total}</span>
          </div>
          <div className="stat-background-icon webflow-bg">W</div>
        </div>

        <div className="stat-card framer-card">
          <div className="stat-label">Framer</div>
          <div className="stat-value">
            <span style={{ fontWeight: 700 }}>{mockDashboardStats.framer.count}</span>
            <span style={{ fontWeight: 400, color: '#999' }}>/{mockDashboardStats.framer.total}</span>
          </div>
          <div className="stat-background-icon framer-bg">F</div>
        </div>

        <div className="stat-card license-card">
          <div className="stat-label">Activated license keys</div>
          <div className="stat-value">{mockDashboardStats.activatedLicenseKeys}</div>
          <div className="stat-background-icon globe-bg">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="40" r="30" stroke="currentColor" strokeWidth="2" opacity="0.15"/>
              <text x="40" y="48" textAnchor="middle" fontSize="24" fill="currentColor" opacity="0.15" fontWeight="600">www</text>
            </svg>
          </div>
        </div>

        <div className="stat-card not-assigned-card">
          <div className="stat-label">Not assigned license keys</div>
          <div className="stat-value not-assigned-value">{mockDashboardStats.notAssignedLicenseKeys}</div>
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
              {mockRecentDomains.map((domain) => (
                <tr key={domain.id}>
                  <td>
                    <div className={`active-indicator ${domain.active ? 'active' : 'inactive'}`}></div>
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
                        title="Copy license key"
                      >
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5.5 2H3.5C2.67157 2 2 2.67157 2 3.5V12.5C2 13.3284 2.67157 14 3.5 14H9.5C10.3284 14 11 13.3284 11 12.5V10.5M5.5 2C5.5 2.27614 5.72386 2.5 6 2.5H9.5M5.5 2V5.5C5.5 5.77614 5.72386 6 6 6H9.5M9.5 2.5V6H13M9.5 2.5L13 6M9.5 10.5H13M13 10.5V13.5M13 10.5H9.5M13 13.5H9.5M13 13.5V10.5" stroke="#666" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
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
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

