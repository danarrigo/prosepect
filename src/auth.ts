import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "./app/db"
import { users, accounts, sessions, verificationTokens } from "./app/db/schema"
import { getUserByEmail } from "./app/db/queries/users"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    Google,
    GitHub,
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        
        const user = await getUserByEmail(credentials.email as string);
        if (user && user.password === credentials.password) {
          // Return user object without the password
          return { id: user.id, name: user.name, email: user.email, image: user.image, handle: user.handle };
        }
        
        return null;
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const dbUser = await getUserByEmail(user.email as string);
        if (dbUser) {
           token.handle = dbUser.handle;
        }
      }
      // If handle is missing in the token, try to fetch it (for after onboarding)
      if (!token.handle && token.email) {
        const dbUser = await getUserByEmail(token.email);
        if (dbUser?.handle) {
           token.handle = dbUser.handle;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.handle) {
        (session.user as any).handle = token.handle;
      }
      return session;
    }
  },
})
