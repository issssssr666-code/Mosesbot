import { desc, eq } from "drizzle-orm";
import {
  backtestRunsTable,
  db,
  type BacktestRun,
} from "@workspace/db";
import {
  buildBtcStrategySnapshot,
  calculateTechnicalPoints,
  getBtcHistoricalCandles,
  type BtcStrategySnapshot,
  type BtcTimeframe,
  type BinanceKline,
} from "./btc-market-analysis";

const INITIAL_BALANCE = 10_000;
const POSITION_NOTIONAL_FRACTION = 0.1;
const COMMISSION_RATE = 0.001;
const SLIPPAGE_BPS = 5;
const SLIPPAGE_RATE = SLIPPAGE_BPS / 10_000;
const BACKTEST_DAYS = 180;
const MAX_CANDLES_PER_REQUEST = 1000;
const EPSILON = 0.00000001;
const MIN_CANDLES = 80;
const DAY_MS = 24 * 60 * 60 * 1000;

type BacktestDirection = "LONG" | "SHORT";

export type BacktestTrade = {
  direction: BacktestDirection;
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  exitReason: string;
  pnl: number;
  rMultiple: number;
  durationSeconds: number;
};

export type BacktestReport = {
  symbol: "BTCUSDT";
  timeframe: BtcTimeframe;
  periodStart: string;
  periodEnd: string;
  candleCount: number;
  signalCount: number;
  tradeCount: number;
  longTradeCount: number;
  shortTradeCount: number;
  profitableTradeCount: number;
  losingTradeCount: number;
  winRate: number;
  totalPnl: number;
  maxDrawdown: number;
  profitFactor: number | null;
  expectancy: number;
  averageDurationSeconds: number;
  averageRMultiple: number;
  initialBalance: number;
  finalBalance: number;
  trades: BacktestTrade[];
};

type OpenBacktestPosition = {
  direction: BacktestDirection;
  entryTime: Date;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  quantity: number;
  remainingQuantity: number;
  initialRiskAmount: number;
  takeProfit1Hit: boolean;
  netPnl: number;
  entrySignalIndex: number;
};

type BacktestCandle = {
  openTime: number;
  closeTime: number;
  open: number;
  close: number;
  high: number;
  low: number;
};

const fixed = (value: number): string => value.toFixed(8);

const numberValue = (value: string | number | null | undefined): number =>
  value == null ? 0 : Number(value);

const directionForScenario = (scenario: string): BacktestDirection | null =>
  scenario === "Бычий сценарий" ? "LONG" : scenario === "Медвежий сценарий" ? "SHORT" : null;

const toCandle = (candle: BinanceKline): BacktestCandle => ({
  openTime: candle[0],
  closeTime: candle[6],
  open: Number(candle[1]),
  close: Number(candle[4]),
  high: Number(candle[2]),
  low: Number(candle[3]),
});

const fetchHistoricalCandles = async (timeframe: BtcTimeframe): Promise<BinanceKline[]> => {
  const endTime = Date.now();
  const startTime = endTime - BACKTEST_DAYS * DAY_MS;
  const candles = new Map<number, BinanceKline>();
  let cursor = startTime;

  while (cursor < endTime) {
    const batch = await getBtcHistoricalCandles(
      timeframe,
      cursor,
      endTime,
      MAX_CANDLES_PER_REQUEST,
    );
    if (batch.length === 0) break;
    for (const candle of batch) {
      if (candle[6] <= endTime) candles.set(candle[0], candle);
    }
    const last = batch.at(-1);
    if (!last || last[0] < cursor || batch.length < MAX_CANDLES_PER_REQUEST) break;
    cursor = last[6] + 1;
  }

  const result = [...candles.values()].sort((left, right) => left[0] - right[0]);
  if (result.length < MIN_CANDLES) {
    throw new Error(
      `Недостаточно исторических данных Binance: получено ${result.length} свечей, нужно минимум ${MIN_CANDLES}`,
    );
  }
  return result;
};

const exitPriceForMarket = (position: OpenBacktestPosition, marketPrice: number): number =>
  position.direction === "LONG"
    ? marketPrice * (1 - SLIPPAGE_RATE)
    : marketPrice * (1 + SLIPPAGE_RATE);

const pnlForMarket = (
  position: OpenBacktestPosition,
  marketPrice: number,
  quantity: number,
): number => {
  const exitPrice = exitPriceForMarket(position, marketPrice);
  const gross =
    position.direction === "LONG"
      ? (exitPrice - position.entryPrice) * quantity
      : (position.entryPrice - exitPrice) * quantity;
  const fees =
    (position.entryPrice * quantity + exitPrice * quantity) * COMMISSION_RATE;
  return gross - fees;
};

const buildSignal = (
  snapshot: BtcStrategySnapshot,
  nextCandle: BacktestCandle,
  balance: number,
): {
  direction: BacktestDirection;
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  quantity: number;
  initialRiskAmount: number;
} | null => {
  const direction = directionForScenario(snapshot.scenario);
  if (!direction || balance <= 0) return null;
  const entryMarketPrice = nextCandle.open;
  const entryPrice =
    direction === "LONG"
      ? entryMarketPrice * (1 + SLIPPAGE_RATE)
      : entryMarketPrice * (1 - SLIPPAGE_RATE);
  const stopLoss = direction === "LONG" ? snapshot.support : snapshot.resistance;
  const risk = direction === "LONG" ? entryPrice - stopLoss : stopLoss - entryPrice;
  if (risk <= 0) return null;
  const takeProfit1 = direction === "LONG" ? entryPrice + risk : entryPrice - risk;
  const takeProfit2 = direction === "LONG" ? entryPrice + risk * 2 : entryPrice - risk * 2;
  if (takeProfit2 <= 0) return null;
  const notional = balance * POSITION_NOTIONAL_FRACTION;
  const quantity = notional / entryPrice;
  return {
    direction,
    entryPrice,
    stopLoss,
    takeProfit1,
    takeProfit2,
    quantity,
    initialRiskAmount: risk * quantity,
  };
};

const applyExit = (
  position: OpenBacktestPosition,
  marketPrice: number,
  quantity: number,
  reason: string,
  exitTime: Date,
  balance: number,
): { balance: number; position: OpenBacktestPosition | null; trade?: BacktestTrade } => {
  const exitPrice = exitPriceForMarket(position, marketPrice);
  const pnl = pnlForMarket(position, marketPrice, quantity);
  const remainingQuantity = Math.max(position.remainingQuantity - quantity, 0);
  const nextBalance = balance + pnl;
  const nextPnl = position.netPnl + pnl;
  if (remainingQuantity > EPSILON && reason === "TP1") {
    return {
      balance: nextBalance,
      position: {
        ...position,
        remainingQuantity,
        takeProfit1Hit: true,
        netPnl: nextPnl,
      },
    };
  }
  return {
    balance: nextBalance,
    position: null,
    trade: {
      direction: position.direction,
      entryTime: position.entryTime.toISOString(),
      exitTime: exitTime.toISOString(),
      entryPrice: position.entryPrice,
      exitPrice,
      exitReason: reason,
      pnl: nextPnl,
      rMultiple:
        position.initialRiskAmount > EPSILON
          ? nextPnl / position.initialRiskAmount
          : 0,
      durationSeconds: Math.max(
        0,
        Math.round((exitTime.getTime() - position.entryTime.getTime()) / 1000),
      ),
    },
  };
};

const closePositionOnCandle = (
  position: OpenBacktestPosition,
  candle: BacktestCandle,
  balance: number,
): { balance: number; position: OpenBacktestPosition | null; trades: BacktestTrade[] } => {
  let currentPosition = position;
  let currentBalance = balance;
  const trades: BacktestTrade[] = [];
  const stopHit =
    currentPosition.direction === "LONG"
      ? candle.low <= currentPosition.stopLoss
      : candle.high >= currentPosition.stopLoss;
  if (stopHit) {
    const exit = applyExit(
      currentPosition,
      currentPosition.stopLoss,
      currentPosition.remainingQuantity,
      "SL",
      new Date(candle.closeTime),
      currentBalance,
    );
    return {
      balance: exit.balance,
      position: exit.position,
      trades: exit.trade ? [exit.trade] : [],
    };
  }

  const tp1Hit =
    !currentPosition.takeProfit1Hit &&
    (currentPosition.direction === "LONG"
      ? candle.high >= currentPosition.takeProfit1
      : candle.low <= currentPosition.takeProfit1);
  if (tp1Hit) {
    const exit = applyExit(
      currentPosition,
      currentPosition.takeProfit1,
      currentPosition.remainingQuantity / 2,
      "TP1",
      new Date(candle.closeTime),
      currentBalance,
    );
    currentBalance = exit.balance;
    currentPosition = exit.position as OpenBacktestPosition;
  }

  const tp2Hit =
    currentPosition.direction === "LONG"
      ? candle.high >= currentPosition.takeProfit2
      : candle.low <= currentPosition.takeProfit2;
  if (tp2Hit) {
    const exit = applyExit(
      currentPosition,
      currentPosition.takeProfit2,
      currentPosition.remainingQuantity,
      "TP2",
      new Date(candle.closeTime),
      currentBalance,
    );
    currentBalance = exit.balance;
    if (exit.trade) trades.push(exit.trade);
    return { balance: currentBalance, position: exit.position, trades };
  }

  return { balance: currentBalance, position: currentPosition, trades };
};

const buildReport = (
  timeframe: BtcTimeframe,
  candles: BacktestCandle[],
  signalCount: number,
  trades: BacktestTrade[],
  maxDrawdown: number,
  finalBalance: number,
): BacktestReport => {
  const profitable = trades.filter((trade) => trade.pnl > EPSILON);
  const losing = trades.filter((trade) => trade.pnl < -EPSILON);
  const totalPnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossProfit = profitable.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = losing.reduce((sum, trade) => sum + trade.pnl, 0);
  return {
    symbol: "BTCUSDT",
    timeframe,
    periodStart: new Date(candles[0].openTime).toISOString(),
    periodEnd: new Date(candles.at(-1)?.closeTime ?? candles[0].closeTime).toISOString(),
    candleCount: candles.length,
    signalCount,
    tradeCount: trades.length,
    longTradeCount: trades.filter((trade) => trade.direction === "LONG").length,
    shortTradeCount: trades.filter((trade) => trade.direction === "SHORT").length,
    profitableTradeCount: profitable.length,
    losingTradeCount: losing.length,
    winRate: trades.length > 0 ? (profitable.length / trades.length) * 100 : 0,
    totalPnl,
    maxDrawdown,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : null,
    expectancy: trades.length > 0 ? totalPnl / trades.length : 0,
    averageDurationSeconds:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.durationSeconds, 0) / trades.length
        : 0,
    averageRMultiple:
      trades.length > 0
        ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length
        : 0,
    initialBalance: INITIAL_BALANCE,
    finalBalance,
    trades,
  };
};

const saveBacktestReport = async (report: BacktestReport): Promise<void> => {
  await db.insert(backtestRunsTable).values({
    symbol: report.symbol,
    timeframe: report.timeframe,
    periodStart: new Date(report.periodStart),
    periodEnd: new Date(report.periodEnd),
    candleCount: report.candleCount,
    signalCount: report.signalCount,
    tradeCount: report.tradeCount,
    longTradeCount: report.longTradeCount,
    shortTradeCount: report.shortTradeCount,
    profitableTradeCount: report.profitableTradeCount,
    losingTradeCount: report.losingTradeCount,
    winRate: fixed(report.winRate),
    totalPnl: fixed(report.totalPnl),
    maxDrawdown: fixed(report.maxDrawdown),
    profitFactor: report.profitFactor == null ? null : fixed(report.profitFactor),
    expectancy: fixed(report.expectancy),
    averageDurationSeconds: Math.round(report.averageDurationSeconds),
    averageRMultiple: fixed(report.averageRMultiple),
    initialBalance: fixed(report.initialBalance),
    finalBalance: fixed(report.finalBalance),
    report: report as unknown as Record<string, unknown>,
  });
};

const backtestCandles = (
  timeframe: BtcTimeframe,
  rawCandles: BinanceKline[],
): BacktestReport => {
  const candles = rawCandles.map(toCandle);
  const points = calculateTechnicalPoints(rawCandles);
  let balance = INITIAL_BALANCE;
  let peakEquity = INITIAL_BALANCE;
  let maxDrawdown = 0;
  let position: OpenBacktestPosition | null = null;
  let signalCount = 0;
  const trades: BacktestTrade[] = [];

  const updateEquity = (marketPrice: number) => {
    const unrealized = position
      ? pnlForMarket(position, marketPrice, position.remainingQuantity)
      : 0;
    const equity = balance + unrealized;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.max(maxDrawdown, peakEquity - equity);
  };

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    let snapshot: BtcStrategySnapshot | null = null;
    try {
      snapshot = buildBtcStrategySnapshot(points, index, candle.close);
    } catch {
      updateEquity(candle.close);
      continue;
    }

    if (position) {
      const exit = closePositionOnCandle(position, candle, balance);
      balance = exit.balance;
      position = exit.position;
      trades.push(...exit.trades);

      const expectedDirection = directionForScenario(snapshot.scenario);
      if (position && index > position.entrySignalIndex && expectedDirection !== position.direction) {
        const cancellation = applyExit(
          position,
          candle.close,
          position.remainingQuantity,
          "SCENARIO_CANCELLED",
          new Date(candle.closeTime),
          balance,
        );
        balance = cancellation.balance;
        position = cancellation.position;
        if (cancellation.trade) trades.push(cancellation.trade);
      }
    }

    if (!position && index + 1 < candles.length) {
      const direction = directionForScenario(snapshot.scenario);
      if (direction) {
        signalCount += 1;
        const signal = buildSignal(snapshot, candles[index + 1], balance);
        if (signal) {
          position = {
            ...signal,
            entryTime: new Date(candles[index + 1].openTime),
            remainingQuantity: signal.quantity,
            takeProfit1Hit: false,
            netPnl: 0,
            entrySignalIndex: index,
          };
        }
      }
    }
    updateEquity(candle.close);
  }

  if (position) {
    const finalCandle = candles.at(-1);
    if (finalCandle) {
      const finalExit = applyExit(
        position,
        finalCandle.close,
        position.remainingQuantity,
        "END_OF_PERIOD",
        new Date(finalCandle.closeTime),
        balance,
      );
      balance = finalExit.balance;
      if (finalExit.trade) trades.push(finalExit.trade);
      position = finalExit.position;
      updateEquity(finalCandle.close);
    }
  }

  return buildReport(timeframe, candles, signalCount, trades, maxDrawdown, balance);
};

export const runBacktest = async (timeframe: BtcTimeframe): Promise<BacktestReport> => {
  const candles = await fetchHistoricalCandles(timeframe);
  const report = backtestCandles(timeframe, candles);
  if (report.candleCount === 0 || report.tradeCount === 0) {
    throw new Error("Backtest не сформировал ни одной сделки на выбранном периоде");
  }
  await saveBacktestReport(report);
  return report;
};

const backtestRunView = (run: BacktestRun): BacktestReport => {
  const report = run.report as Partial<BacktestReport>;
  return {
    symbol: run.symbol as "BTCUSDT",
    timeframe: run.timeframe as BtcTimeframe,
    periodStart: run.periodStart.toISOString(),
    periodEnd: run.periodEnd.toISOString(),
    candleCount: run.candleCount,
    signalCount: run.signalCount,
    tradeCount: run.tradeCount,
    longTradeCount: run.longTradeCount,
    shortTradeCount: run.shortTradeCount,
    profitableTradeCount: run.profitableTradeCount,
    losingTradeCount: run.losingTradeCount,
    winRate: numberValue(run.winRate),
    totalPnl: numberValue(run.totalPnl),
    maxDrawdown: numberValue(run.maxDrawdown),
    profitFactor: run.profitFactor == null ? null : numberValue(run.profitFactor),
    expectancy: numberValue(run.expectancy),
    averageDurationSeconds: run.averageDurationSeconds,
    averageRMultiple: numberValue(run.averageRMultiple),
    initialBalance: numberValue(run.initialBalance),
    finalBalance: numberValue(run.finalBalance),
    trades: Array.isArray(report.trades) ? (report.trades as BacktestTrade[]) : [],
  };
};

export const getRecentBacktestReports = async (limit = 5): Promise<BacktestReport[]> => {
  const runs = await db
    .select()
    .from(backtestRunsTable)
    .where(eq(backtestRunsTable.symbol, "BTCUSDT"))
    .orderBy(desc(backtestRunsTable.id))
    .limit(Math.min(Math.max(limit, 1), 20));
  return runs.map(backtestRunView);
};
