import { readFileSync } from "fs";
import { spawnSync } from "child_process";

const env = {};
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  if (!line || line.startsWith("#")) continue;
  const index = line.indexOf("=");
  if (index === -1) continue;
  env[line.slice(0, index)] = line.slice(index + 1).replace(/^"|"$/g, "");
}

const publishable = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const encoded = publishable.replace(/^pk_(test|live)_/, "");
const decoded = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
if (!decoded.includes("clerk.")) {
  console.error("Could not read the Clerk frontend API from the publishable key.");
  process.exit(1);
}
const issuer = decoded.startsWith("http") ? decoded : `https://${decoded}`;

const setEnv = spawnSync(
  "npx",
  ["convex", "env", "set", "CLERK_JWT_ISSUER_DOMAIN", issuer],
  { encoding: "utf8", shell: true },
);
if (setEnv.status !== 0) {
  console.error(setEnv.stderr || "convex env set failed");
  process.exit(setEnv.status ?? 1);
}
console.log(`issuer configured for ${issuer}`);

const secret = env.CLERK_SECRET_KEY;
if (!secret) {
  console.error("Clerk secret is missing.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${secret}`,
  "Content-Type": "application/json",
};
const existing = await fetch("https://api.clerk.com/v1/jwt_templates", { headers });
if (!existing.ok) {
  console.error(`jwt template list failed: ${existing.status}`);
  process.exit(1);
}
const templates = await existing.json();
const names = Array.isArray(templates) ? templates.map((template) => template.name) : [];
if (names.includes("convex")) {
  console.log("convex jwt template already exists");
} else {
  const created = await fetch("https://api.clerk.com/v1/jwt_templates", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: "convex",
      lifetime: 3600,
      allowed_clock_skew: 5,
      claims: {
        aud: "convex",
        name: "{{user.full_name}}",
        email: "{{user.primary_email_address}}",
        picture: "{{user.image_url}}",
      },
    }),
  });
  if (!created.ok) {
    console.error(`jwt template create failed: ${created.status}`);
    process.exit(1);
  }
  console.log("convex jwt template created");
}
