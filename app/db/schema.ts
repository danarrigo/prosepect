import { uuid, pgTable, text, timestamp } from "drizzle-orm/pg-core";


export const users = pgTable("users", {
    id: uuid().primaryKey().defaultRandom(),
    created_at: timestamp().notNull().defaultNow(),
    updated_at: timestamp().notNull().defaultNow(),
    fullName: text().notNull(),
    email: text().notNull(),
    password: text().notNull(),
})