import { and, asc, desc, eq, lte } from "drizzle-orm";
import {
  db,
  paperAccountsTable,
  paperAlertEventsTable,
  paperAlertRecipientsTable,
  paperScenarioObservationsTable,
  paperTradeJournalsTable,
  paperTradesTable,
  type PaperAccount,
  type PaperAlertEvent,
  type PaperTradeJournal,
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
const ALERT_RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000];

export type PaperAlertEventType = "TP1" | "TP2" | "SL" | "SCENARIO_CANCELLED";
export type PaperAlertPayload = Record<string, number | string | null>;

export type PaperAlertEventView = {
  id: number;
  tradeId: number;
  eventType: PaperAlertEventType;
  symbol: string;
  timeframe: string;
  direction: string;
  scenario: string;
  payload: PaperAlertPayload;
  status: string;
  attempts: number;
  createdAt: string;
  sentAt: string | null;
};

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
  remainingQuantity: number;
  currentPrice: number | null;
  currentPnl: number | null;
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
    longSignalCount: number;
    shortSignalCount: number;
    neutralSignalCount: number;
    cancelledTradeCount: number;
    closedTradeCount: number;
    profitableTradeCount: number;
    losingTradeCount: number;
    realizedPnl: number;
    winRate: number;
    averageWin: number;
    averageLoss: number;
    averageResult: number;
    maxDrawdown: number;
    profitFactor: number | null;
    expectancy: number;
  };
};

export type PaperTradeJournalClass =
  | "successful_signal"
  | "weak_signal"
  | "erroneous_signal";

export type PaperTradeJournalView = {
  id: number;
  tradeId: number;
  entryTime: string;
  exitTime: string;
  symbol: string;
  timeframe: string;
  direction: string;
  scenario: string;
  entryReason: string;
  indicators: {
    ema21: number;
    ema50: number;
    rsi14: number;
    macd: number;
    macdSignal: number;
    macdHistogram: number;
    candleVolume: number;
    averageVolume20: number;
    volumeRatio20: number;
    support: number;
    resistance: number;
  };
  result: string;
  pnl: number;
  durationSeconds: number;
  rMultiple: number;
  confirmedFactors: string[];
  errorFactors: string[];
  tradeClass: PaperTradeJournalClass;
};

export type PaperLessonGroup = {
  label: string;
  count: number;
  profitableCount: number;
  losingCount: number;
  winRate: number;
  averagePnl: number;
  averageRMultiple: number;
};

export type PaperLessons = {
  journalCount: number;
  averageDurationSeconds: number;
  averageRMultiple: number;
  bestTimeframes: PaperLessonGroup[];
  longVsShort: PaperLessonGroup[];
  profitableEntryConditions: PaperLessonGroup[];
  losingEntryConditions: PaperLessonGroup[];
  repeatingErrors: PaperLessonGroup[];
};

const numberValue = (value: string | number | null | undefined): number =>
  value == null ? 0 : Number(value);

const fixed = (value: number): string => value.toFixed(8);

const JOURNAL_ERROR_FACTORS = {
  weakImpulse: "Слабый импульс",
  falseBreakout: "Ложный пробой",
  indicatorDivergence: "Расхождение индикаторов",
  poorRiskReward: "Плохое соотношение риск/прибыль",
  insufficientVolume: "Недостаточный объём",
} as const;

const resultLabel = (pnl: number): string =>
  pnl > EPSILON ? "Прибыль" : pnl < -EPSILON ? "Убыток" : "Безубыток";

const alertEventView = (event: PaperAlertEvent): PaperAlertEventView => ({
  id: event.id,
  tradeId: event.tradeId,
  eventType: event.eventType as PaperAlertEventType,
  symbol: event.symbol,
  timeframe: event.timeframe,
  direction: event.direction,
  scenario: event.scenario,
  payload: event.payload,
  status: event.status,
  attempts: event.attempts,
  createdAt: event.createdAt.toISOString(),
  sentAt: event.sentAt?.toISOString() ?? null,
});

const journalView = (journal: PaperTradeJournal): PaperTradeJournalView => ({
  id: journal.id,
  tradeId: journal.tradeId,
  entryTime: journal.entryTime.toISOString(),
  exitTime: journal.exitTime.toISOString(),
  symbol: journal.symbol,
  timeframe: journal.timeframe,
  direction: journal.direction,
  scenario: journal.scenario,
  entryReason: journal.entryReason,
  indicators: {
    ema21: numberValue(journal.ema21),
    ema50: numberValue(journal.ema50),
    rsi14: numberValue(journal.rsi14),
    macd: numberValue(journal.macd),
    macdSignal: numberValue(journal.macdSignal),
    macdHistogram: numberValue(journal.macdHistogram),
    candleVolume: numberValue(journal.candleVolume),
    averageVolume20: numberValue(journal.averageVolume20),
    volumeRatio20: numberValue(journal.volumeRatio20),
    support: numberValue(journal.support),
    resistance: numberValue(journal.resistance),
  },
  result: journal.result,
  pnl: numberValue(journal.pnl),
  durationSeconds: journal.durationSeconds,
  rMultiple: numberValue(journal.rMultiple),
  confirmedFactors: journal.confirmedFactors,
  errorFactors: journal.errorFactors,
  tradeClass: journal.tradeClass as PaperTradeJournalClass,
});

const tradeView = (
  trade: PaperTrade,
  currentPrice: number | null = null,
  currentPnl: number | null = null,
): PaperTradeView => ({
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
  remainingQuantity: numberValue(trade.remainingQuantity),
  currentPrice,
  currentPnl,
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

const getScenarioObservations = async () =>
  db
    .select()
    .from(paperScenarioObservationsTable)
    .where(eq(paperScenarioObservationsTable.accountId, ACCOUNT_ID))
    .orderBy(desc(paperScenarioObservationsTable.id));

const recordScenarioObservation = async (analysis: BtcMarketAnalysis): Promise<void> => {
  await db
    .insert(paperScenarioObservationsTable)
    .values({
      accountId: ACCOUNT_ID,
      symbol: analysis.symbol,
      timeframe: analysis.timeframe,
      direction: directionForScenario(analysis.scenario),
      scenario: analysis.scenario,
      signalCandleTime: new Date(analysis.signalCandleTime),
    })
    .onConflictDoNothing();
};

export const registerPaperAlertRecipient = async (chatId: number): Promise<void> => {
  await ensurePaperAccount();
  await db
    .insert(paperAlertRecipientsTable)
    .values({
      accountId: ACCOUNT_ID,
      chatId: String(chatId),
      enabled: true,
    })
    .onConflictDoUpdate({
      target: paperAlertRecipientsTable.accountId,
      set: {
        chatId: String(chatId),
        enabled: true,
        updatedAt: new Date(),
      },
    });
};

export const getRecentPaperAlertEvents = async (limit = 10): Promise<PaperAlertEventView[]> => {
  const events = await db
    .select()
    .from(paperAlertEventsTable)
    .where(eq(paperAlertEventsTable.accountId, ACCOUNT_ID))
    .orderBy(desc(paperAlertEventsTable.id))
    .limit(Math.min(Math.max(limit, 1), 50));
  return events.map(alertEventView);
};

export const getRecentPaperTradeJournals = async (
  limit = 5,
): Promise<PaperTradeJournalView[]> => {
  const journals = await db
    .select()
    .from(paperTradeJournalsTable)
    .where(eq(paperTradeJournalsTable.accountId, ACCOUNT_ID))
    .orderBy(desc(paperTradeJournalsTable.id))
    .limit(Math.min(Math.max(limit, 1), 20));
  return journals.map(journalView);
};

const average = (values: number[]): number =>
  values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

const journalGroup = (label: string, journals: PaperTradeJournalView[]): PaperLessonGroup => {
  const profitable = journals.filter((journal) => journal.pnl > EPSILON);
  const losing = journals.filter((journal) => journal.pnl < -EPSILON);
  return {
    label,
    count: journals.length,
    profitableCount: profitable.length,
    losingCount: losing.length,
    winRate: journals.length > 0 ? (profitable.length / journals.length) * 100 : 0,
    averagePnl: average(journals.map((journal) => journal.pnl)),
    averageRMultiple: average(journals.map((journal) => journal.rMultiple)),
  };
};

const groupJournals = (
  journals: PaperTradeJournalView[],
  keyFor: (journal: PaperTradeJournalView) => string,
): PaperLessonGroup[] => {
  const groups = new Map<string, PaperTradeJournalView[]>();
  for (const journal of journals) {
    const key = keyFor(journal);
    const group = groups.get(key) ?? [];
    group.push(journal);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([label, group]) => journalGroup(label, group))
    .sort(
      (left, right) =>
        right.averagePnl - left.averagePnl ||
        right.winRate - left.winRate ||
        right.count - left.count,
    );
};

export const getPaperLessons = async (): Promise<PaperLessons> => {
  const rows = await db
    .select()
    .from(paperTradeJournalsTable)
    .where(eq(paperTradeJournalsTable.accountId, ACCOUNT_ID))
    .orderBy(desc(paperTradeJournalsTable.id));
  const journals = rows.map(journalView);
  const profitableEntryConditions = new Map<string, PaperTradeJournalView[]>();
  const losingEntryConditions = new Map<string, PaperTradeJournalView[]>();
  const repeatingErrors = new Map<string, PaperTradeJournalView[]>();
  const addToGroup = (
    groups: Map<string, PaperTradeJournalView[]>,
    label: string,
    journal: PaperTradeJournalView,
  ) => {
    const group = groups.get(label) ?? [];
    group.push(journal);
    groups.set(label, group);
  };
  for (const journal of journals) {
    for (const factor of journal.confirmedFactors) {
      if (journal.pnl > EPSILON) addToGroup(profitableEntryConditions, factor, journal);
      if (journal.pnl < -EPSILON) addToGroup(losingEntryConditions, factor, journal);
    }
    if (journal.pnl < -EPSILON) {
      for (const factor of journal.errorFactors) addToGroup(repeatingErrors, factor, journal);
    }
  }
  const mapGroups = (groups: Map<string, PaperTradeJournalView[]>) =>
    [...groups.entries()]
      .map(([label, group]) => journalGroup(label, group))
      .sort(
        (left, right) =>
          right.count - left.count ||
          right.averagePnl - left.averagePnl,
      );

  return {
    journalCount: journals.length,
    averageDurationSeconds: average(journals.map((journal) => journal.durationSeconds)),
    averageRMultiple: average(journals.map((journal) => journal.rMultiple)),
    bestTimeframes: groupJournals(journals, (journal) => journal.timeframe),
    longVsShort: groupJournals(journals, (journal) => journal.direction),
    profitableEntryConditions: mapGroups(profitableEntryConditions),
    losingEntryConditions: mapGroups(losingEntryConditions),
    repeatingErrors: mapGroups(repeatingErrors),
  };
};

export type PaperAlertSender = (
  chatId: number,
  event: PaperAlertEventView,
) => Promise<void>;

let alertDeliveryPromise: Promise<void> | null = null;

export const deliverPendingPaperAlerts = async (sender: PaperAlertSender): Promise<void> => {
  if (alertDeliveryPromise) return alertDeliveryPromise;
  alertDeliveryPromise = (async () => {
    const [recipient] = await db
      .select()
      .from(paperAlertRecipientsTable)
      .where(
        and(
          eq(paperAlertRecipientsTable.accountId, ACCOUNT_ID),
          eq(paperAlertRecipientsTable.enabled, true),
        ),
      )
      .limit(1);
    if (!recipient) return;

    const pendingEvents = await db
      .select()
      .from(paperAlertEventsTable)
      .where(
        and(
          eq(paperAlertEventsTable.accountId, ACCOUNT_ID),
          eq(paperAlertEventsTable.status, "pending"),
          lte(paperAlertEventsTable.nextAttemptAt, new Date()),
        ),
      )
      .orderBy(asc(paperAlertEventsTable.id))
      .limit(20);

    for (const event of pendingEvents) {
      const attempts = event.attempts + 1;
      await db
        .update(paperAlertEventsTable)
        .set({ attempts, lastError: null })
        .where(eq(paperAlertEventsTable.id, event.id));
      const view = alertEventView({ ...event, attempts });
      try {
        await sender(Number(recipient.chatId), view);
        await db
          .update(paperAlertEventsTable)
          .set({
            status: "sent",
            sentAt: new Date(),
            lastError: null,
          })
          .where(eq(paperAlertEventsTable.id, event.id));
      } catch (error) {
        const delay =
          ALERT_RETRY_DELAYS_MS[Math.min(attempts - 1, ALERT_RETRY_DELAYS_MS.length - 1)];
        const lastError = error instanceof Error ? error.message : "Неизвестная ошибка Telegram";
        await db
          .update(paperAlertEventsTable)
          .set({
            status: "pending",
            nextAttemptAt: new Date(Date.now() + delay),
            lastError,
          })
          .where(eq(paperAlertEventsTable.id, event.id));
        logger.warn(
          { eventId: event.id, attempts, nextAttemptInMs: delay, error: lastError },
          "Paper trading alert delivery failed; retry scheduled",
        );
      }
    }
  })().finally(() => {
    alertDeliveryPromise = null;
  });
  return alertDeliveryPromise;
};

const recordPaperAlertEvent = async (
  trade: PaperTrade,
  eventType: PaperAlertEventType,
  payload: PaperAlertPayload,
): Promise<void> => {
  await db
    .insert(paperAlertEventsTable)
    .values({
      accountId: ACCOUNT_ID,
      tradeId: trade.id,
      eventType,
      symbol: trade.symbol,
      timeframe: trade.timeframe,
      direction: trade.direction,
      scenario: trade.scenario,
      payload,
    })
    .onConflictDoNothing();
};

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
  const tradeSlippageRate = numberValue(trade.slippageBps) / 10_000;
  const exitPrice =
    direction === "LONG"
      ? marketPrice * (1 - tradeSlippageRate)
      : marketPrice * (1 + tradeSlippageRate);
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

const buildPaperTradeJournal = (
  trade: PaperTrade,
): {
  entryTime: Date;
  exitTime: Date;
  indicators: PaperTradeJournalView["indicators"];
  result: string;
  pnl: number;
  durationSeconds: number;
  rMultiple: number;
  confirmedFactors: string[];
  errorFactors: string[];
  tradeClass: PaperTradeJournalClass;
} | null => {
  if (trade.status !== "closed" || !trade.exitTime) return null;

  const indicators = {
    ema21: numberValue(trade.indicators.ema21),
    ema50: numberValue(trade.indicators.ema50),
    rsi14: numberValue(trade.indicators.rsi14),
    macd: numberValue(trade.indicators.macd),
    macdSignal: numberValue(trade.indicators.signal),
    macdHistogram: numberValue(trade.indicators.histogram),
    candleVolume: numberValue(trade.indicators.candleVolume),
    averageVolume20: numberValue(trade.indicators.averageVolume20),
    volumeRatio20: numberValue(trade.indicators.volumeRatio20),
    support: numberValue(trade.indicators.support),
    resistance: numberValue(trade.indicators.resistance),
  };
  const isLong = trade.direction === "LONG";
  const signalPrice = numberValue(trade.indicators.signalPrice) || numberValue(trade.entryMarketPrice);
  const emaTrendConfirmed = isLong
    ? indicators.ema21 >= indicators.ema50
    : indicators.ema21 <= indicators.ema50;
  const priceEmaConfirmed = isLong
    ? signalPrice >= indicators.ema21 && signalPrice >= indicators.ema50
    : signalPrice <= indicators.ema21 && signalPrice <= indicators.ema50;
  const rsiConfirmed = isLong
    ? indicators.rsi14 >= 50 && indicators.rsi14 <= 70
    : indicators.rsi14 <= 50 && indicators.rsi14 >= 30;
  const macdConfirmed = isLong
    ? indicators.macd >= indicators.macdSignal && indicators.macdHistogram >= 0
    : indicators.macd <= indicators.macdSignal && indicators.macdHistogram <= 0;
  const volumeConfirmed = indicators.volumeRatio20 >= 1.2;
  const riskPerUnit = Math.abs(numberValue(trade.entryPrice) - numberValue(trade.stopLoss));
  const riskAmount = riskPerUnit * numberValue(trade.quantity);
  const riskReward =
    riskPerUnit > EPSILON
      ? Math.abs(numberValue(trade.takeProfit2) - numberValue(trade.entryPrice)) / riskPerUnit
      : 0;
  const levelsConfirmed =
    riskReward >= 1.5 &&
    (isLong
      ? numberValue(trade.stopLoss) < numberValue(trade.entryPrice)
      : numberValue(trade.stopLoss) > numberValue(trade.entryPrice));
  const weakImpulse =
    Math.abs(indicators.rsi14 - 50) <= 5 ||
    Math.abs(indicators.macd - indicators.macdSignal) <=
      Math.max(Math.abs(indicators.macd) * 0.05, 0.000001);
  const indicatorDivergence =
    (isLong ? indicators.rsi14 >= 50 : indicators.rsi14 <= 50) !==
    (isLong ? indicators.macd >= indicators.macdSignal : indicators.macd <= indicators.macdSignal);
  const loss = numberValue(trade.netPnl) <= EPSILON;
  const confirmedFactors = [
    ...(emaTrendConfirmed ? ["Тренд"] : []),
    ...(priceEmaConfirmed ? ["EMA 21/50"] : []),
    ...(rsiConfirmed ? ["RSI"] : []),
    ...(macdConfirmed ? ["MACD"] : []),
    ...(volumeConfirmed ? ["Объём"] : []),
    ...(levelsConfirmed ? ["Уровни"] : []),
  ];
  const errorFactors = !loss
    ? []
    : [
        ...(weakImpulse ? [JOURNAL_ERROR_FACTORS.weakImpulse] : []),
        ...(trade.exitReason === "SL" || trade.exitReason === "SCENARIO_CANCELLED"
          ? [JOURNAL_ERROR_FACTORS.falseBreakout]
          : []),
        ...(indicatorDivergence ? [JOURNAL_ERROR_FACTORS.indicatorDivergence] : []),
        ...(riskReward > 0 && riskReward < 1.5
          ? [JOURNAL_ERROR_FACTORS.poorRiskReward]
          : []),
        ...(indicators.volumeRatio20 < 0.8 ? [JOURNAL_ERROR_FACTORS.insufficientVolume] : []),
      ];
  const tradeClass: PaperTradeJournalClass =
    numberValue(trade.netPnl) > EPSILON
      ? "successful_signal"
      : errorFactors.some(
            (factor) =>
              factor === JOURNAL_ERROR_FACTORS.falseBreakout ||
              factor === JOURNAL_ERROR_FACTORS.indicatorDivergence ||
              factor === JOURNAL_ERROR_FACTORS.poorRiskReward,
          ) || errorFactors.length >= 2
        ? "erroneous_signal"
        : "weak_signal";

  return {
    entryTime: trade.signalTime,
    exitTime: trade.exitTime,
    indicators,
    result: resultLabel(numberValue(trade.netPnl)),
    pnl: numberValue(trade.netPnl),
    durationSeconds: Math.max(
      0,
      Math.round((trade.exitTime.getTime() - trade.signalTime.getTime()) / 1000),
    ),
    rMultiple: riskAmount > EPSILON ? numberValue(trade.netPnl) / riskAmount : 0,
    confirmedFactors,
    errorFactors,
    tradeClass,
  };
};

const recordPaperTradeJournal = async (trade: PaperTrade): Promise<void> => {
  const analysis = buildPaperTradeJournal(trade);
  if (!analysis) return;
  await db
    .insert(paperTradeJournalsTable)
    .values({
      accountId: ACCOUNT_ID,
      tradeId: trade.id,
      entryTime: analysis.entryTime,
      exitTime: analysis.exitTime,
      symbol: trade.symbol,
      timeframe: trade.timeframe,
      direction: trade.direction,
      scenario: trade.scenario,
      entryReason: trade.reason,
      ema21: fixed(analysis.indicators.ema21),
      ema50: fixed(analysis.indicators.ema50),
      rsi14: fixed(analysis.indicators.rsi14),
      macd: fixed(analysis.indicators.macd),
      macdSignal: fixed(analysis.indicators.macdSignal),
      macdHistogram: fixed(analysis.indicators.macdHistogram),
      candleVolume: fixed(analysis.indicators.candleVolume),
      averageVolume20: fixed(analysis.indicators.averageVolume20),
      volumeRatio20: fixed(analysis.indicators.volumeRatio20),
      support: fixed(analysis.indicators.support),
      resistance: fixed(analysis.indicators.resistance),
      result: analysis.result,
      pnl: fixed(analysis.pnl),
      durationSeconds: analysis.durationSeconds,
      rMultiple: fixed(analysis.rMultiple),
      confirmedFactors: analysis.confirmedFactors,
      errorFactors: analysis.errorFactors,
      tradeClass: analysis.tradeClass,
    })
    .onConflictDoNothing();
};

type PaperCloseContext = {
  newScenario?: string;
  newClosedCandleTime?: Date;
};

const applyClose = async (
  trade: PaperTrade,
  marketPrice: number,
  quantity: number,
  reason: string,
  isTakeProfit1 = false,
  context: PaperCloseContext = {},
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

  const [currentAccount] = await db
    .select()
    .from(paperAccountsTable)
    .where(eq(paperAccountsTable.id, ACCOUNT_ID))
    .limit(1);
  if (!currentAccount) {
    throw new Error("Виртуальный счёт не найден при закрытии позиции");
  }
  const nextBalance = numberValue(currentAccount.balance) + pnl.net;
  await db
    .update(paperAccountsTable)
    .set({ balance: fixed(nextBalance), updatedAt: new Date() })
    .where(eq(paperAccountsTable.id, ACCOUNT_ID));

  await recordPaperTradeJournal(updated);

  const eventType = reason as PaperAlertEventType;
  const commonPayload: PaperAlertPayload = {
    price: pnl.exitPrice,
    pnl: numberValue(updated.netPnl),
    balanceChange: pnl.net,
    balance: nextBalance,
  };
  if (eventType === "TP1") {
    await recordPaperAlertEvent(trade, eventType, {
      ...commonPayload,
      closedPercent: (quantity / Math.max(numberValue(trade.quantity), EPSILON)) * 100,
      remainingQuantity: remaining,
      takeProfit2: numberValue(updated.takeProfit2),
      stopLoss: numberValue(updated.stopLoss),
      tranchePnl: pnl.net,
    });
  } else if (eventType === "TP2") {
    await recordPaperAlertEvent(updated, eventType, {
      ...commonPayload,
      closePrice: pnl.exitPrice,
      finalPnl: numberValue(updated.netPnl),
      result: numberValue(updated.netPnl) >= 0 ? "Прибыль" : "Убыток",
    });
  } else if (eventType === "SL") {
    await recordPaperAlertEvent(updated, eventType, {
      ...commonPayload,
      entryPrice: numberValue(updated.entryPrice),
      closePrice: pnl.exitPrice,
      loss: pnl.net,
      finalPnl: numberValue(updated.netPnl),
      closeReason: "Стоп-лосс",
    });
  } else if (eventType === "SCENARIO_CANCELLED") {
    await recordPaperAlertEvent(updated, eventType, {
      ...commonPayload,
      previousScenario: trade.scenario,
      newScenario: context.newScenario ?? null,
      newClosedCandleTime: context.newClosedCandleTime?.toISOString() ?? null,
      cancellationReason: `Сценарий изменился на «${context.newScenario ?? "неизвестный"}»`,
      positionResult: numberValue(updated.netPnl),
    });
  }
  return updated;
};

const evaluateOpenTrade = async (
  trade: PaperTrade,
  analysis: BtcMarketAnalysis,
): Promise<void> => {
  const price = analysis.market.price;
  const stopHit =
    trade.direction === "LONG"
      ? price <= numberValue(trade.stopLoss)
      : price >= numberValue(trade.stopLoss);
  if (stopHit) {
    await applyClose(trade, price, numberValue(trade.remainingQuantity), "SL");
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
    await applyClose(current, price, numberValue(current.remainingQuantity), "TP2");
    return;
  }

  const expectedDirection = directionForScenario(analysis.scenario);
  const hasNewClosedCandle =
    new Date(analysis.signalCandleTime).getTime() > trade.signalCandleTime.getTime();
  if (
    hasNewClosedCandle &&
    expectedDirection !== current.direction &&
    current.status === "open"
  ) {
    await applyClose(
      current,
      price,
      numberValue(current.remainingQuantity),
      "SCENARIO_CANCELLED",
      false,
      {
        newScenario: analysis.scenario,
        newClosedCandleTime: new Date(analysis.signalCandleTime),
      },
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
        await recordScenarioObservation(analysis);
        const openTrades = await getOpenTrades(timeframe);
        for (const trade of openTrades) {
          await evaluateOpenTrade(trade, analysis);
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
  const observations = await getScenarioObservations();
  const openPositions = trades.filter((trade) => trade.status === "open");
  const closedTrades = trades.filter((trade) => trade.status === "closed");
  const openAnalyses = await Promise.all(
    [...new Set(openPositions.map((trade) => trade.timeframe as BtcTimeframe))].map((timeframe) =>
      getBtcMarketAnalysis(timeframe),
    ),
  );
  const currentPrices = new Map<string, number>(
    openAnalyses.map((analysis) => [analysis.timeframe, analysis.market.price]),
  );
  const unrealizedPnl = openPositions.reduce((sum, trade) => {
    const price = currentPrices.get(trade.timeframe);
    if (price == null) return sum;
    return sum + positionPnl(trade, price, numberValue(trade.remainingQuantity)).net;
  }, 0);
  const viewForTrade = (trade: PaperTrade): PaperTradeView => {
    const currentPrice = trade.status === "open" ? currentPrices.get(trade.timeframe) ?? null : null;
    const currentPnl =
      currentPrice == null
        ? null
        : positionPnl(trade, currentPrice, numberValue(trade.remainingQuantity)).net;
    return tradeView(trade, currentPrice, currentPnl);
  };
  const realizedPnl = closedTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const profitableTrades = closedTrades.filter((trade) => numberValue(trade.netPnl) > 0);
  const losingTrades = closedTrades.filter((trade) => numberValue(trade.netPnl) < 0);
  const grossProfit = profitableTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const grossLoss = losingTrades.reduce((sum, trade) => sum + numberValue(trade.netPnl), 0);
  const longSignalCount = trades.filter((trade) => trade.direction === "LONG").length;
  const shortSignalCount = trades.filter((trade) => trade.direction === "SHORT").length;
  const neutralSignalCount = observations.filter((observation) => observation.direction == null).length;
  const cancelledTradeCount = closedTrades.filter(
    (trade) => trade.exitReason === "SCENARIO_CANCELLED",
  ).length;
  const averageResult = closedTrades.length > 0 ? realizedPnl / closedTrades.length : 0;
  const winRate = closedTrades.length > 0 ? (profitableTrades.length / closedTrades.length) * 100 : 0;
  const averageWin = profitableTrades.length > 0 ? grossProfit / profitableTrades.length : 0;
  const averageLoss = losingTrades.length > 0 ? grossLoss / losingTrades.length : 0;

  return {
    balance: numberValue(account.balance),
    equity: numberValue(account.balance) + unrealizedPnl,
    unrealizedPnl,
    openPositions: openPositions.map(viewForTrade),
    recentTrades: trades.slice(0, 10).map(viewForTrade),
    stats: {
      tradeCount: trades.length,
      longSignalCount,
      shortSignalCount,
      neutralSignalCount,
      cancelledTradeCount,
      closedTradeCount: closedTrades.length,
      profitableTradeCount: profitableTrades.length,
      losingTradeCount: losingTrades.length,
      realizedPnl,
      winRate,
      averageWin,
      averageLoss,
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