import {
  timestamp,
  pgTable,
  text,
  primaryKey,
  integer,
  uuid
} from "drizzle-orm/pg-core"
import type { AdapterAccountType } from "next-auth/adapters"

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  handle: text().unique(),
  name: text(),
  email: text().unique(),
  emailVerified: timestamp({ mode: "date" }),
  image: text(),
  password: text(),
  created_at: timestamp().notNull().defaultNow(),
  updated_at: timestamp().notNull().defaultNow(),
})

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().$type<AdapterAccountType>().notNull(),
    provider: text().notNull(),
    providerAccountId: text().notNull(),
    refresh_token: text(),
    access_token: text(),
    expires_at: integer(),
    token_type: text(),
    scope: text(),
    id_token: text(),
    session_state: text(),
  },
  (account) => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ]
)

export const sessions = pgTable("sessions", {
  sessionToken: text().primaryKey(),
  userId: uuid()
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ mode: "date" }).notNull(),
})

export const verificationTokens = pgTable(
  "verificationTokens",
  {
    identifier: text().notNull(),
    token: text().notNull(),
    expires: timestamp({ mode: "date" }).notNull(),
  },
  (verificationToken) => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ]
)