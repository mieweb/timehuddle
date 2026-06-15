import mongoose from "mongoose";

let connectPromise: Promise<typeof mongoose> | null = null;

export async function ensureMongooseConnected(): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  if (!connectPromise) {
    if (!process.env.MONGODB_URI) {
      throw new Error("MONGODB_URI environment variable is not set");
    }

    connectPromise = mongoose.connect(process.env.MONGODB_URI, {
      autoIndex: false,
    });
  }

  try {
    return await connectPromise;
  } catch (error) {
    connectPromise = null;
    throw error;
  }
}
