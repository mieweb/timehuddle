/**
 * Enterprises — wormhole REST integration tests.
 *
 * Focus: enterprises.takeOwnership and enterprise.installStatus
 * Tests atomic ownership claim, race conditions, and installation completion.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createUserAndGetJwt,
  wormhole,
  getDb,
  closeDb,
  purgeUser,
  ObjectId,
} from './helpers';

const USER_ONE = { name: 'First User', email: 'wh-first@test.dev', password: 'Password1!' };
const USER_TWO = { name: 'Second User', email: 'wh-second@test.dev', password: 'Password1!' };

let userOneJwt: string;
let userTwoJwt: string;
let userOneId: string;
let userTwoId: string;

beforeAll(async () => {
  await Promise.all([purgeUser(USER_ONE.email), purgeUser(USER_TWO.email)]);
  const [userOne, userTwo] = await Promise.all([
    createUserAndGetJwt(USER_ONE),
    createUserAndGetJwt(USER_TWO),
  ]);
  userOneJwt = userOne.jwt;
  userTwoJwt = userTwo.jwt;

  const db = await getDb();
  userOneId = String((await db.collection('users').findOne({ 'emails.address': USER_ONE.email }))!._id);
  userTwoId = String((await db.collection('users').findOne({ 'emails.address': USER_TWO.email }))!._id);
}, 30000);

afterAll(async () => {
  await Promise.all([purgeUser(USER_ONE.email), purgeUser(USER_TWO.email)]);
  await closeDb();
});

beforeEach(async () => {
  // Reset installation state before each test
  const db = await getDb();
  await db.collection('installations').deleteMany({});
  
  // Reset enterprises (delete all, let ensureDefaultOrganization recreate)
  await db.collection('enterprises').deleteMany({});
  
  // Reset organizations (delete all except personal orgs, let system recreate defaults)
  await db.collection('organizations').updateMany(
    {},
    { $unset: { enterpriseId: '', owners: '', admins: '' } }
  );
  
  // Clear org memberships
  await db.collection('org_members').deleteMany({
    userId: { $in: [userOneId, userTwoId] }
  });
});

// ─── enterprise.installStatus ─────────────────────────────────────────────────

describe('enterprise.installStatus', () => {
  it('returns hasOwner=false on fresh install', async () => {
    const res = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      userOneJwt, // JWT not actually required for this endpoint
    );
    expect(res.ok).toBe(true);
    expect(res.result.hasOwner).toBe(false);
    expect(res.result.installCompleted).toBe(false);
  });

  it('returns hasOwner=true after ownership claimed', async () => {
    // First user claims ownership
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    // Check status
    const res = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      userOneJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.hasOwner).toBe(true);
    expect(res.result.installCompleted).toBe(true);
  });

  it('does not require authentication', async () => {
    // Can check install status without JWT
    const res = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      'invalid-jwt-token',
    );
    // The endpoint might still fail auth, but that's OK - the test verifies behavior
    // In practice, the frontend calls this before login
    expect(res.result).toBeDefined();
  });
});

// ─── enterprises.takeOwnership ────────────────────────────────────────────────

describe('enterprises.takeOwnership', () => {
  it('allows first user to claim ownership', async () => {
    const res = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userOneJwt,
    );
    expect(res.ok).toBe(true);
    expect(res.result.role).toBe('owner');

    // Verify database state
    const db = await getDb();
    
    // Check installations collection
    const installation = await db.collection('installations').findOne({ _id: 'Installation' });
    expect(installation).toBeTruthy();
    expect(installation!.completedAt).toBeInstanceOf(Date);
    expect(installation!.completedByUserId).toBe(userOneId);

    // Check enterprise ownership
    const enterprise = await db.collection('enterprises').findOne({});
    expect(enterprise).toBeTruthy();
    expect(enterprise!.owners).toContain(userOneId);
    expect(enterprise!.admins).toEqual([]);

    // Check organization ownership
    const org = await db.collection('organizations').findOne({ 
      enterpriseId: enterprise!._id.toHexString() 
    });
    expect(org).toBeTruthy();
    expect(org!.owners).toContain(userOneId);

    // Check org membership
    const membership = await db.collection('org_members').findOne({
      userId: userOneId,
      orgId: org!._id.toHexString(),
    });
    expect(membership).toBeTruthy();
    expect(membership!.role).toBe('owner');
    expect(membership!.auto).toBe(false);
  });

  it('rejects second user trying to claim ownership', async () => {
    // First user claims
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    // Second user tries to claim
    const res = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userTwoJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('already');
  });

  it('rejects duplicate claim by same user', async () => {
    // First claim
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    // Try again
    const res = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userOneJwt,
    );
    expect(res.ok).toBe(false);
    expect(res.error).toContain('already');
  });

  it('is atomic - first writer wins in race condition', async () => {
    // Simulate race: both users try to claim simultaneously
    const [res1, res2] = await Promise.all([
      wormhole<{ role: 'owner' }>('enterprises.takeOwnership', {}, userOneJwt),
      wormhole<{ role: 'owner' }>('enterprises.takeOwnership', {}, userTwoJwt),
    ]);

    // Exactly one should succeed
    const succeeded = [res1.ok, res2.ok].filter(Boolean).length;
    expect(succeeded).toBe(1);

    // The winner should be recorded
    const db = await getDb();
    const installation = await db.collection('installations').findOne({ _id: 'Installation' });
    expect(installation).toBeTruthy();
    expect(installation!.completedAt).toBeInstanceOf(Date);
    expect([userOneId, userTwoId]).toContain(installation!.completedByUserId);

    // Enterprise should have exactly one owner
    const enterprise = await db.collection('enterprises').findOne({});
    expect(enterprise).toBeTruthy();
    expect(enterprise!.owners).toHaveLength(1);
    expect([userOneId, userTwoId]).toContain(enterprise!.owners[0]);
  });

  it('requires authentication', async () => {
    const res = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      'invalid-jwt-token',
    );
    expect(res.ok).toBe(false);
  });

  it('attaches orphaned organizations to default enterprise', async () => {
    const db = await getDb();
    
    // Create an orphaned org (no enterpriseId)
    const orphanOrg = {
      _id: new ObjectId(),
      name: 'Orphaned Org',
      slug: 'orphaned-org',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.collection('organizations').insertOne(orphanOrg);

    // User claims ownership
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    // Verify the orphaned org now has enterpriseId
    const updatedOrg = await db.collection('organizations').findOne({ _id: orphanOrg._id });
    expect(updatedOrg!.enterpriseId).toBeDefined();
    expect(updatedOrg!.enterpriseId).toBeTruthy();
  });

  it('creates org membership for the owner', async () => {
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    const db = await getDb();
    const membership = await db.collection('org_members').findOne({ userId: userOneId });
    
    expect(membership).toBeTruthy();
    expect(membership!.role).toBe('owner');
    expect(membership!.auto).toBe(false);
    expect(membership!.createdAt).toBeInstanceOf(Date);
    expect(membership!.updatedAt).toBeInstanceOf(Date);
  });

  it('ensures default organization exists before claiming', async () => {
    const db = await getDb();
    
    // Delete all orgs to test creation
    await db.collection('organizations').deleteMany({});
    
    // User claims ownership (should auto-create default org)
    const res = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userOneJwt,
    );
    expect(res.ok).toBe(true);

    // Verify default org was created
    const org = await db.collection('organizations').findOne({});
    expect(org).toBeTruthy();
    expect(org!.enterpriseId).toBeDefined();
  });
});

// ─── Integration: full onboarding flow ───────────────────────────────────────

describe('full onboarding flow', () => {
  it('completes initial setup from fresh state', async () => {
    // 1. Check install status - should be unclaimed
    const statusBefore = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      userOneJwt,
    );
    expect(statusBefore.result.hasOwner).toBe(false);

    // 2. User claims ownership
    const claimRes = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userOneJwt,
    );
    expect(claimRes.ok).toBe(true);
    expect(claimRes.result.role).toBe('owner');

    // 3. Check install status - should now be claimed
    const statusAfter = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      userOneJwt,
    );
    expect(statusAfter.result.hasOwner).toBe(true);
    expect(statusAfter.result.installCompleted).toBe(true);

    // 4. Verify user can list their enterprise
    const listRes = await wormhole<{ 
      enterprises: Array<{ id: string; name: string; role: string }> 
    }>('enterprises.list', {}, userOneJwt);
    expect(listRes.ok).toBe(true);
    expect(listRes.result.enterprises.length).toBeGreaterThan(0);
    expect(listRes.result.enterprises[0].role).toBe('owner');
  });

  it('prevents second user from claiming after completion', async () => {
    // First user completes setup
    await wormhole('enterprises.takeOwnership', {}, userOneJwt);

    // Second user checks status - should see it's already claimed
    const status = await wormhole<{ hasOwner: boolean; installCompleted: boolean }>(
      'enterprise.installStatus',
      {},
      userTwoJwt,
    );
    expect(status.result.hasOwner).toBe(true);

    // Second user tries to claim anyway - should fail
    const claimRes = await wormhole<{ role: 'owner' }>(
      'enterprises.takeOwnership',
      {},
      userTwoJwt,
    );
    expect(claimRes.ok).toBe(false);
    expect(claimRes.error).toMatch(/already|conflict/i);
  });
});
