# App Store Submission Checklist

## ✅ Required Items Before Submission

### 1. Privacy Policy URL ⚠️ **REQUIRED**

**Option A: GitHub Pages (Recommended - Free)**

1. Enable GitHub Pages in your repo settings:
   - Go to: https://github.com/mieweb/timehuddle/settings/pages
   - Source: Deploy from a branch
   - Branch: `main` → `/docs` folder
   - Save
2. Wait 2-3 minutes for deployment
3. Your Privacy Policy URL will be:
   ```
   https://mieweb.github.io/timehuddle/privacy.html
   ```

**Option B: Your Own Website**

- Upload `docs/privacy.html` to your website
- Use that URL in App Store Connect

**Enter in App Store Connect:**

- Privacy Policy URL: `https://mieweb.github.io/timehuddle/privacy.html` (or your URL)

---

### 2. Primary Category ⚠️ **REQUIRED**

**Select:** **Business**

- TimeHuddle is a workplace productivity/time tracking application

**Secondary Category (Optional):**

- Productivity

---

### 3. Pricing ⚠️ **REQUIRED**

Go to: **App Store Connect → Pricing and Availability**

**Select:** **Free** (or your preferred tier)

---

### 4. App Privacy Information ⚠️ **REQUIRED**

Click **"Get Started"** in the App Privacy section and answer:

#### **Data Types Collected:**

##### **Contact Info**

- ✅ **Email Address**
  - Used for: App Functionality, Account Creation
  - Linked to User: Yes
  - Used for Tracking: No

- ✅ **Name**
  - Used for: App Functionality
  - Linked to User: Yes
  - Used for Tracking: No

##### **User Content**

- ✅ **Other User Content** (work data, timesheets, messages)
  - Used for: App Functionality
  - Linked to User: Yes
  - Used for Tracking: No

##### **Identifiers**

- ✅ **User ID**
  - Used for: App Functionality
  - Linked to User: Yes
  - Used for Tracking: No

- ✅ **Device ID**
  - Used for: Analytics, Push Notifications
  - Linked to User: Yes
  - Used for Tracking: No

##### **Usage Data**

- ✅ **Product Interaction**
  - Used for: Analytics, App Functionality
  - Linked to User: Yes
  - Used for Tracking: No

#### **Important Privacy Answers:**

**Do you or your third-party partners collect data from this app?**

- ✅ **Yes**

**Is the data collected from this app used for tracking purposes?**

- ❌ **No**

**Is the data collected from this app linked to the user's identity?**

- ✅ **Yes** (work data is tied to user accounts)

---

### 5. App Review Information

Already provided in earlier step:

- **Sign-In Required:** Yes
- **Demo Account:**
  - Email: `reviewer@timehuddle.app`
  - Password: `AppReview2026!`

---

## 📱 Screenshots

✅ **Already Complete!**

- 5 iPhone screenshots in `appstore-screenshots/iphone-*.png`
- 5 iPad screenshots in `appstore-screenshots/ipad-*.png`

---

## 📋 Step-by-Step Submission

### Step 1: Set Up Privacy Policy URL

1. Enable GitHub Pages (see Option A above)
2. Enter the URL in App Store Connect → App Privacy
3. Click **Save**

### Step 2: Complete App Privacy Questionnaire

1. Click **"Get Started"** under App Privacy
2. Follow the data type answers above
3. Click **Save** and **Publish**

### Step 3: Set Primary Category

1. Go to App Information
2. Primary Category: **Business**
3. Secondary Category: **Productivity** (optional)
4. Click **Save**

### Step 4: Set Pricing

1. Go to Pricing and Availability
2. Select **Free**
3. Set availability to **All Countries**
4. Click **Save**

### Step 5: Upload Screenshots

1. Go to **Previews and Screenshots**
2. iPhone section → Upload `iphone-*.png` files
3. iPad section → Upload `ipad-*.png` files
4. Click **Save**

### Step 6: Submit for Review

1. Click **"Add for Review"** button
2. Review all information
3. Click **"Submit for Review"**
4. Wait for Apple's review (typically 24-48 hours)

---

## 🎯 Privacy Policy Hosting Quick Command

```bash
# Check if GitHub Pages is enabled
gh api repos/mieweb/timehuddle/pages

# If not enabled, enable it
gh api -X POST repos/mieweb/timehuddle/pages \
  -f source[branch]=main \
  -f source[path]=/docs
```

Or manually: https://github.com/mieweb/timehuddle/settings/pages

---

## 📧 Support

If Apple has questions during review, they will contact you via the email associated with your App Store Connect account.

**Estimated Review Time:** 1-3 business days

---

## ✅ Final Checklist

Before clicking "Submit for Review":

- [ ] Privacy Policy URL is live and accessible
- [ ] App Privacy questionnaire completed
- [ ] Primary category selected (Business)
- [ ] Pricing set (Free)
- [ ] 5 iPhone screenshots uploaded
- [ ] 5 iPad screenshots uploaded
- [ ] Test account credentials verified working
- [ ] App Review notes filled out
- [ ] Age rating set (4+)
- [ ] Content rights confirmed
- [ ] Encryption declaration completed

**Once all items are checked, click "Add for Review"! 🚀**
