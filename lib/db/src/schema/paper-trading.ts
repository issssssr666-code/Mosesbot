import { createInsertSchema } from "drizzle-zod";
import {
  boolean,
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

export const paperAccountsTable = pgTable("paper_accounts", {
  id: integer("id").primaryKey().default(1),
  initialBalance: numeric("initial_balance", { precision: 20, scale: 8 }).notNull().default("10000"),
  balance: numeric("balance", { precision: 20, scale: 8 }).notNull().default("10000"),
  peakEquity: numeric("peak_equity", { precision: 20, scale: 8 }).notNull().default("10000"),
  maxDrawdown: numeric("max_drawdown", { precision: 20, scale: 8 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paperTradesTable = pgTable(
  "paper_trades",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => paperAccountsTable.id),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    direction: text("direction").notNull(),
    scenario: text("scenario").notNull(),
    signalTime: timestamp("signal_time", { withTimezone: true }).notNull(),
    signalCandleTime: timestamp("signal_candle_time", { withTimezone: true }).notNull(),
    entryMarketPrice: numeric("entry_market_price", { precision: 20, scale: 8 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 20, scale: 8 }).notNull(),
    stopLoss: numeric("stop_loss", { precision: 20, scale: 8 }).notNull(),
    takeProfit1: numeric("take_profit_1", { precision: 20, scale: 8 }).notNull(),
    takeProfit2: numeric("take_profit_2", { precision: 20, scale: 8 }).notNull(),
    quantity: numeric("quantity", { precision: 20, scale: 8 }).notNull(),
    remainingQuantity: numeric("remaining_quantity", { precision: 20, scale: 8 }).notNull(),
    notional: numeric("notional", { precision: 20, scale: 8 }).notNull(),
    commissionRate: numeric("commission_rate", { precision: 12, scale: 8 }).notNull(),
    slippageBps: numeric("slippage_bps", { precision: 12, scale: 4 }).notNull(),
    reason: text("reason").notNull(),
    indicators: jsonb("indicators").$type<Record<string, number | string>>().notNull(),
    status: text("status").notNull().default("open"),
    takeProfit1Hit: boolean("take_profit_1_hit").notNull().default(false),
    takeProfit1HitAt: timestamp("take_profit_1_hit_at", { withTimezone: true }),
    takeProfit1ExitPrice: numeric("take_profit_1_exit_price", { precision: 20, scale: 8 }),
    exitTime: timestamp("exit_time", { withTimezone: true }),
    exitPrice: numeric("exit_price", { precision: 20, scale: 8 }),
    exitReason: text("exit_reason"),
    grossPnl: numeric("gross_pnl", { precision: 20, scale: 8 }).notNull().default("0"),
    fees: numeric("fees", { precision: 20, scale: 8 }).notNull().default("0"),
    slippageCost: numeric("slippage_cost", { precision: 20, scale: 8 }).notNull().default("0"),
    netPnl: numeric("net_pnl", { precision: 20, scale: 8 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    signalIdentity: uniqueIndex("paper_trade_signal_identity").on(
      table.accountId,
      table.timeframe,
      table.signalCandleTime,
      table.scenario,
    ),
  }),
);

export const paperAlertRecipientsTable = pgTable("paper_alert_recipients", {
  accountId: integer("account_id").primaryKey().references(() => paperAccountsTable.id),
  chatId: text("chat_id").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const paperAlertEventsTable = pgTable(
  "paper_alert_events",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => paperAccountsTable.id),
    tradeId: integer("trade_id").notNull().references(() => paperTradesTable.id),
    eventType: text("event_type").notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    direction: text("direction").notNull(),
    scenario: text("scenario").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, number | string | null>>()
      .notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIdentity: uniqueIndex("paper_alert_event_identity").on(
      table.accountId,
      table.tradeId,
      table.eventType,
    ),
    pendingEvents: index("paper_alert_pending_events").on(table.status, table.nextAttemptAt),
  }),
);

export const paperTradeJournalsTable = pgTable(
  "paper_trade_journals",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => paperAccountsTable.id),
    tradeId: integer("trade_id").notNull().references(() => paperTradesTable.id),
    entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
    exitTime: timestamp("exit_time", { withTimezone: true }).notNull(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    direction: text("direction").notNull(),
    scenario: text("scenario").notNull(),
    entryReason: text("entry_reason").notNull(),
    ema21: numeric("ema21", { precision: 20, scale: 8 }).notNull(),
    ema50: numeric("ema50", { precision: 20, scale: 8 }).notNull(),
    rsi14: numeric("rsi14", { precision: 12, scale: 8 }).notNull(),
    macd: numeric("macd", { precision: 20, scale: 8 }).notNull(),
    macdSignal: numeric("macd_signal", { precision: 20, scale: 8 }).notNull(),
    macdHistogram: numeric("macd_histogram", { precision: 20, scale: 8 }).notNull(),
    candleVolume: numeric("candle_volume", { precision: 30, scale: 8 }).notNull(),
    averageVolume20: numeric("average_volume_20", { precision: 30, scale: 8 }).notNull(),
    volumeRatio20: numeric("volume_ratio_20", { precision: 12, scale: 8 }).notNull(),
    support: numeric("support", { precision: 20, scale: 8 }).notNull(),
    resistance: numeric("resistance", { precision: 20, scale: 8 }).notNull(),
    result: text("result").notNull(),
    pnl: numeric("pnl", { precision: 20, scale: 8 }).notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    rMultiple: numeric("r_multiple", { precision: 20, scale: 8 }).notNull(),
    confirmedFactors: jsonb("confirmed_factors").$type<string[]>().notNull(),
    errorFactors: jsonb("error_factors").$type<string[]>().notNull(),
    tradeClass: text("trade_class").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tradeIdentity: uniqueIndex("paper_trade_journal_trade_identity").on(table.tradeId),
    accountCreatedAt: index("paper_trade_journal_account_created_at").on(
      table.accountId,
      table.createdAt,
    ),
  }),
);

export const backtestRunsTable = pgTable(
  "backtest_runs",
  {
    id: serial("id").primaryKey(),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    candleCount: integer("candle_count").notNull(),
    signalCount: integer("signal_count").notNull(),
    tradeCount: integer("trade_count").notNull(),
    longTradeCount: integer("long_trade_count").notNull(),
    shortTradeCount: integer("short_trade_count").notNull(),
    profitableTradeCount: integer("profitable_trade_count").notNull(),
    losingTradeCount: integer("losing_trade_count").notNull(),
    winRate: numeric("win_rate", { precision: 12, scale: 8 }).notNull(),
    totalPnl: numeric("total_pnl", { precision: 20, scale: 8 }).notNull(),
    maxDrawdown: numeric("max_drawdown", { precision: 20, scale: 8 }).notNull(),
    profitFactor: numeric("profit_factor", { precision: 20, scale: 8 }),
    expectancy: numeric("expectancy", { precision: 20, scale: 8 }).notNull(),
    averageDurationSeconds: integer("average_duration_seconds").notNull(),
    averageRMultiple: numeric("average_r_multiple", { precision: 20, scale: 8 }).notNull(),
    initialBalance: numeric("initial_balance", { precision: 20, scale: 8 }).notNull(),
    finalBalance: numeric("final_balance", { precision: 20, scale: 8 }).notNull(),
    report: jsonb("report").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    timeframeCreatedAt: index("backtest_runs_timeframe_created_at").on(
      table.timeframe,
      table.createdAt,
    ),
  }),
);

export const paperScenarioObservationsTable = pgTable(
  "paper_scenario_observations",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id").notNull().references(() => paperAccountsTable.id),
    symbol: text("symbol").notNull(),
    timeframe: text("timeframe").notNull(),
    direction: text("direction"),
    scenario: text("scenario").notNull(),
    signalCandleTime: timestamp("signal_candle_time", { withTimezone: true }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scenarioIdentity: uniqueIndex("paper_scenario_observation_identity").on(
      table.accountId,
      table.timeframe,
      table.signalCandleTime,
      table.scenario,
    ),
  }),
);

export const insertPaperAccountSchema = createInsertSchema(paperAccountsTable);
export const insertPaperTradeSchema = createInsertSchema(paperTradesTable).omit({
  id: true,
  createdAt: true,
});
export const insertPaperScenarioObservationSchema = createInsertSchema(
  paperScenarioObservationsTable,
).omit({
  id: true,
  observedAt: true,
});
export const insertPaperAlertRecipientSchema = createInsertSchema(
  paperAlertRecipientsTable,
);
export const insertPaperAlertEventSchema = createInsertSchema(paperAlertEventsTable).omit({
  id: true,
  createdAt: true,
});
export const insertPaperTradeJournalSchema = createInsertSchema(paperTradeJournalsTable).omit({
  id: true,
  createdAt: true,
});
export const insertBacktestRunSchema = createInsertSchema(backtestRunsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPaperAccount = z.infer<typeof insertPaperAccountSchema>;
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type InsertPaperScenarioObservation = z.infer<
  typeof insertPaperScenarioObservationSchema
>;
export type InsertPaperAlertRecipient = z.infer<typeof insertPaperAlertRecipientSchema>;
export type InsertPaperAlertEvent = z.infer<typeof insertPaperAlertEventSchema>;
export type InsertPaperTradeJournal = z.infer<typeof insertPaperTradeJournalSchema>;
export type InsertBacktestRun = z.infer<typeof insertBacktestRunSchema>;
export type PaperAccount = typeof paperAccountsTable.$inferSelect;
export type PaperTrade = typeof paperTradesTable.$inferSelect;
export type PaperScenarioObservation = typeof paperScenarioObservationsTable.$inferSelect;
export type PaperAlertRecipient = typeof paperAlertRecipientsTable.$inferSelect;
export type PaperAlertEvent = typeof paperAlertEventsTable.$inferSelect;
export type PaperTradeJournal = typeof paperTradeJournalsTable.$inferSelect;
export type BacktestRun = typeof backtestRunsTable.$inferSelect;