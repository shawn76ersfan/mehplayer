import type { AuthConfig } from "convex/server";

const domain = process.env.CLERK_JWT_ISSUER_DOMAIN;

export default {
  providers: domain
    ? [
        {
          domain,
          applicationID: "convex",
        },
      ]
    : [],
} satisfies AuthConfig;
