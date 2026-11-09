import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// People directory (trimmed). In the full app this table carries more profile fields; this export
// keeps only what the Presentations module reads: email + name (deck owner names and the "share
// with specific people" pick-list) and the presenter fields for a sales deck's closing page (title,
// phone, region for phone formatting, avatar, and personType so only employees are offered).
// The email address is the primary key; the table has no separate id column.
export const people = pgTable("people", {
  email: text("email").primaryKey(),
  name: text("name"),
  roleTitle: text("role_title"),
  region: text("region"),
  avatarUrl: text("avatar_url"),
  phone: text("phone"),
  // "employee" | "contractor". Contractors are not staff and are never offered as presenters.
  personType: text("person_type").notNull().default("employee"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
