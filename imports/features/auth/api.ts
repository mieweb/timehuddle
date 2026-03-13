import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter';

import { signupSchema, updateProfileSchema, resetPasswordSchema } from './schema';

// ─── Methods ──────────────────────────────────────────────────────────────────

Meteor.methods({
  async createUserAccount(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
  }) {
    const result = signupSchema.safeParse(data);
    if (!result.success)
      throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');

    const { email, password, firstName, lastName } = result.data;

    try {
      const userId = Accounts.createUser({
        email,
        password,
        profile: { firstName, lastName },
      });
      return userId;
    } catch (err: unknown) {
      const message = err instanceof Meteor.Error ? err.reason : 'Failed to create user';
      throw new Meteor.Error('server-error', message ?? 'Failed to create user');
    }
  },

  async updateUserProfile(data: { firstName: string; lastName: string }) {
    if (!this.userId) throw new Meteor.Error('not-authorized');

    const result = updateProfileSchema.safeParse(data);
    if (!result.success)
      throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');

    const { firstName, lastName } = result.data;

    await Meteor.users.updateAsync(this.userId, {
      $set: {
        'profile.firstName': firstName,
        'profile.lastName': lastName,
      },
    });
    return true;
  },

  async resetPasswordWithTeamCode(data: {
    email: string;
    teamCode: string;
    newPassword: string;
  }) {
    const result = resetPasswordSchema.safeParse(data);
    if (!result.success)
      throw new Meteor.Error('validation', result.error.issues[0]?.message ?? 'Invalid input');

    const { email, teamCode, newPassword } = result.data;

    // Dynamic import to avoid circular dependency — Teams may not exist yet during startup
    // @ts-ignore dynamic import for circular dependency avoidance
    const { Teams } = await import('../teams/api');

    const user = await Accounts.findUserByEmail(email);
    if (!user) throw new Meteor.Error('not-found', 'User not found');

    const team = await Teams.findOneAsync({ code: teamCode });
    if (!team) throw new Meteor.Error('invalid-code', 'Invalid team code');

    const isMember =
      (team.members || []).includes(user._id) ||
      (team.admins || []).includes(user._id);
    if (!isMember) throw new Meteor.Error('forbidden', 'User is not in this team');

    if (typeof Accounts.setPasswordAsync === 'function') {
      await Accounts.setPasswordAsync(user._id, newPassword, { logout: false });
    } else {
      Accounts.setPassword(user._id, newPassword, { logout: false });
    }
    return true;
  },
});

// ─── Rate limiting ────────────────────────────────────────────────────────────

const AUTH_METHODS = ['createUserAccount', 'updateUserProfile', 'resetPasswordWithTeamCode'];

DDPRateLimiter.addRule(
  {
    name: (n) => AUTH_METHODS.includes(n),
    userId: () => true,
  },
  10,
  60_000,
);
