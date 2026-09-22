import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const marketMetricsTable = pgTable(
  "market_metrics",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull().default("BTCUSDT"),
    timeframe: text("timeframe").notNull(),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull().defaultNow(),
    signalCandleTime: timestamp("signal_candle_time", { withTimezone: true }).notNull(),
    price: numeric("price", { precision: 20, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 24, scale: 8 }).notNull(),
    averageVolume: numeric("average_volume", { precision: 24, scale: 8 }).notNull(),
    volumeRatio: numeric("volume_ratio", { precision: 12, scale: 6 }).notNull(),
    atr: numeric("atr", { precision: 20, scale: 8 }).notNull(),
    volatilityPercent: numeric("volatility_percent", { precision: 12, scale: 6 }).notNull(),
    openInterest: numeric("open_interest", { precision: 24, scale: 8 }),
    fundingRate: numeric("funding_rate", { precision: 16, scale: 10 }),
    longShortRatio: numeric("long_short_ratio", { precision: 16, scale: 8 }),
    longLiquidationsUsd: numeric("long_liquidations_usd", { precision: 24, scale: 8 }),
    shortLiquidationsUsd: numeric("short_liquidations_usd", { precision: 24, scale: 8 }),
    pressureScore: integer("pressure_score").notNull(),
    behavior: text("behavior").notNull(),
    sources: jsonb("sources").$type<{ source: string; ok: boolean; error?: string }[]>().notNull(),
  },
  (table) => ({
    signalIdentity: uniqueIndex("market_metrics_signal_identity").on(
      table.symbol,
      table.timeframe,
      table.signalCandleTime,
    ),
    measuredAtIndex: index("market_metrics_measured_at").on(table.measuredAt),
  }),
);

export const insertMarketMetricSchema = createInsertSchema(marketMetricsTable).omit({
  id: true,
  measuredAt: true,
});

export type InsertMarketMetric = z.infer<typeof insertMarketMetricSchema>;
export type MarketMetric = typeof marketMetricsTable.$inferSelect;