import { useState, useRef, useEffect } from "react";
import { useAddSite, useRemoveSite } from "../hooks/useDashboardQueries";
import { useNotification } from "../hooks/useNotification";
import "./Sites.css";

// Mock domain data for design
const mockDomains = [
  {
    id: "1",
    domain: "www.Caspian.com",
    source: "Direct payment",
    status: "Active",
    billingPeriod: "Yearly",
    expirationDate: "N/A",
    licenseKey: "KEY-GN5B-PUH8-7NLK",
    created: "12/12/26",
  },
  {
    id: "2",
    domain: "www.Caspianv1.com",
    source: "License Key",
    status: "Active",
    billingPeriod: "Monthly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUH8-7NLK",
    created: "12/12/26",
  },
  {
    id: "3",
    domain: "www.Caspian-test.com",
    source: "Direct payment",
    status: "Active",
    billingPeriod: "Yearly",
    expirationDate: "12/12/26",
    licenseKey: "KEY-GN5B-PUH8-7NLK",
    created: "12/12/26",
  },
];

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

export default function Sites({ sites, userEmail }) {
  const [domains, setDomains] = useState(mockDomains);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [filters, setFilters] = useState({
    source: "",
    status: "",
    billingPeriod: "",
    expirationDate: "",
    created: "",
  });
  const [contextMenu, setContextMenu] = useState(null);
  const contextMenuRef = useRef(null);
  const searchInputRef = useRef(null);
  const { showSuccess, showError } = useNotification();

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

  const handleCopyLicenseKey = (licenseKey) => {
    navigator.clipboard.writeText(licenseKey);
    showSuccess("License key copied to clipboard");
    setContextMenu(null);
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

  const filteredDomains = domains.filter((domain) => {
    // Search filter
    if (
      searchQuery &&
      !domain.domain.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    // Other filters
    if (filters.source && domain.source !== filters.source) return false;
    if (filters.status && domain.status !== filters.status) return false;
    if (filters.billingPeriod && domain.billingPeriod !== filters.billingPeriod)
      return false;
    if (
      filters.expirationDate &&
      domain.expirationDate !== filters.expirationDate
    )
      return false;
    if (filters.created && domain.created !== filters.created) return false;
    return true;
  });

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
        <h1 className="domains-title">Domains</h1>
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
          <option value="License Key">License Key</option>
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
                  <div className="domain-cell-content">{domain.domain}</div>
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
                    <span className="status-tag status-tag-active">
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
                      className="license-key-copy"
                      onClick={() => handleCopyLicenseKey(domain.licenseKey)}
                      title="Copy License Key"
                    >
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
                          onClick={() =>
                            handleCopyLicenseKey(domain.licenseKey)
                          }
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
