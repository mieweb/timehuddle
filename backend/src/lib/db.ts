import { MongoClient } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI environment variable is not set");
}

const client = new MongoClient(process.env.MONGODB_URI);

export async function connectDB() {
  await client.connect();
  console.log("MongoDB connected");
}

export function getDB() {
  return client.db();
}

export { client };
