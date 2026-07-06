# Production Migration Plan: Single User Collection Strategy

## Current Problem

Your Meteor backend has **dual user collections** that create sync issues:

```
┌─────────────────────────────────────────────────────────────┐
│  Production (Fastify + Better Auth)                         │
│  └─ Uses: `user` collection (ObjectId or string _id)       │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Meteor Backend (Current)                                   │
│  ├─ `user` collection (Better Auth, ObjectId)              │
│  └─ `users` collection (Meteor Accounts, string ID)        │
│      └─ Created via DDP accounts.createUser in tests       │
└─────────────────────────────────────────────────────────────┘
```

### What Happens Now:
1. When a user logs in via DDP, auth-bridge looks in `users` first, then `user`
2. If found in `user`, it CREATES a duplicate in `users` with the same ID (as string)
3. Different Meteor methods query different collections inconsistently
4. This causes failures like the `tickets.assign` bug we just fixed

## ✅ Recommended Solution: Use Better Auth (`user`) Collection Only

### Why This Approach:

1. **No data migration needed** - Your production users are already in `user` collection
2. **Better Auth is superior** - Modern, secure, supports OAuth, magic links, etc.
3. **Cleaner architecture** - One source of truth for user data
4. **Existing tokens work** - All production JWT tokens continue working

### Migration Steps:

#### Phase 1: Update Meteor to Use `user` Collection (No Production Impact)

**Step 1:** Update `findUserById()` in auth-bridge.js to query `user` first:

```javascript
export async function findUserById(id) {
  // Query Better Auth collection first
  const betterAuthUser = await rawDb().collection('user').findOne({ _id: toId(id) });
  if (betterAuthUser) return {
    _id: typeof betterAuthUser._id === 'string' ? betterAuthUser._id : betterAuthUser._id.toHexString(),
    name: betterAuthUser.name ?? null,
    email: betterAuthUser.email ?? null,
    username: betterAuthUser.username ?? null,
    image: betterAuthUser.image ?? null,
    bio: betterAuthUser.bio ?? '',
    website: betterAuthUser.website ?? '',
    reportsToUserId: betterAuthUser.reportsToUserId ?? null,
  };
  
  // Fallback to Meteor collection for backward compatibility
  const meteorUser = await rawDb().collection('users').findOne({ _id: String(id) });
  if (meteorUser) return {
    _id: meteorUser._id,
    name: meteorUser.profile?.name ?? null,
    email: meteorUser.emails?.[0]?.address ?? null,
    username: meteorUser.username ?? null,
    image: meteorUser.image ?? null,
    bio: meteorUser.bio ?? '',
    website: meteorUser.website ?? '',
    reportsToUserId: meteorUser.reportsToUserId ?? null,
  };
  
  return null;
}
```

**Step 2:** Update all direct `users` queries to use `user`:

Files to update:
- ✅ `tickets.js` - Already fixed (line 229)
- `clock.js` - Line 656
- `huddle.js` - Line 42
- `notifications.js` - Line 113
- `organizations.js` - Lines 137, 487, 517
- `teams.js` - Lines 232, 363
- `timers.js` - Line 229
- `users.js` - Lines 14, 116, 143, 192

**Pattern to follow:**
```javascript
// ❌ Old (Meteor collection)
const user = await rawDb().collection('users').findOne({ _id: String(userId) });

// ✅ New (Better Auth collection)
const user = await rawDb().collection('user').findOne({ _id: toId(userId) });
```

**Step 3:** Stop creating duplicate users in `findOrCreateUser()`:

```javascript
export async function findOrCreateUser(email, name) {
  const db = rawDb();
  const normalizedEmail = email.toLowerCase().trim();

  // Only check Better Auth collection
  const user = await db.collection('user').findOne({ email: normalizedEmail });
  
  if (user) {
    const userId = typeof user._id === 'string' ? user._id : user._id.toHexString();
    console.log('[auth-bridge] found Better Auth user:', userId);
    return userId;
  }

  // Create new user in Better Auth collection only
  const userId = new ObjectId().toHexString();
  await db.collection('user').insertOne({
    _id: userId,
    email: normalizedEmail,
    name: name || normalizedEmail,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  
  console.log('[auth-bridge] created Better Auth user:', userId);
  return userId;
}
```

#### Phase 2: Test Migration Locally

1. **Run all tests** - Ensure 78/78 still pass
2. **Test with production data snapshot** - Load prod MongoDB dump locally
3. **Test existing JWT tokens** - Verify login works with real tokens
4. **Test DDP connections** - Ensure live publications work

#### Phase 3: Deploy to Production

**Pre-deployment checklist:**
- [ ] All tests passing
- [ ] Tested with production data locally
- [ ] Better Auth backend (Fastify or new system) is running
- [ ] JWT tokens are being issued correctly
- [ ] JWKS endpoint is accessible

**Deployment:**
1. Deploy updated Meteor backend (no breaking changes - dual collection support remains)
2. Monitor logs for auth errors
3. Verify users can login
4. Verify live features work (clock, timers, notifications)

#### Phase 4: Clean Up (After Successful Production Run)

**After 1 week of stable production:**
1. Remove Meteor `users` collection support entirely
2. Remove Meteor Accounts package (if not needed)
3. Remove DDP login handlers (keep only PAT support)
4. Drop the `users` collection from MongoDB

## Alternative: Keep Dual Collections (Not Recommended)

If you want to keep both collections:

**Cons:**
- More complex code
- Data sync issues
- ID format inconsistencies
- Higher maintenance burden

**If you choose this, you must:**
1. Always sync writes to both collections
2. Implement proper ID conversion everywhere
3. Handle auth failures from both sources
4. Maintain migration scripts

## Decision Matrix

| Approach | Migration Effort | Risk | Maintenance | Recommended? |
|----------|-----------------|------|-------------|--------------|
| **Use `user` only** | Low (code updates) | Low | Easy | ✅ **YES** |
| Keep dual collections | Medium (sync logic) | High | Hard | ❌ No |
| Migrate to `users` | High (data migration) | Very High | Easy | ❌ No |

## Next Steps

1. **Review this plan** - Make sure you understand the approach
2. **I'll update the code** - Convert all queries to use `user` collection
3. **Run tests** - Verify nothing breaks
4. **Deploy to staging** - Test with production-like data
5. **Deploy to production** - Cutover with monitoring

**Ready to proceed?** I can implement Phase 1 (update all queries to use `user` collection) right now.
