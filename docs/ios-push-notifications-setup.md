# iOS Push Notifications Setup Guide

## Common Issues and Solutions

### Issue: Registration Timeout

If you see "Registration timed out after 30 seconds", this indicates that the iOS app cannot connect to Apple Push Notification service (APNs). Here are the common causes and solutions:

## Prerequisites

### 1. Physical Device Required

⚠️ **Push notifications do NOT work on iOS simulators.** You must test on a real device.

The code now detects simulators and shows a clear error message.

### 2. Xcode Push Notification Capability

Open the project in Xcode:

```bash
npx cap open ios
```

#### Enable Push Notifications:

1. Select the **App** target in the project navigator
2. Go to the **Signing & Capabilities** tab
3. Click **+ Capability**
4. Add **Push Notifications**
5. Ensure it shows as enabled with no errors

### 3. Provisioning Profile

The app must be signed with a provisioning profile that includes push notifications:

1. In Xcode, go to **Signing & Capabilities**
2. Ensure **Automatically manage signing** is enabled, OR
3. If using manual signing, ensure your provisioning profile includes:
   - Push Notifications entitlement
   - Valid APNs certificate

### 4. Entitlements Files

The app already has entitlements configured:

- `ios/App/App/AppDebug.entitlements`
- `ios/App/App/AppRelease.entitlements`

Both should contain:

```xml
<key>aps-environment</key>
<string>development</string>
```

For production builds, change to:

```xml
<key>aps-environment</key>
<string>production</string>
```

### 5. Network Connectivity

APNs requires outbound connectivity on port 443 and 5223:

- Ensure the device has internet access
- Check if a VPN or firewall is blocking APNs
- APNs endpoints: `api.push.apple.com` and `api.development.push.apple.com`

## Verification Steps

### 1. Check Console Output

When enabling notifications, watch the console for these logs:

✅ **Success:**

```
🔔 [nativePush] subscribeToPush: Starting registration...
🔔 [nativePush] subscribeToPush: Calling PushNotifications.register()...
✅ [nativePush] subscribeToPush: Registration successful
✅ [nativePush] Token received: <first-20-chars>...
```

❌ **Failure:**

```
❌ [nativePush] subscribeToPush: Registration timed out after 30 seconds
❌ [nativePush] This usually means:
   1. No internet connection or APNs servers are blocked
   2. App is not properly signed with a push-enabled provisioning profile
   3. Push Notifications capability is not enabled in Xcode
```

### 2. Test the Implementation

1. Build and install the app on a real device:

   ```bash
   npm run build
   npx cap sync ios
   npx cap open ios
   ```

2. In Xcode, run the app on your connected device

3. Navigate to Settings → Push notifications

4. Tap "Enable notifications"

5. Watch the Xcode console for logs

### 3. Verify Permissions

In Settings app on the device:

- Go to **Settings** → **TimeHuddle**
- Ensure **Notifications** are enabled

## Troubleshooting

### Error: "Push notifications do not work on iOS simulators"

- **Solution:** Run the app on a physical device

### Error: "Notification permission denied"

- **Solution:** Go to device Settings → TimeHuddle → Notifications and enable

### Error: "Timed out waiting for push registration token"

- **Check:** Push Notification capability is enabled in Xcode
- **Check:** Provisioning profile includes push entitlement
- **Check:** Device has internet connectivity
- **Check:** No VPN blocking APNs

### Error: "Registration error: <error>"

- **Check:** Entitlements files are correct
- **Check:** App is properly signed
- **Re-generate:** Provisioning profile in Apple Developer portal

## Backend Configuration

Ensure the backend has APNs configured:

1. Check `backend/settings.json` has:

   ```json
   {
     "push": {
       "apns": {
         "keyId": "YOUR_KEY_ID",
         "teamId": "YOUR_TEAM_ID",
         "key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
       }
     }
   }
   ```

2. If using `.p8` key file, convert it:
   ```bash
   cat AuthKey_XXXXXXXXXX.p8 | pbcopy
   ```

## Apple Developer Portal Setup

### 1. Create APNs Key

1. Go to [Apple Developer Portal](https://developer.apple.com/account/resources/authkeys/list)
2. Click **+** to create a new key
3. Name it "TimeHuddle Push Notifications"
4. Enable **Apple Push Notifications service (APNs)**
5. Download the `.p8` file (save it securely!)
6. Note the Key ID and Team ID

### 2. Configure App Identifier

1. Go to **Certificates, Identifiers & Profiles**
2. Select your App ID
3. Ensure **Push Notifications** is enabled
4. If not enabled, click **Edit** → enable **Push Notifications** → **Save**

### 3. Regenerate Provisioning Profile

If you changed the App ID:

1. Go to **Profiles**
2. Delete the old profile
3. Create a new one with push notifications enabled
4. Download and install it in Xcode

## Production Checklist

Before releasing to TestFlight or App Store:

- [ ] Change entitlements to `production` environment
- [ ] Test push notifications on production backend
- [ ] Verify APNs key is configured correctly
- [ ] Test on multiple devices
- [ ] Verify notification payload format
- [ ] Test deep linking from notifications

## Code Changes Summary

The code has been updated with:

1. **Simulator Detection**: Automatically detects iOS simulators and shows clear error
2. **Better Logging**: Comprehensive logs for debugging
3. **Improved Error Messages**: User-friendly error messages with actionable steps
4. **Timeout Handling**: 30-second timeout with detailed diagnostic information

## Next Steps

1. Open Xcode: `npx cap open ios`
2. Enable Push Notifications capability
3. Run on a real device
4. Test notification registration
5. Verify backend receives the device token
6. Send a test notification from Settings page
