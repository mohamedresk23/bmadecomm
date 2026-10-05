import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// This table is purely for verifying the migration runner and test harness
// in foundation story F00-02. It will be dropped/ignored in business logic.
export const migrationsTest = pgTable("_migrations_test", {
  id: text("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
