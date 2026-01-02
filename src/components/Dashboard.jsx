import { useState, useRef, useEffect } from "react";
import "./Dashboard.css";
import total from '../assets/wff.png';
import webflow from '../assets/webflow.png';
import Framer from '../assets/Framer.png';
import www from '../assets/WWW.png';
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
    id: "1",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "Direct payment",
    status: "Active",
    billingPeriod: "Yearly",
    expirationDate: "N/A",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "2",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "License Key",
    status: "Active",
    billingPeriod: "Monthly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "3",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "Direct payment",
    status: "Cancelled",
    billingPeriod: "Yearly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "4",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "License Key",
    status: "Cancelling",
    billingPeriod: "Monthly",
    expirationDate: "N/A",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "5",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "Direct payment",
    status: "Expired",
    billingPeriod: "Yearly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "6",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "License Key",
    status: "Active",
    billingPeriod: "Monthly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
  {
    id: "7",
    domain: "www.consentbit-test-dashboard.com/",
    active: true,
    source: "Direct payment",
    status: "Active",
    billingPeriod: "Yearly",
    expirationDate: "N/A",
    licenseKey: "KEY-GN5B-PUHB-7NLK",
    created: "12/12/26",
  },
];

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

export default function Dashboard() {
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
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
    if (e.target.value === "") {
      // Keep expanded if there's text, collapse when empty
    }
  };

  const handleSearchBlur = () => {
    if (searchQuery === "") {
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
        <div className="stat-card total-domains">
          <div className="stat-label">Total Domains</div>
          <div className="stat-value" style={{ fontSize:"80px",fontWeight:"200" }}>{mockDashboardStats.totalDomains}</div>
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
              {mockDashboardStats.webflow.count}
            </span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{mockDashboardStats.webflow.total}
            </span>
          </div>
          <div className="stat-background-icon webflow-bg"><img src={webflow} alt="webflow" /></div>
        </div>

        <div className="stat-card license-card">
          <div className="stat-label">Activated license keys</div>
          <div className="stat-value" style={{color:"#5C577D"}}>
            {mockDashboardStats.activatedLicenseKeys}
          </div>
                   <div className="stat-background-icon webflow-bg"><img style={{width:"auto"}} src={www} alt="webflow" /></div>

        </div>
        <div className="stat-card framer-card">
          <div className="stat-label">Framer</div>
          <div className="stat-value">
            <span >
              {mockDashboardStats.framer.count}
            </span>
            <span style={{ fontWeight: 400, color: "#5C577D" }}>
              /{mockDashboardStats.framer.total}
            </span>
          </div>
          <div className="stat-background-icon framer-bg"><img src={Framer} alt="framer" /></div>
        </div>
        <div className="stat-card not-assigned-card">
          <div className="stat-label"><span>Not assigned </span>license keys</div>
          <div className="stat-value not-assigned-value" style={{color:"#5C577D"}}>
            {mockDashboardStats.notAssignedLicenseKeys}
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
              {mockRecentDomains.map((domain) => (
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
}
