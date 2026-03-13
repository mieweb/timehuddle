/**
 * e2e/seed — Meteor method that seeds demo data for the logged-in user.
 *
 * Only registered when in development mode.
 * Used by Playwright screenshot tests to populate realistic content.
 */
import { Accounts } from 'meteor/accounts-base';
import { Meteor } from 'meteor/meteor';

if (Meteor.isServer && Meteor.isDevelopment) {
  Meteor.methods({
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
