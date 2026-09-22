import { logger } from "./logger";
import {
  BtcMarketDataError,
  getBtcMarketAnalysis,
  isBtcTimeframe,
  type BtcMarketAnalysis,
  type BtcTimeframe,
} from "./btc-market-analysis";

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
): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
  }
};

const formatPrice = (value: number) =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const formatBtc = (value: number) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} BTC`;

const formatPercent = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

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
].join("\n");

const formatAnalysis = (data: BtcMarketAnalysis): string =>
  [
    `BTCUSDT · ${timeframeLabel[data.timeframe]}`,
    `Цена: ${formatPrice(data.market.price)}`,
    `Изменение 24ч: ${formatPercent(data.market.change24hPercent)}`,
    "",
    `EMA 21 / EMA 50: ${formatPrice(data.indicators.ema21)} / ${formatPrice(data.indicators.ema50)}`,
    `RSI 14: ${data.indicators.rsi14.toFixed(2)}`,
    `MACD: ${data.indicators.macd.toFixed(2)} · сигнал: ${data.indicators.signal.toFixed(2)} · гистограмма: ${data.indicators.histogram.toFixed(2)}`,
    `Объём: ${formatBtc(data.indicators.candleVolume)} · средний за 20 свечей: ${formatBtc(data.indicators.averageVolume20)}`,
    `Поддержка: ${formatPrice(data.levels.support)}`,
    `Сопротивление: ${formatPrice(data.levels.resistance)}`,
    "",
    `Тренд: ${data.trend}`,
    `Сценарий: ${data.scenario}`,
    `Анализ Моисея: ${data.analysis.text}`,
  ].join("\n");

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

  if (command === "/start" || command === "/help") {
    await sendMessage(token, message.chat.id, helpText);
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

  const poll = async (): Promise<void> => {
    logger.info("Telegram bot polling started");
    while (!stopped) {
      try {
        const updates = await telegramRequest<TelegramUpdate[]>(token, "getUpdates", {
          offset,
          timeout: POLL_TIMEOUT_SECONDS,
          allowed_updates: ["message"],
        });
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
    logger.info("Telegram bot polling stopped");
  };
};