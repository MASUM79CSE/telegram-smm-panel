import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { authConfig } from "@/auth.config";
import { authorizeCredentials } from "@/lib/auth/authorize";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      // See lib/auth/authorize.ts's own doc comment for why the actual
      // login logic lives there rather than being inlined here.
      authorize: authorizeCredentials,
    }),
  ],
});
