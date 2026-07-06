# First-Time User Onboarding Navigation Fix

## Problem

When a new user completed the initial setup (clicked "Complete Setup" in InstallerModal), they would stay on the dashboard page instead of automatically navigating to `/app/enterprise` where they could create their first organization.

## Root Cause

The `InstallerModal` component was rendered **outside** the `RouterContext.Provider` in the component tree:

```tsx
// main.tsx
return (
  <>
    <AppLayout />  {/* RouterContext.Provider is INSIDE AppLayout */}
    {showTakeOwnershipModal && (
      <InstallerModal />  {/* ❌ Outside RouterContext - can't use useRouter() */}
    )}
  </>
);
```

Since `RouterContext` is defined inside `AppLayout`, the `InstallerModal` couldn't access the `navigate()` function from `useRouter()`.

## Solution

Modified `InstallerModal.tsx` to use direct DOM navigation that triggers the same mechanism as `AppLayout`'s `navigate()` function:

```typescript
// After takeOwnership completes and contexts refresh:
window.history.pushState(null, '', '/app/enterprise');
window.dispatchEvent(new PopStateEvent('popstate')); // Triggers AppLayout's listener
window.dispatchEvent(
  new CustomEvent('timehuddle:navigate', {
    detail: { path: '/app/enterprise' },
  }),
);
```

This approach:

1. Updates the browser URL
2. Triggers `AppLayout`'s `popstate` listener to update its internal `pathname` state
3. Dispatches the custom navigation event for any other listeners

## Changes Made

### 1. InstallerModal.tsx

- Removed `import { useRouter } from './router'`
- Removed `const { navigate } = useRouter()` (wasn't working anyway)
- Added direct DOM navigation using `pushState` + `PopStateEvent`
- Added 200ms delay after refetch to allow context propagation

### 2. main.tsx

- Removed `shouldNavigateToEnterprise` state
- Removed navigation `useEffect` that was in the wrong component
- Simplified `InstallerModal` props: `onTaken()` instead of `onTaken(shouldNavigate: boolean)`

### 3. TeamContext.tsx

- Made `refetchEnterprises()` and `refetchOrganizations()` return promises
- Allows `InstallerModal` to properly await data refresh before navigating

## Testing

Created E2E test in `tests/e2e/onboarding/first-user-setup.spec.ts`:

✅ Test verifies:

- User can sign up
- Username claim modal appears and works
- Installer modal appears
- Clicking "Complete Setup" automatically navigates to `/app/enterprise`
- Enterprise page loads with "Organizations" section visible

```bash
# Run the test
npm run test:e2e tests/e2e/onboarding/first-user-setup.spec.ts
```

## Known Issue: Enterprise Data Loading

**Status**: The navigation works, but there's a separate data loading issue.

**Symptom**: After navigating to `/app/enterprise`, the page shows "No enterprise is available for your account yet" even though `takeOwnership()` created one.

**Impact**: User can't create their first organization without refreshing the page.

**Root Cause**: The `enterprises.list` Meteor method queries for enterprises where the current user is an owner, but there may be a user ID mismatch or timing issue preventing the query from returning the newly created enterprise.

**Workaround**: Page refresh loads the enterprise correctly.

**Next Steps**:

1. Debug why `enterprises.list` isn't returning the enterprise immediately after `takeOwnership`
2. Check if there's a session/user ID synchronization issue between Better Auth and Meteor accounts
3. Consider adding automatic retry or refetch mechanism on the enterprise page

## Related Files

- `src/ui/InstallerModal.tsx` - Modal with navigation fix
- `src/main.tsx` - App root with modal rendering
- `src/ui/router.ts` - Router context definition
- `src/ui/AppLayout.tsx` - Router context provider
- `src/lib/TeamContext.tsx` - Enterprise/org data management
- `tests/e2e/onboarding/first-user-setup.spec.ts` - E2E test
