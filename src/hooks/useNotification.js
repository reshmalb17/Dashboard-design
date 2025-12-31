import { useState, useCallback } from 'react';

/**
 * Custom hook for managing notifications (success/error messages)
 */
export function useNotification() {
  const [notification, setNotification] = useState(null);

  const showSuccess = useCallback((message, duration = 3000) => {
    setNotification({ type: 'success', message });
    if (duration > 0) {
      setTimeout(() => setNotification(null), duration);
    }
  }, []);

  const showError = useCallback((message, duration = 5000) => {
    setNotification({ type: 'error', message });
    if (duration > 0) {
      setTimeout(() => setNotification(null), duration);
    }
  }, []);

  const clear = useCallback(() => {
    setNotification(null);
  }, []);

  return {
    notification,
    showSuccess,
    showError,
    clear,
  };
}

