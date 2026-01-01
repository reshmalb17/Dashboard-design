import { useState } from 'react';
import { useMemberstack } from '../hooks/useMemberstack';
import { logout } from '../services/memberstack';
import { useNotification } from '../hooks/useNotification';
import './Profile.css';

export default function Profile() {
  const { userEmail, member } = useMemberstack();
  const { showSuccess, showError } = useNotification();
  const [isDeleting, setIsDeleting] = useState(false);

  // Extract user details from member object - check multiple possible locations
  const getUserName = () => {
    if (!member) return 'User';
    return member.name || 
           member.data?.name || 
           member.data?.user?.name ||
           member.data?.auth?.user?.name ||
           member.firstName || 
           member.data?.firstName ||
           userEmail?.split('@')[0] || 
           'User';
  };

  const getDisplayEmail = () => {
    return userEmail || 
           member?.email || 
           member?.data?.email ||
           member?.data?.auth?.email ||
           'Email@example.com';
  };

  const getPaymentId = () => {
    if (!member) return 'N/A';
    return member.payment_id || 
           member.data?.payment_id ||
           member.stripe_customer_id ||
           member.data?.stripe_customer_id ||
           member.customer_id ||
           member.data?.customer_id ||
           'N/A';
  };

  const getUserDetails = () => {
    if (!member) return {};
    
    // Extract all available user details
    const memberData = member.data || member;
    
    return {
      id: member.id || member._id || memberData?.id || 'N/A',
      name: getUserName(),
      email: getDisplayEmail(),
      paymentId: getPaymentId(),
      createdAt: member.created_at || memberData?.created_at || memberData?.createdAt || null,
      plan: member.plan || memberData?.plan || memberData?.subscription?.plan || 'N/A',
      status: member.status || memberData?.status || 'Active',
    };
  };

  const userDetails = getUserDetails();
  const userName = userDetails.name;
  const displayEmail = userDetails.email;
  const paymentId = userDetails.paymentId;

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
        <div className="profile-header">
          <h1 className="profile-title">Profile</h1>
          <button
            className="profile-delete-btn"
            onClick={handleDeleteAccount}
            disabled={isDeleting}
            title="Delete Account"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 4H14M12.6667 4V13.3333C12.6667 14 12 14.6667 11.3333 14.6667H4.66667C4 14.6667 3.33333 14 3.33333 13.3333V4M5.33333 4V2.66667C5.33333 2 6 1.33333 6.66667 1.33333H9.33333C10 1.33333 10.6667 2 10.6667 2.66667V4" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6.66667 7.33333V11.3333M9.33333 7.33333V11.3333" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span>Delete Account</span>
          </button>
        </div>

        <div className="profile-content">
          <div className="profile-avatar">
            <svg width="80" height="80" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="40" cy="40" r="40" fill="#E5E7EB"/>
              <circle cx="40" cy="32" r="12" fill="#9CA3AF"/>
              <path d="M20 60C20 50 28 42 40 42C52 42 60 50 60 60" fill="#9CA3AF"/>
            </svg>
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
            {userDetails.plan && userDetails.plan !== 'N/A' && (
              <div className="profile-detail-row">
                <span className="profile-detail-label">Plan:</span>
                <span className="profile-detail-value">{userDetails.plan}</span>
              </div>
            )}
            {userDetails.createdAt && (
              <div className="profile-detail-row">
                <span className="profile-detail-label">Member Since:</span>
                <span className="profile-detail-value">
                  {(() => {
                    try {
                      const timestamp = typeof userDetails.createdAt === 'number' 
                        ? userDetails.createdAt 
                        : parseInt(userDetails.createdAt);
                      const dateInMs = timestamp < 1e12 ? timestamp * 1000 : timestamp;
                      return new Date(dateInMs).toLocaleDateString();
                    } catch (e) {
                      return 'N/A';
                    }
                  })()}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="profile-actions">
          <button
            className="profile-logout-btn"
            onClick={handleLogout}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6 14H3C2.44772 14 2 13.5523 2 13V3C2 2.44772 2.44772 2 3 2H6" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M10 11L13 8L10 5" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M13 8H6" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}

