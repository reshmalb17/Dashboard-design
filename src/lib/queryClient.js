import { QueryClient } from '@tanstack/react-query';

// Create a query client with optimized defaults for fast loading
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes (longer cache = less refetching)
      staleTime: 300000,
      // Keep data in cache for 10 minutes
      gcTime: 600000,
      // Reduce retries for faster failure feedback
      retry: 1,
      // Disable refetch on window focus for faster UX
      refetchOnWindowFocus: false,
      // Keep refetch on reconnect
      refetchOnReconnect: true,
      // Network mode for faster queries
      networkMode: 'online',
    },
    mutations: {
      // No retries for mutations (fail fast)
      retry: false,
    },
  },
});

