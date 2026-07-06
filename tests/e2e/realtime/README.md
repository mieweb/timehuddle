# Real-Time Synchronization Tests

This directory contains E2E tests that verify real-time synchronization across multiple browser sessions using Meteor DDP (Distributed Data Protocol).

## Test Coverage

### ✅ Ticket Timers (`ticket-timers.spec.ts`)

- Timer start synchronization
- Timer stop synchronization
- Timer switching between tickets
- Automatic timer state updates

### ✅ Work Page Timers (`work-page-timers.spec.ts`)

- Work item timer start/stop sync
- Work item creation sync
- Timer duration updates

### ✅ Timesheet (`timesheet.spec.ts`)

- Personal timesheet clock-in/out sync
- Team admin timesheet updates
- Session edit synchronization
- Session deletion sync

### ✅ Team Members (`team-members.spec.ts`)

- Team member list updates
- Member role changes
- Team selection sync

### ✅ Organization Members (`organization-members.spec.ts`)

- Member count sync
- Role change synchronization
- Blocked status sync

### ✅ Media Library (`media-library.spec.ts`)

- Media item count sync
- Upload notifications
- Item visibility updates

### ✅ Huddle Posts (`huddle-posts.spec.ts`)

- New post synchronization
- Post count consistency
- Comment updates

### ✅ Messages (`messages.spec.ts`)

- Thread list sync
- New message delivery
- Real-time chat updates

### ✅ Notifications (`notifications.spec.ts`)

- Notification count sync
- Badge updates
- Read/unread status sync

## How It Works

Each test:

1. Opens two separate browser contexts (simulating two users/tabs)
2. Logs in as the same user in both sessions
3. Navigates to the feature page
4. Performs an action in session 1 (start timer, send message, etc.)
5. Verifies the change appears automatically in session 2 within 3 seconds

## Running the Tests

```bash
# Run all real-time tests
npm run test:e2e -- tests/e2e/realtime/

# Run specific feature tests
npm run test:e2e -- tests/e2e/realtime/ticket-timers.spec.ts
npm run test:e2e -- tests/e2e/realtime/messages.spec.ts

# Run in headed mode (see the browser)
npm run test:e2e:headed -- tests/e2e/realtime/

# Run with debug output
npm run test:e2e -- tests/e2e/realtime/ --debug
```

## Architecture

All real-time updates are powered by:

- **Meteor DDP**: WebSocket-based pub/sub protocol
- **MongoDB Oplog Tailing**: Automatic change detection
- **React Subscriptions**: `useEffect` hooks with `ddp.onCollectionChange()`

When any write occurs (Meteor method, Fastify REST API, or direct MongoDB write), the change is automatically broadcast to all subscribed sessions without any explicit broadcast code.

## Success Criteria

✅ All tests should pass consistently  
✅ Real-time updates should appear within 3 seconds  
✅ No manual page refresh required  
✅ Works across multiple browser tabs/windows  
✅ Survives network reconnection

## Troubleshooting

If tests fail:

1. Ensure both backends are running (`pm2 list`)
2. Check MongoDB replica set is active (`rs.status()`)
3. Verify DDP WebSocket connection in browser console
4. Check Meteor logs: `pm2 logs timehuddle-meteor`
5. Increase timeout if on slow network (edit `timeout` values in tests)

## Future Enhancements

- [ ] Test reconnection after network interruption
- [ ] Test subscription cleanup on page unmount
- [ ] Test multi-user scenarios (different users)
- [ ] Test conflict resolution
- [ ] Performance testing with many concurrent sessions
