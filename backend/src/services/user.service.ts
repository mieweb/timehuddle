import { ObjectId } from "mongodb";
import { usersCollection } from "../models/index.js";

export class UserService {
  async findById(id: string) {
    return usersCollection().findOne({ _id: new ObjectId(id) });
  }

  async findByEmail(email: string) {
    return usersCollection().findOne({ email });
  }

  async findManyByIds(ids: string[]) {
    const objectIds = ids
      .slice(0, 200)
      .filter((id) => /^[0-9a-f]{24}$/i.test(id))
      .map((id) => new ObjectId(id));
    if (objectIds.length === 0) return [];
    return usersCollection()
      .find({ _id: { $in: objectIds } })
      .toArray();
  }

  async updateProfile(
    id: string,
    data: { name?: string; image?: string | null; bio?: string; website?: string }
  ) {
    const $set: Record<string, unknown> = { updatedAt: new Date() };
    if (data.name !== undefined) $set.name = data.name;
    if (data.image !== undefined) $set.image = data.image;
    if (data.bio !== undefined) $set.bio = data.bio;
    if (data.website !== undefined) $set.website = data.website;
    await usersCollection().updateOne({ _id: new ObjectId(id) }, { $set });
    return this.findById(id);
  }

  async list(limit = 50, skip = 0) {
    return usersCollection().find().skip(skip).limit(limit).toArray();
  }
}

export const userService = new UserService();
