/**
 * Dev seed — Creates test personas and a shared team in development mode.
 *
 * Only registered when Meteor.isDevelopment is true.
 * Provides instant login via dev.loginAs for rapid testing.
 */
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

// ─── Test Personas ────────────────────────────────────────────────────────────

export interface DevPersona {
  key: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: 'manager' | 'member';
  description: string;
}

export const DEV_PERSONAS: DevPersona[] = [
  {
    key: 'testmanager',
    email: 'manager@test.local',
    password: 'test1234',
    firstName: 'Taylor',
    lastName: 'Manager',
    role: 'manager',
    description: 'Team admin with full permissions',
  },
  {
    key: 'testmember1',
    email: 'alice@test.local',
    password: 'test1234',
    firstName: 'Alice',
    lastName: 'Engineer',
    role: 'member',
    description: 'Team member — engineering',
  },
  {
    key: 'testmember2',
    email: 'bob@test.local',
    password: 'test1234',
    firstName: 'Bob',
    lastName: 'Designer',
    role: 'member',
    description: 'Team member — design',
  },
];

const DEV_TEAM_NAME = 'Test Team';
const DEV_TEAM_CODE = 'TESTTEAM';

// ─── Server-only seed logic ───────────────────────────────────────────────────

if (Meteor.isServer && Meteor.isDevelopment) {
  // Dynamically import Teams collection to avoid circular deps at startup
  let TeamsCollection: typeof import('../features/teams/api').Teams | null = null;

  async function getTeams() {
    if (!TeamsCollection) {
      const mod = await import('../features/teams/api');
      TeamsCollection = mod.Teams;
    }
    return TeamsCollection;
  }

  /** Ensure a user exists; return their userId. */
  async function ensureUser(persona: DevPersona): Promise<string> {
    const existing = await Accounts.findUserByEmail(persona.email);
    if (existing) return existing._id;

    const userId = Accounts.createUser({
      email: persona.email,
      password: persona.password,
      profile: { firstName: persona.firstName, lastName: persona.lastName },
    });
    return userId;
  }

  /** Seed all personas and the shared test team on startup. */
  async function seedDevData() {
    const Teams = await getTeams();
    const userIds: Record<string, string> = {};

    // Create users
    for (const persona of DEV_PERSONAS) {
      userIds[persona.key] = await ensureUser(persona);
    }

    // Create or find the test team
    let team = await Teams.findOneAsync({ code: DEV_TEAM_CODE });
    if (!team) {
      const managerId = userIds['testmanager']!;
      const memberIds = DEV_PERSONAS.map((p) => userIds[p.key]!);
      await Teams.insertAsync({
        name: DEV_TEAM_NAME,
        members: memberIds,
        admins: [managerId],
        code: DEV_TEAM_CODE,
        createdAt: new Date(),
      });
      console.log(`[Dev Seed] Created team "${DEV_TEAM_NAME}" (code: ${DEV_TEAM_CODE})`);
    } else {
      // Ensure all personas are members
      const allIds = DEV_PERSONAS.map((p) => userIds[p.key]!);
      const missing = allIds.filter((id) => !team!.members.includes(id));
      if (missing.length > 0) {
        await Teams.updateAsync(team._id!, { $addToSet: { members: { $each: missing } } });
      }
    }

    console.log(
      `[Dev Seed] ${DEV_PERSONAS.length} test personas ready:`,
      DEV_PERSONAS.map((p) => p.key).join(', '),
    );
  }

  Meteor.startup(() => {
    seedDevData().catch((err) => console.error('[Dev Seed] Failed:', err));
  });

  // ─── Dev Methods ──────────────────────────────────────────────────────────────

  Meteor.methods({
    /**
     * Instant login as a dev persona — returns a login token.
     * Only available in development mode.
     */
    async 'dev.loginAs'(personaKey: string) {
      const persona = DEV_PERSONAS.find((p) => p.key === personaKey);
      if (!persona) throw new Meteor.Error('not-found', `Unknown persona: ${personaKey}`);

      const user = await Accounts.findUserByEmail(persona.email);
      if (!user) throw new Meteor.Error('not-found', 'Persona user not yet seeded');

      const stampedToken = Accounts._generateStampedLoginToken();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Accounts as any)._insertLoginToken(user._id, stampedToken);
      return { userId: user._id, token: stampedToken.token };
    },

    /** Return the list of available dev personas (client calls this to render the picker). */
    'dev.personas'() {
      return DEV_PERSONAS.map(({ key, firstName, lastName, role, description, email }) => ({
        key,
        firstName,
        lastName,
        role,
        description,
        email,
      }));
    },

    /**
     * Create (or find) a user by email and return a one-time login token.
     * Playwright calls this, then uses Meteor.loginWithToken on the client.
     */
    async 'e2e.loginToken'(email: string) {
      const normalized = email.trim().toLowerCase();
      let user = await Accounts.findUserByEmail(normalized);
      if (!user) {
        const userId = await Meteor.users.insertAsync({
          emails: [{ address: normalized, verified: true }],
          createdAt: new Date(),
        });
        user = await Meteor.users.findOneAsync(userId);
      }
      if (!user) throw new Meteor.Error('user-creation-failed');
      const stampedToken = Accounts._generateStampedLoginToken();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (Accounts as any)._insertLoginToken(user._id, stampedToken);
      return { userId: user._id, token: stampedToken.token };
    },

    async 'e2e.seed'() {
      if (!this.userId) throw new Meteor.Error('not-authorized');
      // Seed data will be added as features are built
    },
  });
}
