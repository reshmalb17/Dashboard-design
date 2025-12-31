import './Notification.css';

export default function Notification({ notification, onClose }) {
  if (!notification) return null;

  return (
    <div
      className={`notification notification-${notification.type}`}
      onClick={onClose}
    >
      {notification.message}
    </div>
  );
}

