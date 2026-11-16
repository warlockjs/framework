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
  // 6.0 makes these the defaults; they are set here so the app is safe now.
  // Passkeys (when you add `passkeys: { rpID, rpName, origin }`): also set
  // `userVerification: "required"` there; the default stays "preferred" until 6.0.
  // The JWT secrets below must be at least 32 bytes (`npm run jwt` generates
  // them); a shorter one is refused at boot from 6.0 and warns in production now.
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
