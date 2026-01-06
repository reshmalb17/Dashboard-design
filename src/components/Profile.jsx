import { useState } from 'react';
import { useMemberstack } from '../hooks/useMemberstack';
import { logout } from '../services/memberstack';
import { useNotification } from '../hooks/useNotification';
import './Profile.css';
import profileImg from '../assets/profileImg.png'

export default function Profile() {
  // All hooks must be called before any conditional returns (Rules of Hooks)
  const { userEmail } = useMemberstack(); // Get email from login
  const { showSuccess, showError } = useNotification();
  const [isDeleting, setIsDeleting] = useState(false);

  // Extract user details from email (available after login)
  const userName = userEmail ? userEmail.split('@')[0] : 'User';
  const displayEmail = userEmail || 'N/A';

  // If we have no email, show error
  if (!userEmail) {
    return (
      <div className="profile-container">
        <div className="profile-card">
          <div className="profile-content">
            <div className="error" style={{ padding: '40px', textAlign: 'center', color: '#f44336' }}>
              Unable to load profile data. Please log in again.
            </div>
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

        <div className="profile-actions">
          <button
            className="profile-logout-btn"
            onClick={handleLogout}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8.90002 7.56023C9.21002 3.96023 11.06 2.49023 15.11 2.49023H15.24C19.71 2.49023 21.5 4.28023 21.5 8.75023V15.2702C21.5 19.7402 19.71 21.5302 15.24 21.5302H15.11C11.09 21.5302 9.24002 20.0802 8.91002 16.5402" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M15 12H3.62" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M5.85 8.6499L2.5 11.9999L5.85 15.3499" stroke="#262E84" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}
