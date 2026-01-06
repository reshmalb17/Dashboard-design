import './Sidebar.css';
import { logout } from '../services/memberstack';

export default function Sidebar({ activeSection, onSectionChange, userEmail, isOpen = false }) {
  const handleLogout = async () => {
    try {
      // Show loading state (optional - you can add a loading indicator)
      console.log('[Sidebar] Logging out...');
      
      // Call logout function which handles Memberstack session logout and cleanup
      await logout();
      
      // Note: logout() will redirect to home page, so code below won't execute
      // But we keep it for error handling
    } catch (error) {
      console.error('[Sidebar] Logout error:', error);
      // Even if logout fails, try to redirect
      window.location.href = '/';
    }
  };
  const sections = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'domains', label: 'Domains' },
    { id: 'licenses', label: 'Bulk Purchase' },
    { id: 'profile', label: 'Profile' },
  ];

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <nav className="sidebar-nav">
        {sections.map((section) => (
          <button
            key={section.id}
            className={`sidebar-item ${activeSection === section.id ? 'active' : ''}`}
            onClick={() => onSectionChange(section.id)}
          >
            <span className="sidebar-label">{section.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}

