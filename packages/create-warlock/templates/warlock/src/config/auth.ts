import { type AuthConfigurations } from "@warlock.js/auth";
import { env } from "@warlock.js/core";
import { User } from "app/users/models/user";

const authConfigurations: AuthConfigurations = {
  userType: {
    user: User,
  },
  // Store only a SHA-256 digest of each access and refresh token, so a copy of
  // the token tables cannot be replayed as a login.
  hashTokensAtRest: true,
  // Access tokens are short-lived: a leaked one stops working within the hour.
  // Clients keep the session alive by calling POST /auth/refresh-token with the
  // refresh token returned at login, which rotates both tokens.
  accessToken: {
    secret: env("JWT_SECRET"),
    expiresIn: "1h",
  },
  refreshToken: {
    enabled: true,
    secret: env("JWT_REFRESH_SECRET"),
    expiresIn: "7d",
  },
};

export default authConfigurations;
