import { QueryClient } from '@tanstack/react-query';

// Create a query client with optimized defaults for persistent caching
// Data will be cached and reused - only refetch when explicitly invalidated
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data is considered fresh forever (until explicitly invalidated)
      // This means once loaded, it will use cached data and NOT refetch from server
      staleTime: Infinity, // Never consider data stale - use cache forever
      // Keep data in cache for 24 hours (very long cache retention)
      gcTime: 24 * 60 * 60 * 1000, // 24 hours
      // Reduce retries for faster failure feedback
      retry: 1,
      // Disable refetch on window focus - use cached data
      refetchOnWindowFocus: false,
      // Disable refetch on reconnect - use cached data
      refetchOnReconnect: false,
      // Never refetch on mount - always use cached data if available
      refetchOnMount: false,
      // Network mode for faster queries
      networkMode: 'online',
    },
    mutations: {
      // No retries for mutations (fail fast)
      retry: false,
    },
  },
});

