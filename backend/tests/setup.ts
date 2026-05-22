import { config } from "dotenv";

// Load .env before modules that read process.env (for example db/auth initialization).
config();

const DEFAULT_DB_NAME = "timeharbor";

function toTestMongoUri(uri: string): string {
  const [withoutParams, queryPart] = uri.split("?");
  const lastSlash = withoutParams.lastIndexOf("/");

  let base = withoutParams;
  let databaseName = DEFAULT_DB_NAME;

  if (lastSlash >= 0 && lastSlash < withoutParams.length - 1) {
    base = withoutParams.slice(0, lastSlash + 1);
    databaseName = withoutParams.slice(lastSlash + 1);
  } else if (!withoutParams.endsWith("/")) {
    base = `${withoutParams}/`;
  }

  const testDatabaseName = databaseName.endsWith("_test") ? databaseName : `${databaseName}_test`;

  return `${base}${testDatabaseName}${queryPart ? `?${queryPart}` : ""}`;
}

const explicitTestUri = process.env.MONGODB_TEST_URI?.trim();
if (explicitTestUri) {
  process.env.MONGODB_URI = explicitTestUri;
} else if (process.env.MONGODB_URI) {
  process.env.MONGODB_URI = toTestMongoUri(process.env.MONGODB_URI);
} else {
  throw new Error("MONGODB_URI environment variable is not set");
}
