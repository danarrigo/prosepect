import NextAuth from "next-auth"
import GitHub from "next-auth/providers/github"
import Credentials from "next-auth/providers/credentials"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "./app/db"
import { getUserByEmail } from "./app/db/queries/users"

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  session: { strategy: "jwt" },
  providers: [
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
          return { id: user.id, name: user.name, email: user.email, image: user.image };
        }
        
        return null;
      }
    })
  ],
})
