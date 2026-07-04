# User Migration Scripts

Scripts for migrating users from Better Auth (`user` collection) to Meteor Accounts (`users` collection).

## Quick Start

Run the automated migration workflow from the project root:

```bash
./run-migration.sh
```

This interactive script will:
1. List all available MongoDB databases
2. Prompt you to select your Meteor database
3. Run a dry-run preview of the migration
4. Ask for confirmation
5. Perform the actual migration
6. Verify the results

## Manual Usage

If you need to run the scripts individually:

### 1. Dry Run (Preview)

```bash
cd meteor-backend/scripts
export MONGO_URL="mongodb://localhost:27017/YOUR_DB_NAME"
node migrate-to-meteor-accounts.js --dry-run
```

### 2. Run Migration

```bash
node migrate-to-meteor-accounts.js
```

### 3. Verify Results

```bash
node verify-user-collections.js
```

## Environment Variables

- `MONGO_URL` - Full MongoDB connection string including database name
  - Default: `mongodb://127.0.0.1:27017/timehuddle`
  - Example: `mongodb://localhost:27017/meteor`

- `TARGET_DB` - (Used by run-migration.sh) Database name only
  - The automation script constructs MONGO_URL from this

## What Gets Migrated

The migration converts Better Auth users to Meteor Accounts format:

### Better Auth Schema (`user` collection)
```javascript
{
  _id: ObjectId,
  email: "user@example.com",
  emailVerified: true,
  name: "John Doe",
  username: "johndoe",
  image: "https://...",
  bio: "...",
  website: "...",
  reportsToUserId: "...",
  blocked: [...],
  createdAt: Date
}
```

### Meteor Accounts Schema (`users` collection)
```javascript
{
  _id: "string-id",  // Converted to string
  emails: [{ address: "user@example.com", verified: true }],
  profile: { name: "John Doe" },
  services: {},  // Empty - users must reset password
  username: "johndoe",
  image: "https://...",
  bio: "...",
  website: "...",
  reportsToUserId: "...",
  blocked: [...],
  createdAt: Date
}
```

## Important Notes

- **Passwords are NOT migrated** - Better Auth passwords cannot be decrypted
- All migrated users must reset their passwords
- Existing users (by email) are automatically skipped
- The scripts are idempotent - safe to run multiple times

## Scripts

### migrate-to-meteor-accounts.js

Migrates users from `user` → `users` collection.

**Options:**
- `--dry-run` - Preview changes without modifying the database

**Features:**
- Converts Better Auth schema to Meteor Accounts format
- Skips users that already exist (by email)
- Preserves custom fields (username, image, bio, website, reportsToUserId, blocked)
- Shows migration summary with counts

### verify-user-collections.js

Compares both collections and reports:
- Total document counts
- Users in `user` but not in `users` (need migration)
- Users in `users` but not in `user` (Meteor-only users)
- Users in both collections (successfully migrated)

## Troubleshooting

### MongoDB Connection Issues

If you see connection errors:
```bash
# Check if MongoDB is running
ps aux | grep mongod

# Try connecting with mongosh
mongosh mongodb://localhost:27017
```

### Database Not Found

If your database isn't listed:
```bash
# List all databases
mongosh mongodb://localhost:27017 --eval "db.getMongo().getDBNames()"

# Check Meteor's database name
# It's usually shown when you start the Meteor server
```

### Permission Errors

Make sure the script is executable:
```bash
chmod +x run-migration.sh
```

## Testing

You can test the migration on a copy of your database:

```bash
# Copy your database
mongosh mongodb://localhost:27017 --eval '
  db.getSiblingDB("meteor").copyDatabase("meteor", "meteor_test")
'

# Run migration on the copy
export MONGO_URL="mongodb://localhost:27017/meteor_test"
cd meteor-backend/scripts
node migrate-to-meteor-accounts.js
```
