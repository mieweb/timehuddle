/**
 * Auth feature — remaining server methods for Phase 1.
 *
 * createUserAccount and resetPasswordWithTeamCode have been replaced by
 * timecore (better-auth). Archived originals: .attic/imports/features/auth/api.ts
 *
 * updateUserProfile will be replaced by PUT /v1/me/profile in Phase 2.
 */
import { Meteor } from 'meteor/meteor';

import { updateProfileSchema } from './schema';

// ─── Methods ──────────────────────────────────────────────────────────────────

Meteor.methods({
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
});
