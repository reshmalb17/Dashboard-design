# TanStack Query (React Query) Setup

This project uses **TanStack Query** (formerly React Query) for state management, data fetching, and caching.

## Why TanStack Query?

✅ **Automatic Caching** - Data is cached and reused across components  
✅ **Background Refetching** - Keeps data fresh automatically  
✅ **Optimistic Updates** - UI updates immediately, rolls back on error  
✅ **Request Deduplication** - Multiple components requesting same data = one API call  
✅ **Loading & Error States** - Built-in state management  
✅ **DevTools** - Visual debugging of queries and cache  

## Architecture

### Query Client Configuration

Located in `src/lib/queryClient.js`:

- **Stale Time**: 30 seconds (data considered fresh)
- **Cache Time**: 5 minutes (data kept in memory)
- **Retry**: 2 attempts for queries, 1 for mutations
- **Auto Refetch**: On window focus and reconnect

### Query Hooks

Located in `src/hooks/useDashboardQueries.js`:

#### `useDashboardData(userEmail, options)`
Fetches dashboard data (sites, subscriptions, etc.)

```jsx
const { data, isLoading, error } = useDashboardData(userEmail);
```

#### `useLicenses(userEmail, options)`
Fetches user license keys

```jsx
const { data, isLoading, error } = useLicenses(userEmail);
```

#### `useAddSite(userEmail)`
Mutation hook for adding a site (with optimistic updates)

```jsx
const addSite = useAddSite(userEmail);
addSite.mutate({ site: 'example.com', price: 'price_123' });
```

#### `useRemoveSite(userEmail)`
Mutation hook for removing a site (with optimistic updates)

```jsx
const removeSite = useRemoveSite(userEmail);
removeSite.mutate({ site: 'example.com' });
```

#### `useRefreshDashboard(userEmail)`
Hook to manually refresh all dashboard data

```jsx
const refresh = useRefreshDashboard(userEmail);
refresh(); // Invalidates and refetches all queries
```

## Features

### 1. Optimistic Updates

When adding/removing sites, the UI updates immediately:

```jsx
// In useAddSite mutation
onMutate: async ({ site, price }) => {
  // Cancel outgoing refetches
  await queryClient.cancelQueries({ queryKey: queryKeys.dashboard(userEmail) });
  
  // Optimistically update cache
  queryClient.setQueryData(queryKeys.dashboard(userEmail), (old) => ({
    ...old,
    sites: { ...old.sites, [site]: { status: 'pending', ... } }
  }));
}
```

If the API call fails, the optimistic update is automatically rolled back.

### 2. Automatic Cache Invalidation

After mutations succeed, related queries are automatically invalidated and refetched:

```jsx
onSuccess: () => {
  queryClient.invalidateQueries({ queryKey: queryKeys.dashboard(userEmail) });
}
```

### 3. Request Deduplication

If multiple components request the same data simultaneously, TanStack Query deduplicates the requests:

```jsx
// Component A
const { data } = useDashboardData(userEmail);

// Component B (same userEmail)
const { data } = useDashboardData(userEmail);

// Only ONE API call is made!
```

### 4. Smart Refetching

Queries automatically refetch when:
- Window regains focus
- Network reconnects
- Data becomes stale (after 30 seconds)
- Related mutations complete

## Usage Examples

### Basic Query

```jsx
import { useDashboardData } from '../hooks/useDashboardQueries';

function MyComponent({ userEmail }) {
  const { data, isLoading, error } = useDashboardData(userEmail);
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  
  return <div>{/* Render data.sites, etc. */}</div>;
}
```

### Mutation with Optimistic Updates

```jsx
import { useAddSite } from '../hooks/useDashboardQueries';

function AddSiteForm({ userEmail }) {
  const addSite = useAddSite(userEmail);
  
  const handleSubmit = () => {
    addSite.mutate(
      { site: 'example.com', price: 'price_123' },
      {
        onSuccess: () => {
          console.log('Site added!');
        },
        onError: (error) => {
          console.error('Failed:', error);
        }
      }
    );
  };
  
  return (
    <button 
      onClick={handleSubmit}
      disabled={addSite.isPending}
    >
      {addSite.isPending ? 'Adding...' : 'Add Site'}
    </button>
  );
}
```

### Manual Refresh

```jsx
import { useRefreshDashboard } from '../hooks/useDashboardQueries';

function RefreshButton({ userEmail }) {
  const refresh = useRefreshDashboard(userEmail);
  
  return <button onClick={refresh}>Refresh Data</button>;
}
```

## DevTools

React Query DevTools are automatically included in development mode:

- Press the floating button (bottom-left) to open
- View all queries, mutations, and cache state
- Manually invalidate queries
- See query status and timings

## Query Keys

Query keys are centralized in `useDashboardQueries.js`:

```jsx
export const queryKeys = {
  dashboard: (email) => ['dashboard', email],
  licenses: (email) => ['licenses', email],
};
```

This ensures consistent key structure across the app.

## Best Practices

1. **Use query keys consistently** - Always use the exported `queryKeys` object
2. **Enable queries conditionally** - Use `enabled` option to prevent unnecessary requests
3. **Handle loading/error states** - Always check `isLoading` and `error`
4. **Use optimistic updates** - Provide instant feedback to users
5. **Invalidate related queries** - After mutations, invalidate affected queries

## Migration from Context API

The previous Context API implementation has been replaced with TanStack Query for:

- Better performance (caching, deduplication)
- Less boilerplate code
- Built-in loading/error states
- Automatic background refetching
- Optimistic updates with rollback

