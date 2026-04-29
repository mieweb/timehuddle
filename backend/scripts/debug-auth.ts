import "dotenv/config";
import { connectDB, client } from "../src/lib/db.js";
import { auth } from "../src/lib/auth.js";

async function main() {
  await connectDB();
  const response = (await auth.api.signInEmail({
    body: { email: "alice@example.com", password: "Password1!" },
    asResponse: true,
  })) as Response;
  console.log("status:", response.status);
  console.log(
    "set-cookie:",
    response.headers.getSetCookie?.() ?? response.headers.get("set-cookie")
  );
  const body = await response.json();
  console.log("body:", JSON.stringify(body, null, 2));
  await client.close();
}
main().catch(console.error);
