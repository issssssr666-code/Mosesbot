import { and, desc, eq } from "drizzle-orm";
import {
  db,
  paperAccountsTable,
  paperTradesTable,
  type PaperAccount,
  type PaperTrade,
} from "@workspace/db";
import {
  getBtcMarketAnalysis,
  type BtcMarketAnalysis,
  type BtcTimeframe,
} from "./btc-market-analysis";
import { logger } from "./logger";

const ACCOUNT_ID = 1;
const INITIAL_BALANCE = 10_000;
const POSITION_NOTIONAL_FRACTION = 0.1;
const COMMISSION_RATE = 0.001;
const SLIPPAGE_BPS = 5;
const SLIPPAGE_RATE = SLIPPAGE_BPS / 10_000;
const MONITOR_INTERVAL_MS = 60_000;
const TIMEFRAMES: BtcTimeframe[] = ["1H", "4H", "1D", "1W"];
const EPSILON = 0.00000001;

export type PaperTradeView = {
  id: number;
  status: string;
  symbol: string;
  timeframe: string;
  direction: string;
  scenario: string;
  signalTime: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  exitPrice: number | null;
  exitReason: string | null;
  netPnl: number;
};

export type PaperAccountSnapshot = {
  balance: number;
  equity: number;
  unrealizedPnl: number;
  openPositions: PaperTradeView[];
  recentTrades: PaperTradeView[];
  stats: {
    tradeCount: number;
    closedTradeCount: number;
    profitableTradeCount: number;
    losingTradeCount: number;
    realizedPnl: number;
    winRate: number;
    averageResult: number;
    maxDrawdown: number;
    profitFactor: number | null;
    expectancy: number;
  };
};

const numberValue = (value: string | number | null | undefined): number =>
  value == null ? 0 : Number(value);

const fixed = (value: number): string => value.toFixed(8);

const tradeView = (trade: PaperTrade): PaperTradeView => ({
  id: trade.id,
  status: trade.status,
  symbol: trade.symbol,
  timeframe: trade.timeframe,
  direction: trade.direction,
  scenario: trade.scenario,
  signalTime: trade.signalTime.toISOString(),
  entryPrice: numberValue(trade.entryPrice),
  stopLoss: numberValue(trade.stopLoss),
  takeProfit1: numberValue(trade.takeProfit1),
  takeProfit2: numberValue(trade.takeProfit2),
  exitPrice: trade.exitPrice == null ? null : numberValue(trade.exitPrice),
  exitReason: trade.exitReason,
  netPnl: numberValue(trade.netPnl),
});

const ensurePaperAccount = async (): Promise<PaperAccount> => {
  const existing = await db
    .select()
    .from(paperAccountsTable)
    .where(eq(paperAccountsTable.id, ACCOUNT_ID))
    .limit(1);
  if (existing[0]) return existing[0];

  const inserted = await db
    .insert(paperAccountsTable)
    .values({
      id: ACCOUNT_ID,
      initialBalance: fixed(INITIAL_BALANCE),
      balance: fixed(INITIAL_BALANCE),
      peakEquity: fixed(INITIAL_BALANCE),
      maxDrawdown: "0",
    })
    .onConflictDoNothing({ target: paperAccountsTable.id })
    .returning();
  if (inserted[0]) return inserted[0];

  const createdByAnotherRequest = await db
    .select()
    .from(paperAccountsTable)
    .where(eq(paperAccountsTable.id, ACCOUNT_ID))
    .limit(1);
  if (!createdByAnotherRequest[0]) {
    throw new Error("Не удалось создать виртуальный счёт");
  }
  return createdByAnotherRequest[0];
};

const getOpenTrades = async (timeframe?: BtcTimeframe): Promise<PaperTrade[]> => {
  const conditions = [eq(paperTradesTable.accountId, ACCOUNT_ID), eq(paperTradesTable.status, "open")];
  if (timeframe) conditions.push(eq(paperTradesTable.timeframe, timeframe));
  return db
    .select()
    .from(paperTradesTable)
    .where(and(...conditions))
    .orderBy(desc(paperTradesTable.id));
};

const getAllTrades = async (): Promise<PaperTrade[]> =>
  db
    .select()
    .from(paperTradesTable)
    .where(eq(paperTradesTable.accountId, ACCOUNT_ID))
    .orderBy(desc(paperTradesTable.id));

const directionForScenario = (scenario: string): "LONG" | "SHORT" | null =>
  scenario === "Бычий сценарий" ? "LONG" : scenario === "Медвежий сценарий" ? "SHORT" : null;

const buildSignal = (
  analysis: BtcMarketAnalysis,
  balance: number,
): {
  direction: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  quantity: number;
  notional: number;
  reason: string;
} | null => {
  const direction = directionForScenario(analysis.scenario);
  if (!direction || balance <= 0) return null;

  const marketPrice = analysis.market.price;
  const entryPrice =
    direction === "LONG" ? marketPrice * (1 + SLIPPAGE_RATE) : marketPrice * (1 - SLIPPAGE_RATE);
  const stopLoss = direction === "LONG" ? analysis.levels.support : analysis.levels.resistance;
  const risk = direction === "LONG" ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (risk <= 0) return null;

  const takeProfit1 = direction === "LONG" ? entryPrice + risk : entryPrice - risk;
  const takeProfit2 = direction === "LONG" ? entryPrice + risk * 2 : entryPrice - risk * 2;
  if (takeProfit2 <= 0) return null;

  const notional = balance * POSITION_NOTIONAL_FRACTION;
  const quantity = notional / entryPrice;
  const reason = [
    `Тренд: ${analysis.analysis.trend.reason}`,
    `Импульс: ${analysis.analysis.impulse.reason}`,
    `Объём: ${analysis.analysis.volume.reason}`,
    `Уровни: ${analysis.analysis.levels.reason}`,
    `Сценарий: ${analysis.analysis.scenario.reason}`,
    `Вход виртуальный с проскальзыванием ${SLIPPAGE_BPS} bps; размер позиции — ${(POSITION_NOTIONAL_FRACTION * 100).toFixed(0)}% баланса.`,
  ].join(" ");
  return { direction, entryPrice, stopLoss, takeProfit1, takeProfit2, quantity, notional, reason };
};

const createSignalIfEligible = async (
  account: PaperAccount,
  analysis: BtcMarketAnalysis,
): Promise<void> => {
  const direction = directionForScenario(analysis.scenario);
  if (!direction) return;

  const openTrades = await getOpenTrades(analysis.timeframe);
  if (openTrades.length > 0) return;

  const signal = buildSignal(analysis, numberValue(account.balance));
  if (!signal) return;

  const duplicate = await db
    .select({ id: paperTradesTable.id })
    .from(paperTradesTable)
    .where(
      and(
        eq(paperTradesTable.accountId, ACCOUNT_ID),
        eq(paperTradesTable.timeframe, analysis.timeframe),
        eq(paperTradesTable.signalCandleTime, new Date(analysis.signalCandleTime)),
        eq(paperTradesTable.scenario, analysis.scenario),
      ),
    )
    .limit(1);
  if (duplicate[0]) return;

  await db.insert(paperTradesTable).values({
    accountId: ACCOUNT_ID,
    symbol: analysis.symbol,
    timeframe: analysis.timeframe,
    direction: signal.direction,
    scenario: analysis.scenario,
    signalTime: new Date(),
    signalCandleTime: new Date(analysis.signalCandleTime),
    entryMarketPrice: fixed(analysis.market.price),
    entryPrice: fixed(signal.entryPrice),
    stopLoss: fixed(signal.stopLoss),
    takeProfit1: fixed(signal.takeProfit1),
    takeProfit2: fixed(signal.takeProfit2),
    quantity: fixed(signal.quantity),
    remainingQuantity: fixed(signal.quantity),
    notional: fixed(signal.notional),
    commissionRate: fixed(COMMISSION_RATE),
    slippageBps: fixed(SLIPPAGE_BPS),
    reason: signal.reason,
    indicators: {
      ema21: analysis.indicators.ema21,
      ema50: analysis.indicators.ema50,
      rsi14: analysis.indicators.rsi14,
      macd: analysis.indicators.macd,
      signal: analysis.indicators.signal,
      histogram: analysis.indicators.histogram,
      candleVolume: analysis.indicators.candleVolume,
      averageVolume20: analysis.indicators.averageVolume20,
      volumeRatio20: analysis.indicators.volumeRatio20,
      support: analysis.levels.support,
      resistance: analysis.levels.resistance,
      signalPrice: analysis.market.price,
    },
  });
  logger.info(
    { timeframe: analysis.timeframe, direction: signal.direction, scenario: analysis.scenario },
    "Paper trading signal opened",
  );
};

const positionPnl = (
  trade: PaperTrade,
  marketPrice: number,
  quantity: number,
): { gross: number; fees: number; slippageCost: number; net: number; exitPrice: number } => {
  const direction = trade.direction === "LONG" ? "LONG" : "SHORT";
  const entryPrice = numberValue(trade.entryPrice);
  const marketEntryPrice = numberValue(trade.entryMarketPrice);
  const exitPrice =
    direction === "LONG" ? marketPrice * (1 - SLIPPAGE_RATE) : marketPrice * (1 + SLIPPAGE_RATE);
  const gross =
    direction === "LONG"
      ? (exitPrice - entryPrice) * quantity
      : (entryPrice - exitPrice) * quantity;
  const fees =
    (entryPrice * quantity + exitPrice * quantity) * numberValue(trade.commissionRate);
  const slippageCost =
    Math.abs(entryPrice - marketEntryPrice) * quantity +
    Math.abs(exitPrice - marketPrice) * quantity;
  return { gross, fees, slippageCost, net: gross - fees, exitPrice };
};

const applyClose = async (
  account: PaperAccount,
  trade: PaperTrade,
  marketPrice: number,
  quantity: number,
  reason: string,
  isTakeProfit1 = false,
): Promise<PaperTrade> => {
  const pnl = positionPnl(trade, marketPrice, quantity);
  const remaining = Math.max(numberValue(trade.remainingQuantity) - quantity, 0);
  const grossPnl = numberValue(trade.grossPnl) + pnl.gross;
  const fees = numberValue(trade.fees) + pnl.fees;
  const slippageCost = numberValue(trade.slippageCost) + pnl.slippageCost;
  const netPnl = numberValue(trade.netPnl) + pnl.net;
  const isClosed = remaining <= EPSILON || reason === "TP2" || reason === "SL" || reason === "SCENARIO_CANCELLED";
  const [updated] = await db
    .update(paperTradesTable)
    .set({
      remainingQuantity: fixed(remaining),
      takeProfit1Hit: isTakeProfit1 ? true : trade.takeProfit1Hit,
      takeProfit1HitAt: isTakeProfit1 ? new Date() : trade.takeProfit1HitAt,
      takeProfit1ExitPrice: isTakeProfit1 ? fixed(pnl.exitPrice) : trade.takeProfit1ExitPrice,
      status: isClosed ? "closed" : "open",
      exitTime: isClosed ? new Date() : trade.exitTime,
      exitPrice: isClosed ? fixed(pnl.exitPrice) : trade.exitPrice,
      exitReason: isClosed ? reason : trade.exitReason,
      grossPnl: fixed(grossPnl),
      fees: fixed(fees),
      slippageCost: fixed(slippageCost),
      netPnl: fixed(netPnl),
    })
    .where(eq(paperTradesTable.id, trade.id))
    .returning();

  const nextBalance = numberValue(account.balance) + pnl.net;
  await db
    .update(paperAccountsTable)
    .set({ balance: fixed(nextBalance), updatedAt: new Date() })
    .where(eq(paperAccountsTable.id, ACCOUNT_ID));
  return updated;
};

const evaluateOpenTrade = async (
  account: PaperAccount,
  trade: PaperTrade,
  analysis: BtcMarketAnalysis,
): Promise<void> => {
  const price = analysis.market.price;
  const stopHit =
    trade.direction === "LONG"
      ? price <= numberValue(trade.stopLoss)
      : price >= numberValue(trade.stopLoss);
  if (stopHit) {
    await applyClose(account, trade, price, numberValue(trade.remainingQuantity), "SL");
    return;
  }

  let current = trade;
  const tp1Hit =
    !current.takeProfit1Hit &&
    (current.direction === "LONG"
      ? price >= numberValue(current.takeProfit1)
      : price <= numberValue(current.takeProfit1));
  if (tp1Hit) {
    current = await applyClose(
      account,
      current,
      price,
      numberValue(current.remainingQuantity) / 2,
      "TP1",
      true,
    );
  }

  const tp2Hit =
    current.direction === "LONG"
      ? price >= numberValue(current.takeProfit2)
      : price <= numberValue(current.takeProfit2);
  if (tp2Hit && current.status === "open") {
    await applyClose(account, current, price, numberValue(current.remainingQuantity), "TP2");
    return;
  }

  const expectedDirection = directionForScenario(analysis.scenario);
  if (expectedDirection && expectedDirection !== current.direction && current.status === "open") {
    await applyClose(
      account,
      current,
      price,
      numberValue(current.remainingQuantity),
      "SCENARIO_CANCELLED",
    );
  }
};

const updateDrawdown = async (account: PaperAccount, analyses: BtcMarketAnalysis[]): Promise<void> => {
  const openTrades = await getOpenTrades();
  const prices = new Map<string, number>(
    analyses.map((analysis) => [analysis.timeframe, analysis.market.price]),
  );
  const unrealizedPnl = openTrades.reduce((sum, trade) => {
    const price = prices.get(trade.timeframe);
    if (price == null) return sum;
    return sum + positionPnl(trade, price, numberValue(trade.remainingQuantity)).net;
  }, 0);
  const equity = numberValue(account.balance) + unrealizedPnl;
  const peakEquity = Math.max(numberValue(account.peakEquity), equity);
  const maxDrawdown = Math.max(numberValue(account.maxDrawdown), peakEquity - equity);
  await db
    .update(paperAccountsTable)
    .set({ peakEquity: fixed(peakEquity), maxDrawdown: fixed(maxDrawdown), updatedAt: new Date() })
    .where(eq(paperAccountsTable.id, ACCOUNT_ID));
};

let refreshPromise: Promise<void> | null = null;

export const refreshPaperTrading = async (): Promise<void> => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const account = await ensurePaperAccount();
    const analyses: BtcMarketAnalysis[] = [];
    for (const timeframe of TIMEFRAMES) {
      try {
        const analysis = await getBtcMarketAnalysis(timeframe);
        analyses.push(analysis);
        const openTrades = await getOpenTrades(timeframe);
        for (const trade of openTrades) {
          await evaluateOpenTrade(account, trade, analysis);
        }
        const refreshedAccount = await ensurePaperAccount();
        await createSignalIfEligible(refreshedAccount, analysis);
      } catch (error) {
        logger.warn(
          { timeframe, error: error instanceof Error ? error.message : error },
          "Paper trading timeframe refresh failed",
        );
      }
    }
    await updateDrawdown(await ensurePaperAccount(), analyses);
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
};

export const getPaperAccountSnapshot = async (): Promise<PaperAccountSnapshot> => {
  const account = await ensurePaperAccount();
  const trades = await getAllTrades();
  const openPositions = trades.filter((trade) => trade.status === "open");
  const closedTrades = trades.filter((trade) => trade.status === "closed");
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const profitableTrades = closedTrades.filter((trade) => numberValue(trade.netPnl) > 0);
  const losingTrades = closedTrades.filter((trade) => numberValue(trade.netPnl) < 0);
  const grossProfit = profitableTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const grossLoss = losingTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const averageResult = closedTrades.length > 0 ? realizedPnl / closedTrades.length : 0;
  const winRate = closedTrades.length > 0 ? (profitableTrades.length / closedTrades.length) * 100 : 0;

  return {
    balance: numberValue(account.balance),
    equity: numberValue(account.balance),
    unrealizedPnl: 0,
    openPositions: openPositions.map(tradeView),
    recentTrades: trades.slice(0, 10).map(tradeView),
    stats: {
      tradeCount: trades.length,
      closedTradeCount: closedTrades.length,
      profitableTradeCount: profitableTrades.length,
      losingTradeCount: losingTrades.length,
      realizedPnl,
      winRate,
      averageResult,
      maxDrawdown: numberValue(account.maxDrawdown),
      profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
      expectancy: averageResult,
    },
  };
};

export const startPaperTrading = (): (() => void) => {
  let stopped = false;
  void refreshPaperTrading().catch((error) => {
    logger.error({ error }, "Initial paper trading refresh failed");
  });
  const interval = setInterval(() => {
    if (!stopped) {
      void refreshPaperTrading().catch((error) => {
        logger.error({ error }, "Scheduled paper trading refresh failed");
      });
    }
  }, MONITOR_INTERVAL_MS);
  logger.info("Paper trading monitor started");
  return () => {
    stopped = true;
    clearInterval(interval);
    logger.info("Paper trading monitor stopped");
  };
};