import { Navigate } from 'react-router-dom';
import { useMemberstack } from '../hooks/useMemberstack';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, userEmail, loading: authLoading } = useMemberstack();

  // Show loading state while checking authentication
  if (authLoading) {
    return null;
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated || !userEmail) {
    return <Navigate to="/" replace />;
  }

  // Render protected content if authenticated
  return children;
}
