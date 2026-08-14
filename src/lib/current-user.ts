import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";

const SINGLE_USER_EMAIL = process.env.ADMIN_EMAIL ?? "admin@localhost";

/**
 * The application is single-user for v1, but the schema is already
 * multi-user-capable (see users/subscriptions). This is the one place that
 * assumption lives — swapping in real per-request session lookup later only
 * touches this function, not the query/mutation layer built on top of it.
 */
export function getOrCreateDefaultUser(): { id: number; email: string } {
  const existing = db.select().from(users).where(eq(users.email, SINGLE_USER_EMAIL)).get();
  if (existing) return existing;

  const [created] = db
    .insert(users)
    .values({ email: SINGLE_USER_EMAIL, passwordHash: "" })
    .returning()
    .all();
  return created;
}

export function getCurrentUserId(): number {
  return getOrCreateDefaultUser().id;
}
