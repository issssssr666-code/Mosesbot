import { createHash } from "node:crypto";
import { desc, gte } from "drizzle-orm";
import {
  db,
  marketNewsTable,
  sentimentHistoryTable,
  type MarketNews,
  type SentimentHistory,
} from "@workspace/db";
import {
  getBtcMarketAnalysis,
  type BtcMarketAnalysis,
  type BtcTimeframe,
} from "./btc-market-analysis";
import {
  getMarketIntelligence,
  type MarketIntelligence,
} from "./market-intelligence";

const NEWS_LOOKBACK_HOURS = 72;
const NEWS_LOOKBACK_MS = NEWS_LOOKBACK_HOURS * 60 * 60 * 1000;
const NEWS_LIMIT = 40;
const NEWS_REQUEST_TIMEOUT_MS = 8_000;
const MAX_TITLE_LENGTH = 300;
const MAX_SUMMARY_LENGTH = 700;

type FeedSource = {
  name: string;
  url: string;
};

const FEED_SOURCES: FeedSource[] = [
  {
    name: "CoinDesk RSS",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    name: "Cointelegraph RSS",
    url: "https://cointelegraph.com/rss",
  },
  {
    name: "Bitcoin Magazine RSS",
    url: "https://bitcoinmagazine.com/.rss/full/",
  },
  {
    name: "Federal Reserve RSS",
    url: "https://www.federalreserve.gov/feeds/press_all.xml",
  },
  {
    name: "SEC Press Releases RSS",
    url: "https://www.sec.gov/news/pressreleases.rss",
  },
];

export type NewsCategory =
  | "bitcoin"
  | "crypto"
  | "regulation"
  | "etf"
  | "macro"
  | "market";

export type NewsDirection = "positive" | "neutral" | "negative";
export type SentimentLabel = "positive" | "neutral" | "negative";

export type MarketNewsItem = {
  id: number;
  source: string;
  sourceUrl: string;
  canonicalUrl: string;
  publishedAt: string;
  title: string;
  summary: string;
  category: NewsCategory;
  sentiment: SentimentLabel;
  impactScore: number;
  impactDirection: NewsDirection;
};

export type MarketSentiment = {
  label: SentimentLabel;
  score: number;
  newsCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  calculatedAt: string;
  lookbackHours: number;
  topNews: MarketNewsItem[];
  risks: string[];
  sourceStatus: { source: string; ok: boolean; error?: string }[];
};

export type MarketContext = {
  technical: BtcMarketAnalysis;
  sentiment: MarketSentiment | null;
  marketIntelligence: MarketIntelligence | null;
  alignment: string;
};

export class MarketSentimentError extends Error {
  constructor(
    message: string,
    public readonly kind: "sources" | "empty" | "invalid",
  ) {
    super(message);
    this.name = "MarketSentimentError";
  }
}

type ParsedFeedItem = {
  source: string;
  sourceUrl: string;
  canonicalUrl: string;
  publishedAt: Date;
  title: string;
  summary: string;
  category: NewsCategory;
  sentiment: SentimentLabel;
  impactScore: number;
  impactDirection: NewsDirection;
  fingerprint: string;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const decodeXml = (value: string): string =>
  value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );

const cleanText = (value: string, maxLength: number): string =>
  decodeXml(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);

const tagValue = (block: string, tags: string[]): string => {
  for (const tag of tags) {
    const match = block.match(
      new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"),
    );
    if (match?.[1]) return match[1];
  }
  return "";
};

const linkValue = (block: string): string => {
  const rssLink = tagValue(block, ["link"]);
  if (rssLink) return cleanText(rssLink, 1_000);
  const atomLink = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  return atomLink?.[1]?.trim() ?? "";
};

const parseDate = (value: string): Date | null => {
  const timestamp = Date.parse(cleanText(value, 100));
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return date.getTime() <= Date.now() + 5 * 60 * 1000 ? date : null;
};

const normalizeUrl = (value: string, sourceUrl: string): string => {
  try {
    const url = new URL(value, sourceUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith("utm_") || ["ref", "source"].includes(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
};

const categoryForText = (text: string): NewsCategory => {
  if (/\b(etf|exchange[- ]traded fund|spot fund|fund flows?)\b/i.test(text)) return "etf";
  if (
    /\b(sec|cftc|regulat|legislation|lawmakers?|congress|ban|санкц|регуля|закон|комисси[яи])\b/i.test(
      text,
    )
  ) {
    return "regulation";
  }
  if (
    /\b(federal reserve|fed\b|inflation|cpi|interest rate|rate cut|rate hike|fomc|jobs report|treasury|gdp|инфляц|ставк|центральн)\b/i.test(
      text,
    )
  ) {
    return "macro";
  }
  if (/\b(bitcoin|btc|биткоин)\b/i.test(text)) return "bitcoin";
  if (/\b(crypto|cryptocurrency|blockchain|крипто|криптовалют)\b/i.test(text)) return "crypto";
  return "market";
};

const POSITIVE_TERMS: Array<[RegExp, number]> = [
  [/\b(approval|approved|launch|inflow|inflows|adoption|surge|rally|breakout|growth)\b/gi, 16],
  [/\b(bullish|record high|all[- ]time high|оптимизм|рост|одобр[ен|ение]|приток)\b/gi, 14],
  [/\b(easing|cuts rates|rate cut|stimulus|supportive)\b/gi, 10],
];

const NEGATIVE_TERMS: Array<[RegExp, number]> = [
  [/\b(rejection|rejected|outflow|outflows|hack|exploit|ban|lawsuit|fraud|collapse)\b/gi, 18],
  [/\b(bearish|sell[- ]off|liquidation|warning|risk|crackdown|санкц|падение|отток)\b/gi, 14],
  [/\b(rate hike|higher for longer|inflation surprise|war|default|банкрот)\b/gi, 12],
];

const impactTerms: Array<[RegExp, number]> = [
  [/\b(sec|federal reserve|fed|etf|approval|ban|lawsuit|hack|exploit|fomc)\b/gi, 22],
  [/\b(гос|регуля|ставк|инфляц|санкц|взлом|одобр)\b/gi, 18],
  [/\b(record|largest|historic|major|critical|неожидан)\b/gi, 12],
];

const scoreText = (title: string, summary: string): {
  sentiment: SentimentLabel;
  impactScore: number;
  impactDirection: NewsDirection;
} => {
  const text = `${title} ${summary}`;
  let score = 0;
  let impact = 20;
  for (const [pattern, weight] of POSITIVE_TERMS) score += (text.match(pattern) ?? []).length * weight;
  for (const [pattern, weight] of NEGATIVE_TERMS) score -= (text.match(pattern) ?? []).length * weight;
  for (const [pattern, weight] of impactTerms) impact += (text.match(pattern) ?? []).length * weight;
  const normalizedScore = clamp(score, -100, 100);
  const sentiment: SentimentLabel =
    normalizedScore >= 12 ? "positive" : normalizedScore <= -12 ? "negative" : "neutral";
  return {
    sentiment,
    impactScore: clamp(impact, 0, 100),
    impactDirection:
      normalizedScore >= 12 ? "positive" : normalizedScore <= -12 ? "negative" : "neutral",
  };
};

const parseFeed = (source: FeedSource, xml: string): ParsedFeedItem[] => {
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(
    (match) => match[2],
  );
  const now = Date.now();
  const oldestAllowed = now - NEWS_LOOKBACK_MS;
  const parsed: ParsedFeedItem[] = [];
  for (const block of blocks) {
    const title = cleanText(tagValue(block, ["title"]), MAX_TITLE_LENGTH);
    const canonicalUrl = normalizeUrl(linkValue(block), source.url);
    const publishedAt = parseDate(
      tagValue(block, ["pubDate", "published", "updated", "dc:date"]),
    );
    const summary = cleanText(
      tagValue(block, ["description", "summary", "content:encoded", "content"]),
      MAX_SUMMARY_LENGTH,
    );
    if (!title || !canonicalUrl || !publishedAt || publishedAt.getTime() < oldestAllowed) continue;
    const scoring = scoreText(title, summary);
    const category = categoryForText(`${title} ${summary}`);
    const fingerprint = createHash("sha256")
      .update(`${source.name}|${canonicalUrl}|${title}`)
      .digest("hex");
    parsed.push({
      source: source.name,
      sourceUrl: source.url,
      canonicalUrl,
      publishedAt,
      title,
      summary: summary || title,
      category,
      ...scoring,
      fingerprint,
    });
  }
  return parsed;
};

const fetchFeed = async (source: FeedSource): Promise<ParsedFeedItem[]> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NEWS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "user-agent": "MosesMarketSentiment/1.0",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    if (!xml.trim()) throw new Error("пустой ответ");
    return parseFeed(source, xml);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("таймаут источника");
    }
    throw error instanceof Error ? error : new Error("неизвестная ошибка источника");
  } finally {
    clearTimeout(timeout);
  }
};

const fromDbNews = (item: MarketNews): MarketNewsItem => ({
  id: item.id,
  source: item.source,
  sourceUrl: item.sourceUrl,
  canonicalUrl: item.canonicalUrl,
  publishedAt: item.publishedAt.toISOString(),
  title: item.title,
  summary: item.summary,
  category: item.category as NewsCategory,
  sentiment: item.sentiment as SentimentLabel,
  impactScore: Number(item.impactScore),
  impactDirection: item.impactDirection as NewsDirection,
});

const saveNews = async (items: ParsedFeedItem[]): Promise<void> => {
  if (items.length === 0) return;
  await db
    .insert(marketNewsTable)
    .values(
      items.map((item) => ({
        source: item.source,
        sourceUrl: item.sourceUrl,
        canonicalUrl: item.canonicalUrl,
        publishedAt: item.publishedAt,
        title: item.title,
        summary: item.summary,
        category: item.category,
        sentiment: item.sentiment,
        impactScore: item.impactScore.toFixed(4),
        impactDirection: item.impactDirection,
        fingerprint: item.fingerprint,
        fetchedAt: new Date(),
      })),
    )
    .onConflictDoNothing({ target: marketNewsTable.fingerprint });
};

const loadRecentNews = async (): Promise<MarketNewsItem[]> => {
  const cutoff = new Date(Date.now() - NEWS_LOOKBACK_MS);
  const rows = await db
    .select()
    .from(marketNewsTable)
    .where(gte(marketNewsTable.publishedAt, cutoff))
    .orderBy(desc(marketNewsTable.publishedAt))
    .limit(NEWS_LIMIT);
  return rows.map(fromDbNews);
};

const riskForCategory: Record<NewsCategory, string> = {
  regulation: "Регуляторные решения могут быстро изменить доступность инструментов и ликвидность.",
  macro: "Макроэкономические данные и решения по ставкам могут усилить волатильность BTC.",
  etf: "Изменения потоков ETF могут ускорить движение цены и создать риск резкого разворота.",
  bitcoin: "Крупные события вокруг Bitcoin могут привести к повышенной волатильности.",
  crypto: "События крипторынка могут переносить риск между активами и ухудшать ликвидность.",
  market: "Общий рыночный фон может измениться быстрее, чем текущая техническая картина.",
};

const aggregateSentiment = (
  news: MarketNewsItem[],
  sourceStatus: MarketSentiment["sourceStatus"],
): MarketSentiment => {
  const now = Date.now();
  const weights = news.map((item) => {
    const ageRatio = clamp((now - new Date(item.publishedAt).getTime()) / NEWS_LOOKBACK_MS, 0, 1);
    return (0.35 + (1 - ageRatio) * 0.65) * (0.5 + item.impactScore / 200);
  });
  const score = news.length
    ? Math.round(
        clamp(
          news.reduce((sum, item, index) => {
            const itemScore =
              item.sentiment === "positive"
                ? item.impactScore
                : item.sentiment === "negative"
                  ? -item.impactScore
                  : 0;
            return sum + itemScore * weights[index];
          }, 0) / weights.reduce((sum, weight) => sum + weight, 0),
          -100,
          100,
        ),
      )
    : 0;
  const positiveCount = news.filter((item) => item.sentiment === "positive").length;
  const negativeCount = news.filter((item) => item.sentiment === "negative").length;
  const neutralCount = news.length - positiveCount - negativeCount;
  const categoriesWithNegativeNews = [...new Set(
    news
      .filter((item) => item.sentiment === "negative" || item.impactScore >= 75)
      .map((item) => item.category),
  )];
  const risks = categoriesWithNegativeNews.slice(0, 4).map((category) => riskForCategory[category]);
  return {
    label: score >= 20 ? "positive" : score <= -20 ? "negative" : "neutral",
    score,
    newsCount: news.length,
    positiveCount,
    neutralCount,
    negativeCount,
    calculatedAt: new Date().toISOString(),
    lookbackHours: NEWS_LOOKBACK_HOURS,
    topNews: [...news]
      .sort((left, right) => right.impactScore - left.impactScore)
      .slice(0, 5),
    risks: risks.length > 0 ? risks : ["Сильных негативных катализаторов среди доступных новостей не обнаружено."],
    sourceStatus,
  };
};

const saveSentimentHistory = async (sentiment: MarketSentiment): Promise<void> => {
  await db.insert(sentimentHistoryTable).values({
    sentiment: sentiment.label,
    score: sentiment.score.toFixed(4),
    newsCount: sentiment.newsCount,
    positiveCount: sentiment.positiveCount,
    neutralCount: sentiment.neutralCount,
    negativeCount: sentiment.negativeCount,
    lookbackHours: sentiment.lookbackHours,
    risks: sentiment.risks,
    topNews: sentiment.topNews.map((item) => item.id),
    calculatedAt: new Date(sentiment.calculatedAt),
  });
};

export const refreshMarketNews = async (): Promise<{
  news: MarketNewsItem[];
  sourceStatus: MarketSentiment["sourceStatus"];
}> => {
  const results = await Promise.allSettled(FEED_SOURCES.map(fetchFeed));
  const sourceStatus = results.map((result, index) => ({
    source: FEED_SOURCES[index].name,
    ok: result.status === "fulfilled",
    ...(result.status === "rejected"
      ? { error: result.reason instanceof Error ? result.reason.message : "ошибка источника" }
      : {}),
  }));
  const items = results
    .filter((result): result is PromiseFulfilledResult<ParsedFeedItem[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const uniqueItems = [...new Map(items.map((item) => [item.fingerprint, item])).values()];
  await saveNews(uniqueItems);
  const news = await loadRecentNews();
  if (news.length === 0) {
    const sourceErrors = sourceStatus.filter((status) => !status.ok).length;
    throw new MarketSentimentError(
      sourceErrors === FEED_SOURCES.length
        ? "Все источники новостей недоступны, сохранённых свежих данных нет"
        : "Свежих новостей по BTCUSDT не найдено",
      sourceErrors === FEED_SOURCES.length ? "sources" : "empty",
    );
  }
  return { news, sourceStatus };
};

export const getCurrentMarketSentiment = async (): Promise<MarketSentiment> => {
  const { news, sourceStatus } = await refreshMarketNews();
  const sentiment = aggregateSentiment(news, sourceStatus);
  await saveSentimentHistory(sentiment);
  return sentiment;
};

export const getRecentSentimentHistory = async (limit = 5): Promise<SentimentHistory[]> =>
  db
    .select()
    .from(sentimentHistoryTable)
    .orderBy(desc(sentimentHistoryTable.calculatedAt))
    .limit(Math.min(Math.max(limit, 1), 20));

export const getMosesContext = async (timeframe: BtcTimeframe = "4H"): Promise<MarketContext> => {
  const technical = await getBtcMarketAnalysis(timeframe);
  let sentiment: MarketSentiment | null = null;
  let marketIntelligence: MarketIntelligence | null = null;
  try {
    sentiment = await getCurrentMarketSentiment();
  } catch {
    // Technical analysis remains useful when news providers are temporarily unavailable.
  }
  try {
    marketIntelligence = await getMarketIntelligence(timeframe);
  } catch {
    // Technical analysis and news context remain useful when market data providers fail.
  }
  const technicalDirection =
    technical.scenario === "Бычий сценарий"
      ? "positive"
      : technical.scenario === "Медвежий сценарий"
        ? "negative"
        : "neutral";
  const alignment = !sentiment
    ? "Новостной фон недоступен, поэтому согласованность с техникой не оценена."
    : technicalDirection === sentiment.label && technicalDirection !== "neutral"
      ? "Новостной фон совпадает с техническим сценарием и подтверждает его частично."
      : technicalDirection === "neutral" || sentiment.label === "neutral"
        ? "Технический сценарий подтверждается частично, но сильного одностороннего фундаментального фона нет."
        : "Новостной фон расходится с техническим сценарием и повышает риск резкого изменения картины.";
  return { technical, sentiment, marketIntelligence, alignment };
};
