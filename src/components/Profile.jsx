import { useState } from 'react';
import { useMemberstack } from '../hooks/useMemberstack';
import { logout } from '../services/memberstack';
import { useNotification } from '../hooks/useNotification';
import './Profile.css';
import profileImg from '../assets/profileImg.png'

export default function Profile() {
  const { userEmail, member } = useMemberstack();
  const { showSuccess, showError } = useNotification();
  const [isDeleting, setIsDeleting] = useState(false);

  // Get user name from member data or use email as fallback
  const userName = member?.name || member?.data?.name || 'User';
  const displayEmail = userEmail || 'Email@example.com';
  const paymentId = member?.payment_id || member?.data?.payment_id || 'Payment ID';

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
        {/* <div className="profile-header">
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
        </div> */}

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
            <div className="profile-detail-row">
              <span className="profile-detail-label">payment ID:</span>
              <span className="profile-detail-value">{paymentId}</span>
            </div>
          </div>
        </div>

        <div className="profile-actions">
          <button
            className="profile-logout-btn"
            onClick={handleLogout}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M8.90002 7.56023C9.21002 3.96023 11.06 2.49023 15.11 2.49023H15.24C19.71 2.49023 21.5 4.28023 21.5 8.75023V15.2702C21.5 19.7402 19.71 21.5302 15.24 21.5302H15.11C11.09 21.5302 9.24002 20.0802 8.91002 16.5402" stroke="#262E84" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M15 12H3.62" stroke="#262E84" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M5.85 8.6499L2.5 11.9999L5.85 15.3499" stroke="#262E84" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>

            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}

