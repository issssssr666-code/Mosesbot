import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const forumThreadsTable = pgTable(
  "forum_threads",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    category: text("category").notNull().default("general"),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    activityIndex: index("forum_threads_last_activity_at").on(table.lastActivityAt),
    categoryIndex: index("forum_threads_category").on(table.category),
  }),
);

export const forumPostsTable = pgTable(
  "forum_posts",
  {
    id: serial("id").primaryKey(),
    threadId: integer("thread_id")
      .notNull()
      .references(() => forumThreadsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    authorName: text("author_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    threadCreatedAtIndex: index("forum_posts_thread_created_at").on(table.threadId, table.createdAt),
  }),
);

export const insertForumThreadSchema = createInsertSchema(forumThreadsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  lastActivityAt: true,
});
export const insertForumPostSchema = createInsertSchema(forumPostsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertForumThread = z.infer<typeof insertForumThreadSchema>;
export type InsertForumPost = z.infer<typeof insertForumPostSchema>;
export type ForumThread = typeof forumThreadsTable.$inferSelect;
export type ForumPost = typeof forumPostsTable.$inferSelect;