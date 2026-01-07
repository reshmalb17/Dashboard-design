import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { logout } from '../services/memberstack';
import { useNotification } from '../hooks/useNotification';
import { getInvoices } from '../services/api';
import { queryKeys } from '../hooks/useDashboardQueries';
import './Profile.css';
import profileImg from '../assets/profileImg.png'

export default function Profile({ 
  userEmail,
  invoices = [],
  invoicesLoading = false,
  invoicesError = null,
  hasMoreInvoices = false,
  totalInvoices = 0
}) {
  const { showSuccess, showError } = useNotification();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadedInvoices, setLoadedInvoices] = useState(invoices);
  const [hasMore, setHasMore] = useState(hasMoreInvoices);
  const INVOICES_PER_PAGE = 10;

  // Update local state when invoices prop changes (from TanStack Query)
  // This ensures new invoices from refetch are displayed
  useEffect(() => {
    if (invoices && invoices.length > 0) {
      // Merge new invoices with existing ones, avoiding duplicates
      setLoadedInvoices(prevInvoices => {
        const existingIds = new Set(prevInvoices.map(inv => inv.id));
        const newInvoices = invoices.filter(inv => !existingIds.has(inv.id));
        
        if (newInvoices.length > 0) {
          // New invoices found, merge and sort
          const merged = [...newInvoices, ...prevInvoices];
          return merged.sort((a, b) => b.created - a.created);
        }
        
        // No new invoices, but update if invoices prop changed (e.g., after refetch)
        return invoices;
      });
    } else if (invoices.length === 0 && loadedInvoices.length === 0) {
      // Initial load, set invoices
      setLoadedInvoices(invoices);
    }
    
    setHasMore(hasMoreInvoices);
  }, [invoices, hasMoreInvoices]);

  // Load more invoices using TanStack Query
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const offset = loadedInvoices.length;
      // Fetch using TanStack Query's fetchQuery for caching
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.invoices(userEmail, INVOICES_PER_PAGE, offset),
        queryFn: async () => {
          return await getInvoices(userEmail, INVOICES_PER_PAGE, offset);
        },
      });
      
      if (data.invoices && data.invoices.length > 0) {
        // Merge and sort by created date (most recent first)
        const merged = [...loadedInvoices, ...data.invoices];
        setLoadedInvoices(merged.sort((a, b) => b.created - a.created));
        setHasMore(data.hasMore || false);
      } else {
        setHasMore(false);
      }
    } catch (error) {
      console.error('[Profile] Error loading more invoices:', error);
      showError('Failed to load more invoices. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  };

  // Extract user details from email (available after login)
  const userNameRaw = userEmail ? userEmail.split('@')[0] : 'User';
  const userName = userNameRaw ? userNameRaw.charAt(0).toUpperCase() + userNameRaw.slice(1).toLowerCase() : 'User';
  const displayEmail = userEmail || 'N/A';

  // Format currency amount
  const formatAmount = (amount, currency = 'usd') => {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
    });
    return formatter.format(amount / 100); // Stripe amounts are in cents
  };

  // Format date
  const formatDate = (timestamp) => {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp * 1000); // Stripe timestamps are in seconds
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  // Handle invoice download
  const handleDownloadInvoice = (invoicePdfUrl) => {
    if (invoicePdfUrl) {
      window.open(invoicePdfUrl, '_blank');
    } else {
      showError('Invoice PDF not available');
    }
  };

  // If we have no email, show error
  if (!userEmail) {
    return (
      <div className="profile-container">
        <div className="profile-card">
          <div className="profile-content">
            {/* <div className="error" style={{ padding: '40px', textAlign: 'center', color: '#f44336' }}> */}
              Loading...
            {/* </div> */}
          </div>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    try {
      await logout();
      showSuccess('Logged out successfully');
      window.location.href = '/';
    } catch (error) {
      console.error('[Profile] Logout error:', error);
      showError('Failed to logout');
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to delete your account? This action cannot be undone.'
    );
    
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      // Here you would typically make an API call to delete the account
      showError('Delete account functionality not yet implemented');
      setIsDeleting(false);
    } catch (error) {
      console.error('[Profile] Delete account error:', error);
      showError('Failed to delete account');
      setIsDeleting(false);
    }
  };

  return (
    <div className="profile-container">
      <div className="profile-card">
        {/* Header with Logout Button */}
        <div className="profile-header">
          <div className="profile-header-spacer"></div>
          <button
            type="button"
            className="profile-logout-btn"
            onClick={handleLogout}
            aria-label="Logout from account"
            title="Logout"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M8.90002 7.56023C9.21002 3.96023 11.06 2.49023 15.11 2.49023H15.24C19.71 2.49023 21.5 4.28023 21.5 8.75023V15.2702C21.5 19.7402 19.71 21.5302 15.24 21.5302H15.11C11.09 21.5302 9.24002 20.0802 8.91002 16.5402" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 12H3.62" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.85 8.6499L2.5 11.9999L5.85 15.3499" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Logout</span>
          </button>
        </div>

        <div className="profile-content">
          <div className="profile-avatar">
            <img src={profileImg} alt="Profile" />
          </div>

          <div className="profile-details">
            <div className="profile-detail-row">
              <span className="profile-detail-label">Name:</span>
              <span className="profile-detail-value">{userName}</span>
            </div>
            <div className="profile-detail-row">
              <span className="profile-detail-label">Email Id:</span>
              <span className="profile-detail-value">{displayEmail}</span>
            </div>
            {/* <div className="profile-detail-row">
              <span className="profile-detail-label">payment ID:</span>
              <span className="profile-detail-value">{paymentId}</span>
            </div> */}
          </div>
        </div>

        {/* Invoices Section */}
        <div className="profile-invoices-section">
          <h3 className="profile-invoices-title">
            Invoice History
            {totalInvoices > 0 && (
              <span className="profile-invoices-count"> ({totalInvoices})</span>
            )}
          </h3>
          {invoicesLoading ? (
            <div className="profile-invoices-loading">Loading invoices...</div>
          ) : invoicesError ? (
            <div className="profile-invoices-error">Failed to load invoices. Please try again later.</div>
          ) : loadedInvoices.length === 0 ? (
            <div className="profile-invoices-empty">No invoices found.</div>
          ) : (
            <>
              <div className="profile-invoices-list">
                {loadedInvoices.map((invoice) => (
                <div key={invoice.id} className="profile-invoice-item">
                  <div className="profile-invoice-info">
                    <div className="profile-invoice-header">
                      <span className="profile-invoice-number">
                        {invoice.number || `Invoice ${invoice.id.slice(-8)}`}
                      </span>
                      <span className="profile-invoice-amount">
                        {formatAmount(invoice.amount_paid, invoice.currency)}
                      </span>
                    </div>
                    <div className="profile-invoice-meta">
                      <span className="profile-invoice-date">{formatDate(invoice.created)}</span>
                      {invoice.description && (
                        <span className="profile-invoice-description">{invoice.description}</span>
                      )}
                    </div>
                  </div>
                  <div className="profile-invoice-actions">
                    {invoice.invoice_pdf && (
                      <button
                        className="profile-invoice-download-btn"
                        onClick={() => handleDownloadInvoice(invoice.invoice_pdf)}
                        title="Download PDF"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M21 15V19C21 19.5304 20.7893 20.0391 20.4142 20.4142C20.0391 20.7893 19.5304 21 19 21H5C4.46957 21 3.96086 20.7893 3.58579 20.4142C3.21071 20.0391 3 19.5304 3 19V15" stroke="#262E84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M7 10L12 15L17 10" stroke="#262E84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          <path d="M12 15V3" stroke="#262E84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
                ))}
              </div>
              {hasMore && (
                <div className="profile-invoices-load-more">
                  <button
                    className="profile-load-more-btn"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <span className="loading-spinner"></span>
                        <span>Loading...</span>
                      </>
                    ) : (
                      <>
                        <span>Load More</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M5 10L12 17L19 10" stroke="#262E84" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
