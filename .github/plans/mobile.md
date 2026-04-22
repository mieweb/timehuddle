## Post-Migration: Mobile Path

Once Meteor is removed the codebase is universally portable:

| Target | Additional work |
|---|---|
| **PWA** | Add `manifest.json`, done — `sw.js` already exists |
| **Capacitor** | `npx cap init`, wrap existing React app, ~1 week |
| **Expo (React Native)** | Shared TanStack Query hooks + API layer, new native UI layer |

better-auth supports cookie auth (web) and token auth (mobile) natively — no changes needed
to timecore when adding mobile clients.

---

## Push Notifications

**Effort:** 1 day  
**Goal:** Move VAPID/FCM handling to timecore. The existing `public/sw.js` is already
Meteor-independent and stays as-is.

### timehuddle changes
- [ ] Replace `getVapidPublicKey`, `push.subscribe`, `push.unsubscribe` Meteor methods
- [ ] Remove `imports/server/push.ts`
- [ ] Remove `imports/lib/pushNotificationsClient.ts` Meteor dependency

### timecore changes
- [ ] `GET /v1/push/vapid-key` — return public VAPID key
- [ ] `POST /v1/push/subscribe` — store subscription
- [ ] `DELETE /v1/push/subscribe` — remove subscription
- [ ] Move web-push + FCM sending logic from Meteor into timecore service

---