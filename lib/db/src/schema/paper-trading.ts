import { createInsertSchema } from "drizzle-zod";
import { integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
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

export const insertPaperAccountSchema = createInsertSchema(paperAccountsTable);
export const insertPaperTradeSchema = createInsertSchema(paperTradesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPaperAccount = z.infer<typeof insertPaperAccountSchema>;
export type InsertPaperTrade = z.infer<typeof insertPaperTradeSchema>;
export type PaperAccount = typeof paperAccountsTable.$inferSelect;
export type PaperTrade = typeof paperTradesTable.$inferSelect;