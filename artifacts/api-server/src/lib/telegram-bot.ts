import { logger } from "./logger";
import {
  BtcMarketDataError,
  getBtcMarketAnalysis,
  isBtcTimeframe,
  type BtcMarketAnalysis,
  type BtcTimeframe,
} from "./btc-market-analysis";
import {
  deliverPendingPaperAlerts,
  getPaperLessons,
  getRecentPaperAlertEvents,
  getRecentPaperTradeJournals,
  getPaperAccountSnapshot,
  registerPaperAlertRecipient,
  refreshPaperTrading,
  type PaperAlertEventView,
  type PaperAccountSnapshot,
  type PaperLessonGroup,
  type PaperTradeJournalView,
  type PaperTradeView,
} from "./paper-trading";

type TelegramMessage = {
  chat: { id: number };
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

type TelegramResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const TELEGRAM_API = "https://api.telegram.org/bot";
const POLL_TIMEOUT_SECONDS = 25;
const REQUEST_TIMEOUT_MS = 35_000;

class TelegramApiError extends Error {}

const telegramRequest = async <T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  parentSignal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromParent = () => controller.abort();
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  try {
    const response = await fetch(`${TELEGRAM_API}${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = (await response.json()) as TelegramResponse<T>;
    if (!response.ok || !payload.ok || payload.result === undefined) {
      throw new TelegramApiError(
        payload.description ?? `Telegram API вернул HTTP ${response.status}`,
      );
    }
    return payload.result;
  } catch (error) {
    if (error instanceof TelegramApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new TelegramApiError("Telegram API не ответил вовремя");
    }
    throw new TelegramApiError("Не удалось связаться с Telegram API");
  } finally {
    clearTimeout(timeout);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
};

const formatPrice = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatBtc = (value: number) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} BTC`;

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

const formatMoney = (value: number) =>
  `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatPnl = (value: number) => `${value >= 0 ? "+" : ""}${formatMoney(value)}`;

const formatQuantity = (value: number) =>
  `${value.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 8 })} BTC`;

const formatDuration = (seconds: number): string => {
  const wholeMinutes = Math.floor(seconds / 60);
  const days = Math.floor(wholeMinutes / (60 * 24));
  const hours = Math.floor((wholeMinutes % (60 * 24)) / 60);
  const minutes = wholeMinutes % 60;
  if (days > 0) return `${days} д ${hours} ч ${minutes} мин`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
};

const formatJournalClass = (value: PaperTradeJournalView["tradeClass"]): string =>
  value === "successful_signal"
    ? "успешный сигнал"
    : value === "erroneous_signal"
      ? "ошибочный сигнал"
      : "слабый сигнал";

const formatJournalFactors = (factors: string[]): string =>
  factors.length > 0 ? factors.join(", ") : "нет";

const alertNumber = (event: PaperAlertEventView, key: string): number =>
  Number(event.payload[key] ?? 0);

const alertText = (event: PaperAlertEventView, key: string): string =>
  String(event.payload[key] ?? "—");

const formatPaperAlertMessage = (event: PaperAlertEventView): string => {
  const title = [
    "Моисей | Paper Trading",
    "",
    `${event.symbol} ${event.timeframe} ${event.direction}`,
    "",
  ];
  if (event.eventType === "TP1") {
    return [
      ...title,
      "✅ TP1 достигнут",
      "",
      `Цена: ${formatPrice(alertNumber(event, "price"))}`,
      `P&L: ${formatPnl(alertNumber(event, "tranchePnl"))}`,
      `Закрыто: ${alertNumber(event, "closedPercent").toFixed(2)}%`,
      `Осталось: ${formatQuantity(alertNumber(event, "remainingQuantity"))}`,
      `Следующая цель: TP2 ${formatPrice(alertNumber(event, "takeProfit2"))}`,
      `SL: ${formatPrice(alertNumber(event, "stopLoss"))}`,
    ].join("\n");
  }
  if (event.eventType === "TP2") {
    return [
      ...title,
      "✅ TP2 достигнут",
      "",
      `Цена закрытия: ${formatPrice(alertNumber(event, "closePrice"))}`,
      `Итоговый P&L: ${formatPnl(alertNumber(event, "finalPnl"))}`,
      `Изменение виртуального баланса: ${formatPnl(alertNumber(event, "balanceChange"))}`,
      `Баланс: ${formatMoney(alertNumber(event, "balance"))}`,
      `Результат: ${alertText(event, "result")}`,
    ].join("\n");
  }
  if (event.eventType === "SL") {
    return [
      ...title,
      "🛑 SL сработал",
      "",
      `Цена входа: ${formatPrice(alertNumber(event, "entryPrice"))}`,
      `Цена закрытия: ${formatPrice(alertNumber(event, "closePrice"))}`,
      `Убыток: ${formatPnl(alertNumber(event, "loss"))}`,
      `Причина закрытия: ${alertText(event, "closeReason")}`,
    ].join("\n");
  }
  return [
    ...title,
    "⚠️ Сценарий отменён",
    "",
    `Был сценарий: ${event.payload.previousScenario ?? event.scenario}`,
    `Новый сценарий: ${alertText(event, "newScenario")}`,
    `Причина: ${alertText(event, "cancellationReason")}`,
    `Новая закрытая свеча: ${alertText(event, "newClosedCandleTime")}`,
    `Результат позиции: ${formatPnl(alertNumber(event, "positionResult"))}`,
  ].join("\n");
};

const alertTypeLabel: Record<PaperAlertEventView["eventType"], string> = {
  TP1: "TP1",
  TP2: "TP2",
  SL: "SL",
  SCENARIO_CANCELLED: "отмена сценария",
};

const formatPaperAlerts = (events: PaperAlertEventView[]): string =>
  [
    "TEST TRADING · последние уведомления",
    events.length > 0
      ? events
          .map((event) => {
            const delivery =
              event.status === "sent"
                ? "отправлено"
                : `ожидает отправки, попыток: ${event.attempts}`;
            const pnl =
              event.eventType === "TP1"
                ? alertNumber(event, "tranchePnl")
                : event.eventType === "SCENARIO_CANCELLED"
                  ? alertNumber(event, "positionResult")
                  : alertNumber(event, event.eventType === "TP2" ? "finalPnl" : "loss");
            return `#${event.id} · ${alertTypeLabel[event.eventType]} · ${event.symbol} ${event.timeframe} ${event.direction} · P&L ${formatPnl(pnl)} · ${delivery}`;
          })
          .join("\n")
      : "Событий пока нет.",
  ].join("\n");

const timeframeLabel: Record<BtcTimeframe, string> = {
  "1H": "1H",
  "4H": "4H",
  "1D": "1D",
  "1W": "1W",
};

const helpText = [
  "Привет. Я Моисей — аналитический помощник по BTCUSDT.",
  "",
  "Команды:",
  "/btc — анализ по 4H",
  "/btc 1h — часовой анализ",
  "/btc 4h — анализ за 4 часа",
  "/btc 1d — дневной анализ",
  "/btc 1w — недельный анализ",
  "",
  "TEST TRADING без реальных ордеров:",
  "/paper — состояние виртуального счёта",
  "/paper status — баланс и открытые позиции",
  "/paper monitor — баланс, equity, P&L и детали позиций",
  "/paper trades — последние тестовые сделки",
  "/paper stats — статистика тестовой торговли",
  "/paper alerts — последние уведомления TEST TRADING",
  "/paper journal — последние закрытые сделки с анализом",
  "/paper lessons — накопленные выводы Моисея",
].join("\n");

const formatPaperPosition = (trade: PaperTradeView): string =>
  `#${trade.id} ${trade.timeframe} ${trade.direction} · вход ${formatPrice(trade.entryPrice)} · SL ${formatPrice(trade.stopLoss)} · TP1 ${formatPrice(trade.takeProfit1)} · TP2 ${formatPrice(trade.takeProfit2)}`;

const formatPaperMonitorPosition = (trade: PaperTradeView): string =>
  [
    `#${trade.id} · ${trade.timeframe} ${trade.direction}`,
    `Количество: ${formatQuantity(trade.remainingQuantity)}`,
    `Вход: ${formatPrice(trade.entryPrice)} · текущая цена: ${
      trade.currentPrice == null ? "недоступна" : formatPrice(trade.currentPrice)
    }`,
    `Текущий P&L: ${trade.currentPnl == null ? "недоступен" : formatPnl(trade.currentPnl)}`,
    `SL: ${formatPrice(trade.stopLoss)} · TP1: ${formatPrice(trade.takeProfit1)} · TP2: ${formatPrice(trade.takeProfit2)}`,
  ].join("\n");

const formatPaperStatus = (snapshot: PaperAccountSnapshot): string =>
  [
    "TEST TRADING · виртуальный счёт",
    "Реальные ордера и торговые API-ключи не используются.",
    "",
    `Баланс: ${formatMoney(snapshot.balance)}`,
    `Оценка счёта: ${formatMoney(snapshot.equity)}`,
    `Нереализованный P&L: ${formatPnl(snapshot.unrealizedPnl)}`,
    `Открытые позиции: ${snapshot.openPositions.length}`,
    snapshot.openPositions.length > 0
      ? snapshot.openPositions.map(formatPaperPosition).join("\n")
      : "Открытых позиций нет.",
  ].join("\n");

const formatPaperMonitor = (snapshot: PaperAccountSnapshot): string =>
  [
    "TEST TRADING · мониторинг",
    "Реальные ордера и торговые API-ключи не используются.",
    "",
    `Баланс: ${formatMoney(snapshot.balance)}`,
    `Equity: ${formatMoney(snapshot.equity)}`,
    `Реализованный P&L: ${formatPnl(snapshot.stats.realizedPnl)}`,
    `Нереализованный P&L: ${formatPnl(snapshot.unrealizedPnl)}`,
    `Максимальная просадка: ${formatMoney(snapshot.stats.maxDrawdown)}`,
    "",
    `Открытые позиции: ${snapshot.openPositions.length}`,
    snapshot.openPositions.length > 0
      ? snapshot.openPositions.map(formatPaperMonitorPosition).join("\n\n")
      : "Открытых позиций нет.",
  ].join("\n");

const formatPaperTrades = (snapshot: PaperAccountSnapshot): string =>
  [
    "TEST TRADING · последние сделки",
    snapshot.recentTrades.length > 0
      ? snapshot.recentTrades
          .map((trade) => {
            const exit = trade.exitPrice == null ? "открыта" : `выход ${formatPrice(trade.exitPrice)}`;
            return `#${trade.id} · ${trade.timeframe} ${trade.direction} · ${trade.status} · вход ${formatPrice(trade.entryPrice)} · ${exit} · P&L ${formatPnl(trade.netPnl)}${trade.exitReason ? ` · ${trade.exitReason}` : ""}`;
          })
          .join("\n")
      : "Журнал пока пуст.",
  ].join("\n");

const formatPaperStats = (snapshot: PaperAccountSnapshot): string =>
  [
    "TEST TRADING · статистика",
    `Баланс: ${formatMoney(snapshot.balance)}`,
    `Сделок всего: ${snapshot.stats.tradeCount}`,
    `Сигналы LONG / SHORT / neutral: ${snapshot.stats.longSignalCount} / ${snapshot.stats.shortSignalCount} / ${snapshot.stats.neutralSignalCount}`,
    `Отменено по смене сценария: ${snapshot.stats.cancelledTradeCount}`,
    `Закрыто: ${snapshot.stats.closedTradeCount}`,
    `Прибыльных / убыточных: ${snapshot.stats.profitableTradeCount} / ${snapshot.stats.losingTradeCount}`,
    `Прибыль/убыток: ${formatPnl(snapshot.stats.realizedPnl)}`,
    `Процент прибыльных: ${snapshot.stats.winRate.toFixed(2)}%`,
    `Средняя прибыль: ${formatPnl(snapshot.stats.averageWin)}`,
    `Средний убыток: ${formatPnl(snapshot.stats.averageLoss)}`,
    `Средний результат: ${formatPnl(snapshot.stats.averageResult)}`,
    `Максимальная просадка: ${formatMoney(snapshot.stats.maxDrawdown)}`,
    `Profit factor: ${snapshot.stats.profitFactor == null ? "не рассчитан" : snapshot.stats.profitFactor.toFixed(2)}`,
    `Expectancy: ${formatPnl(snapshot.stats.expectancy)}`,
  ].join("\n");

const formatPaperJournalEntry = (journal: PaperTradeJournalView): string =>
  [
    `#${journal.tradeId} · ${journal.symbol} ${journal.timeframe} ${journal.direction}`,
    `${journal.entryTime} → ${journal.exitTime}`,
    `Сценарий: ${journal.scenario}`,
    `Результат: ${journal.result} · класс: ${formatJournalClass(journal.tradeClass)}`,
    `P&L: ${formatPnl(journal.pnl)} · R: ${journal.rMultiple.toFixed(2)} · длительность: ${formatDuration(journal.durationSeconds)}`,
    `EMA 21/50: ${formatPrice(journal.indicators.ema21)} / ${formatPrice(journal.indicators.ema50)} · RSI: ${journal.indicators.rsi14.toFixed(2)}`,
    `MACD: ${journal.indicators.macd.toFixed(4)} · объём: ${journal.indicators.volumeRatio20.toFixed(2)}× от среднего`,
    `Уровни: поддержка ${formatPrice(journal.indicators.support)} · сопротивление ${formatPrice(journal.indicators.resistance)}`,
    `Подтвердило вход: ${formatJournalFactors(journal.confirmedFactors)}`,
    `Ошибочным оказалось: ${formatJournalFactors(journal.errorFactors)}`,
    `Причина открытия: ${journal.entryReason.slice(0, 220)}${journal.entryReason.length > 220 ? "…" : ""}`,
  ].join("\n");

const formatPaperJournal = (journals: PaperTradeJournalView[]): string =>
  [
    "TEST TRADING · Trader Journal",
    journals.length > 0
      ? journals.map(formatPaperJournalEntry).join("\n\n")
      : "Журнал пока пуст. Анализ появится после следующего закрытия виртуальной сделки.",
  ].join("\n\n");

const formatLessonGroups = (groups: PaperLessonGroup[]): string =>
  groups.length > 0
    ? groups
        .slice(0, 5)
        .map(
          (group) =>
            `• ${group.label}: ${group.count} сделок, прибыльных ${group.profitableCount}, убыточных ${group.losingCount}, win rate ${group.winRate.toFixed(1)}%, средний P&L ${formatPnl(group.averagePnl)}, средний R ${group.averageRMultiple.toFixed(2)}`,
        )
        .join("\n")
    : "Пока недостаточно закрытых сделок.";

const formatPaperLessons = (
  lessons: Awaited<ReturnType<typeof getPaperLessons>>,
): string =>
  [
    "TEST TRADING · выводы Моисея",
    lessons.journalCount > 0
      ? `Проанализировано сделок: ${lessons.journalCount}\nСредняя длительность: ${formatDuration(lessons.averageDurationSeconds)}\nСредний R-множитель: ${lessons.averageRMultiple.toFixed(2)}`
      : "Закрытых сделок с анализом пока нет.",
    "",
    "Лучшие таймфреймы:",
    formatLessonGroups(lessons.bestTimeframes),
    "",
    "LONG против SHORT:",
    formatLessonGroups(lessons.longVsShort),
    "",
    "Условия, чаще связанные с прибылью:",
    formatLessonGroups(lessons.profitableEntryConditions),
    "",
    "Условия, чаще связанные с убытком:",
    formatLessonGroups(lessons.losingEntryConditions),
    "",
    "Повторяющиеся ошибки:",
    formatLessonGroups(lessons.repeatingErrors),
  ].join("\n");

const formatAnalysis = (data: BtcMarketAnalysis): string => {
  const { price } = data.market;
  const { ema21, ema50, rsi14, macd, signal, histogram, candleVolume, averageVolume20, volumeRatio20 } =
    data.indicators;
  const priceAboveEma21 = price >= ema21;
  const priceAboveEma50 = price >= ema50;
  const emaAlignment = ema21 >= ema50 ? "EMA 21 выше EMA 50" : "EMA 21 ниже EMA 50";
  const pricePosition =
    priceAboveEma21 && priceAboveEma50
      ? "Цена выше EMA 21 и EMA 50."
      : !priceAboveEma21 && !priceAboveEma50
        ? "Цена ниже EMA 21 и EMA 50."
        : "Цена находится между EMA 21 и EMA 50.";
  const rsiDescription =
    rsi14 >= 70
      ? "RSI близок к зоне перекупленности"
      : rsi14 <= 30
        ? "RSI близок к зоне перепроданности"
        : rsi14 >= 50
          ? "RSI выше нейтральной середины"
          : "RSI ниже нейтральной середины";
  const macdDescription =
    macd >= signal
      ? "MACD выше сигнальной линии"
      : "MACD ниже сигнальной линии";
  const rsiMacdAgreement =
    (rsi14 >= 50 && macd >= signal) || (rsi14 < 50 && macd < signal)
      ? `RSI и MACD согласованы: ${rsiDescription.toLowerCase()}, ${macdDescription.toLowerCase()}.`
      : `RSI и MACD расходятся: ${rsiDescription.toLowerCase()}, но ${macdDescription.toLowerCase()}.`;
  const emaRsiRelationship =
    priceAboveEma21 && priceAboveEma50 && rsi14 >= 70
      ? "Цена выше обеих EMA, однако RSI близок к зоне перекупленности — это важное ограничение вывода."
      : priceAboveEma21 && priceAboveEma50 && rsi14 >= 50
        ? "Цена выше обеих EMA, и RSI выше нейтральной середины — эти показатели согласованы."
      : !priceAboveEma21 && !priceAboveEma50 && rsi14 <= 30
        ? "Цена ниже обеих EMA, при этом RSI близок к зоне перепроданности — показатели направлены одинаково, но RSI указывает на крайнее состояние."
        : !priceAboveEma21 && !priceAboveEma50 && rsi14 < 50
          ? "Цена ниже обеих EMA, и RSI ниже нейтральной середины — эти показатели согласованы."
          : `Цена относительно EMA и RSI расходятся: ${pricePosition.toLowerCase()} RSI — ${rsiDescription.toLowerCase()}.`;
  const volumeDescription =
    volumeRatio20 >= 1.2
      ? "Объём выше среднего и подтверждает повышенную активность текущей свечи."
      : volumeRatio20 <= 0.8
        ? "Объём ниже среднего и не подтверждает повышенную активность текущей свечи."
        : "Объём близок к среднему и не даёт отдельного сильного подтверждения.";
  const mosesExplanation = [
    emaRsiRelationship,
    rsiMacdAgreement,
    `${volumeDescription} Сценарий «${data.scenario}» — описание текущей комбинации показателей, а не прогноз будущей цены.`,
  ].join(" ");

  return [
    `BTCUSDT · ${timeframeLabel[data.timeframe]}`,
    "",
    "1) Цена и изменение",
    `Цена: ${formatPrice(price)}`,
    `Изменение за 24ч: ${formatPercent(data.market.change24hPercent)}`,
    "",
    "2) Тренд",
    `Тренд: ${data.trend}`,
    `${pricePosition} ${emaAlignment}.`,
    "",
    "3) Импульс — RSI и MACD",
    `RSI 14: ${rsi14.toFixed(2)} — ${rsiDescription}.`,
    `MACD: ${macd.toFixed(2)} · сигнал: ${signal.toFixed(2)} · гистограмма: ${histogram.toFixed(2)}.`,
    `${macdDescription}.`,
    "",
    "4) Объём",
    `Текущий объём: ${formatBtc(candleVolume)} · средний за 20 свечей: ${formatBtc(averageVolume20)} · ${volumeRatio20.toFixed(2)}× от среднего.`,
    "",
    "5) EMA 21/50",
    `EMA 21: ${formatPrice(ema21)}`,
    `EMA 50: ${formatPrice(ema50)}`,
    "",
    "6) Поддержка и сопротивление",
    `Поддержка: ${formatPrice(data.levels.support)}`,
    `Сопротивление: ${formatPrice(data.levels.resistance)}`,
    "",
    "7) Анализ Моисея",
    mosesExplanation,
  ].join("\n");
};

const sendMessage = async (
  token: string,
  chatId: number,
  text: string,
): Promise<void> => {
  await telegramRequest(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
};

const parseCommand = (text: string): { command: string; argument?: string } => {
  const [rawCommand, rawArgument] = text.trim().split(/\s+/, 2);
  return {
    command: rawCommand.toLowerCase().split("@", 1)[0],
    argument: rawArgument?.toUpperCase(),
  };
};

const handleMessage = async (token: string, message: TelegramMessage): Promise<void> => {
  if (!message.text) return;
  const { command, argument } = parseCommand(message.text);
  try {
    await registerPaperAlertRecipient(message.chat.id);
    void deliverPendingPaperAlerts((chatId, event) =>
      sendMessage(token, chatId, formatPaperAlertMessage(event)),
    );
  } catch (error) {
    logger.warn({ error }, "Could not register Telegram paper alert recipient");
  }

  if (command === "/start" || command === "/help") {
    await sendMessage(token, message.chat.id, helpText);
    return;
  }
  if (command === "/paper") {
    const subcommand = argument?.toLowerCase() ?? "status";
    if (!["status", "monitor", "trades", "stats", "alerts", "journal", "lessons"].includes(subcommand)) {
      await sendMessage(
        token,
        message.chat.id,
        "Используйте /paper, /paper status, /paper monitor, /paper trades, /paper stats, /paper alerts, /paper journal или /paper lessons.",
      );
      return;
    }
    try {
      await refreshPaperTrading();
      let response: string;
      if (subcommand === "alerts") {
        response = formatPaperAlerts(await getRecentPaperAlertEvents());
      } else if (subcommand === "journal") {
        response = formatPaperJournal(await getRecentPaperTradeJournals());
      } else if (subcommand === "lessons") {
        response = formatPaperLessons(await getPaperLessons());
      } else {
        const snapshot = await getPaperAccountSnapshot();
        response =
          subcommand === "trades"
            ? formatPaperTrades(snapshot)
            : subcommand === "monitor"
              ? formatPaperMonitor(snapshot)
              : subcommand === "stats"
                ? formatPaperStats(snapshot)
                : formatPaperStatus(snapshot);
      }
      await sendMessage(token, message.chat.id, response);
    } catch (error) {
      logger.warn({ error }, "Telegram paper trading command failed");
      await sendMessage(
        token,
        message.chat.id,
        `Не удалось обновить TEST TRADING: ${error instanceof Error ? error.message : "внутренняя ошибка"}. Попробуйте ещё раз.`,
      );
    }
    return;
  }
  if (command !== "/btc") return;

  const timeframe = argument ?? "4H";
  if (!isBtcTimeframe(timeframe)) {
    await sendMessage(
      token,
      message.chat.id,
      "Неизвестный таймфрейм. Используйте /btc, /btc 1h, /btc 4h, /btc 1d или /btc 1w.",
    );
    return;
  }

  try {
    const data = await getBtcMarketAnalysis(timeframe);
    await sendMessage(token, message.chat.id, formatAnalysis(data));
  } catch (error) {
    const reason =
      error instanceof BtcMarketDataError
        ? error.message
        : "внутренняя ошибка аналитического модуля";
    logger.warn({ timeframe, reason }, "Telegram BTC analysis failed");
    await sendMessage(
      token,
      message.chat.id,
      `Не удалось получить анализ BTCUSDT: ${reason}. Попробуйте ещё раз через несколько секунд.`,
    );
  }
};

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export const startTelegramBot = (): (() => void) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    logger.info("Telegram bot is disabled: TELEGRAM_BOT_TOKEN is not configured");
    return () => undefined;
  }

  const controller = new AbortController();
  let stopped = false;
  let offset = 0;
  const retryPaperAlerts = () => {
    void deliverPendingPaperAlerts((chatId, event) =>
      sendMessage(token, chatId, formatPaperAlertMessage(event)),
    ).catch((error) => {
      logger.warn({ error }, "Paper alert retry loop failed");
    });
  };
  const alertRetryInterval = setInterval(retryPaperAlerts, 15_000);
  retryPaperAlerts();

  const poll = async (): Promise<void> => {
    logger.info("Telegram bot polling started");
    while (!stopped) {
      try {
        const updates = await telegramRequest<TelegramUpdate[]>(token, "getUpdates", {
          offset,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: ["message"],
        }, controller.signal);
        for (const update of updates) {
          offset = Math.max(offset, update.update_id + 1);
          if (update.message) {
            await handleMessage(token, update.message);
          }
        }
      } catch (error) {
        if (stopped || controller.signal.aborted) return;
        logger.warn(
          { error: error instanceof Error ? error.message : error },
          "Telegram polling failed; retrying",
        );
        await sleep(2_000);
      }
    }
  };

  void poll();
  return () => {
    stopped = true;
    controller.abort();
    clearInterval(alertRetryInterval);
    logger.info("Telegram bot polling stopped");
  };
};