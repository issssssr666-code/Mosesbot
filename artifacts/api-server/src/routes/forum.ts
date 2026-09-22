import { and, asc, count, desc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { db, forumPostsTable, forumThreadsTable } from "@workspace/db";

const router: IRouter = Router();
const MAX_THREADS = 50;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 2_000;
const MAX_AUTHOR_LENGTH = 40;
const CATEGORIES = new Set(["general", "technical", "news", "risk", "paper"]);

const cleanText = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const parseThreadId = (value: string | string[]): number => {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : 0;
};

const threadView = (thread: typeof forumThreadsTable.$inferSelect, replyCount: number) => ({
  ...thread,
  replyCount,
});

router.get("/forum/threads", async (req, res): Promise<void> => {
  const rawCategory = typeof req.query.category === "string" ? req.query.category : undefined;
  const category = rawCategory && CATEGORIES.has(rawCategory) ? rawCategory : undefined;
  const rows = await db
    .select({
      thread: forumThreadsTable,
      replyCount: count(forumPostsTable.id),
    })
    .from(forumThreadsTable)
    .leftJoin(forumPostsTable, eq(forumPostsTable.threadId, forumThreadsTable.id))
    .where(category ? eq(forumThreadsTable.category, category) : undefined)
    .groupBy(forumThreadsTable.id)
    .orderBy(desc(forumThreadsTable.lastActivityAt))
    .limit(MAX_THREADS);
  res.json(rows.map((row) => threadView(row.thread, Number(row.replyCount))));
});

router.get("/forum/threads/:id", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.id);
  if (!threadId) {
    res.status(400).json({ error: "Некорректный идентификатор темы." });
    return;
  }
  const [thread] = await db
    .select()
    .from(forumThreadsTable)
    .where(eq(forumThreadsTable.id, threadId))
    .limit(1);
  if (!thread) {
    res.status(404).json({ error: "Тема не найдена." });
    return;
  }
  const posts = await db
    .select()
    .from(forumPostsTable)
    .where(eq(forumPostsTable.threadId, threadId))
    .orderBy(asc(forumPostsTable.createdAt));
  res.json({ ...thread, posts });
});

router.post("/forum/threads", async (req, res): Promise<void> => {
  const title = cleanText(req.body?.title, MAX_TITLE_LENGTH);
  const body = cleanText(req.body?.body, MAX_BODY_LENGTH);
  const authorName = cleanText(req.body?.authorName, MAX_AUTHOR_LENGTH);
  const category = cleanText(req.body?.category, 20);
  if (title.length < 3 || body.length < 1 || authorName.length < 2 || !CATEGORIES.has(category)) {
    res.status(400).json({
      error: "Укажите заголовок от 3 символов, текст, имя от 2 символов и допустимую категорию.",
    });
    return;
  }
  const [thread] = await db
    .insert(forumThreadsTable)
    .values({ title, body, authorName, category })
    .returning();
  res.status(201).json({ ...thread, replyCount: 0 });
});

router.post("/forum/threads/:id/posts", async (req, res): Promise<void> => {
  const threadId = parseThreadId(req.params.id);
  const body = cleanText(req.body?.body, MAX_BODY_LENGTH);
  const authorName = cleanText(req.body?.authorName, MAX_AUTHOR_LENGTH);
  if (!threadId || body.length < 1 || authorName.length < 2) {
    res.status(400).json({ error: "Укажите тему, текст ответа и имя от 2 символов." });
    return;
  }
  const [thread] = await db
    .select({ id: forumThreadsTable.id })
    .from(forumThreadsTable)
    .where(eq(forumThreadsTable.id, threadId))
    .limit(1);
  if (!thread) {
    res.status(404).json({ error: "Тема не найдена." });
    return;
  }
  const [post] = await db
    .insert(forumPostsTable)
    .values({ threadId, body, authorName })
    .returning();
  await db
    .update(forumThreadsTable)
    .set({ updatedAt: new Date(), lastActivityAt: new Date() })
    .where(eq(forumThreadsTable.id, threadId));
  res.status(201).json(post);
});

export default router;