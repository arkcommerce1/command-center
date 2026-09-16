// Mint a local Auth.js session cookie for Goal 7 browser e2e (no auth changes).
// Run: AUTH_SECRET=... node tests/e2e/mint-cookie.mjs  -> tests/e2e/.e2e-cookie
import { encode } from "@auth/core/jwt";
import { promises as fs } from "fs";
import path from "path";

const secret = process.env.AUTH_SECRET;
if (!secret) throw new Error("AUTH_SECRET required");

const value = await encode({
  token: { sub: "e2e-haim", email: "haim@everlastingicerx.com", name: "Haim E2E" },
  secret,
  salt: "authjs.session-token",
});
await fs.writeFile(path.join(process.cwd(), "tests", "e2e", ".e2e-cookie"), value);
console.log("cookie minted");
