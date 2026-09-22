export type BtcTimeframe = "1H" | "4H" | "1D" | "1W";

type TimeframeConfig = {
  interval: "1h" | "4h" | "1d" | "1w";
  historyLimit: number;
};

type BinanceTicker = {
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
};

type BinanceKline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
];

type TechnicalPoint = {
  close: number;
  high: number;
  low: number;
  volume: number;
  ema21: number | null;
  ema50: number | null;
  rsi14: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};

export type AnalysisSection = {
  value: string;
  reason: string;
};

export type BtcMarketAnalysis = {
  symbol: "BTCUSDT";
  timeframe: BtcTimeframe;
  source: "binance";
  fetchedAt: string;
  market: {
    price: number;
    change24hPercent: number;
    high24h: number;
    low24h: number;
    quoteVolume24h: number;
  };
  indicators: {
    ema21: number;
    ema50: number;
    rsi14: number;
    macd: number;
    signal: number;
    histogram: number;
    candleVolume: number;
    averageVolume20: number;
    volumeRatio20: number;
  };
  levels: {
    support: number;
    resistance: number;
  };
  trend: string;
  scenario: string;
  analysis: {
    trend: AnalysisSection;
    impulse: AnalysisSection;
    volume: AnalysisSection;
    levels: AnalysisSection;
    scenario: AnalysisSection;
    text: string;
  };
};

export class BtcMarketDataError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "upstream" | "invalid",
  ) {
    super(message);
    this.name = "BtcMarketDataError";
  }
}

const BINANCE_API = "https://api.binance.com/api/v3";
const REQUEST_TIMEOUT_MS = 12_000;
const timeframeConfig: Record<BtcTimeframe, TimeframeConfig> = {
  "1H": { interval: "1h", historyLimit: 200 },
  "4H": { interval: "4h", historyLimit: 200 },
  "1D": { interval: "1d", historyLimit: 200 },
  "1W": { interval: "1w", historyLimit: 200 },
};

const formatPrice = (value: number) =>
  `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const formatBtc = (value: number) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} BTC`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const fetchBinanceJson = async <T>(path: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${BINANCE_API}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new BtcMarketDataError(
        `Binance вернул HTTP ${response.status}`,
        "upstream",
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof BtcMarketDataError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new BtcMarketDataError(
        "Binance не ответил в течение 12 секунд",
        "timeout",
      );
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new BtcMarketDataError(
        "Binance не ответил в течение 12 секунд",
        "timeout",
      );
    }
    throw new BtcMarketDataError(
      "Не удалось получить данные из Binance",
      "upstream",
    );
  } finally {
    clearTimeout(timeout);
  }
};

const calculateEma = (values: number[], period: number): (number | null)[] => {
  const result = Array<number | null>(values.length).fill(null);
  if (values.length < period) return result;
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  result[period - 1] = ema;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    ema = (values[index] - ema) * multiplier + ema;
    result[index] = ema;
  }
  return result;
};

const calculateRsi = (values: number[], period = 14): (number | null)[] => {
  const result = Array<number | null>(values.length).fill(null);
  if (values.length <= period) return result;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  result[period] =
    averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] =
      averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
};

const calculatePoints = (candles: BinanceKline[]): TechnicalPoint[] => {
  const closes = candles.map((candle) => Number(candle[4]));
  const ema21 = calculateEma(closes, 21);
  const ema50 = calculateEma(closes, 50);
  const rsi14 = calculateRsi(closes);
  const fastEma = calculateEma(closes, 12);
  const slowEma = calculateEma(closes, 26);
  const macd = closes.map((_, index) =>
    fastEma[index] !== null && slowEma[index] !== null
      ? fastEma[index] - slowEma[index]
      : null,
  );
  const signal = calculateEma(
    macd.filter((value): value is number => value !== null),
    9,
  );
  const macdOffset = macd.findIndex((value) => value !== null);

  return candles.map((candle, index) => {
    const macdValue = macd[index];
    const signalValue =
      index >= macdOffset ? signal[index - macdOffset] : null;
    return {
      close: closes[index],
      high: Number(candle[2]),
      low: Number(candle[3]),
      volume: Number(candle[5]),
      ema21: ema21[index],
      ema50: ema50[index],
      rsi14: rsi14[index],
      macd: macdValue,
      signal: signalValue,
      histogram:
        macdValue !== null && signalValue !== null
          ? macdValue - signalValue
          : null,
    };
  });
};

const buildAnalysis = (
  points: TechnicalPoint[],
  ticker: BinanceTicker,
  timeframe: BtcTimeframe,
): BtcMarketAnalysis => {
  const latest = points.at(-1);
  if (
    !latest ||
    latest.ema21 === null ||
    latest.ema50 === null ||
    latest.rsi14 === null ||
    latest.macd === null ||
    latest.signal === null ||
    latest.histogram === null
  ) {
    throw new BtcMarketDataError(
      `Недостаточно свечей Binance для расчёта ${timeframe}`,
      "invalid",
    );
  }

  const price = Number(ticker.lastPrice);
  const recent = points.slice(-50);
  const recentVolume = points.slice(-20);
  const averageVolume20 =
    recentVolume.reduce((sum, point) => sum + point.volume, 0) /
    recentVolume.length;
  const volumeRatio20 = averageVolume20 > 0 ? latest.volume / averageVolume20 : 1;
  const support = Math.min(...recent.map((point) => point.low));
  const resistance = Math.max(...recent.map((point) => point.high));
  const trend =
    price > latest.ema21 && latest.ema21 > latest.ema50
      ? "Восходящий"
      : price < latest.ema21 && latest.ema21 < latest.ema50
        ? "Нисходящий"
        : "Боковой";
  const priceVsEma21 = price >= latest.ema21 ? "выше" : "ниже";
  const emaAlignment = latest.ema21 >= latest.ema50 ? "выше" : "ниже";
  const trendSection: AnalysisSection = {
    value: trend,
    reason: `Цена ${formatPrice(price)} ${priceVsEma21} EMA 21 (${formatPrice(latest.ema21)}), а EMA 21 ${emaAlignment} EMA 50 (${formatPrice(latest.ema50)}).`,
  };

  const rsiState =
    latest.rsi14 >= 70
      ? "перегретость"
      : latest.rsi14 <= 30
        ? "перепроданность"
        : latest.rsi14 >= 50
          ? "положительная зона"
          : "отрицательная зона";
  const macdAboveSignal = latest.macd >= latest.signal;
  const impulse =
    macdAboveSignal && latest.rsi14 >= 50
      ? "Положительный"
      : !macdAboveSignal && latest.rsi14 < 50
        ? "Отрицательный"
        : "Смешанный";
  const impulseSection: AnalysisSection = {
    value: impulse,
    reason: `RSI 14: ${latest.rsi14.toFixed(2)} (${rsiState}); MACD ${latest.macd.toFixed(2)} ${macdAboveSignal ? "выше" : "ниже"} сигнала ${latest.signal.toFixed(2)}, гистограмма ${latest.histogram.toFixed(2)}.`,
  };

  const volumeValue =
    volumeRatio20 >= 1.2
      ? "Выше среднего"
      : volumeRatio20 <= 0.8
        ? "Ниже среднего"
        : "Около среднего";
  const volumeSection: AnalysisSection = {
    value: volumeValue,
    reason: `Последняя свеча: ${formatBtc(latest.volume)}; средний объём 20 свечей: ${formatBtc(averageVolume20)} (${(volumeRatio20 * 100).toFixed(0)}% от среднего).`,
  };

  const supportDistance = ((price - support) / price) * 100;
  const resistanceDistance = ((resistance - price) / price) * 100;
  const levelsSection: AnalysisSection = {
    value: `${formatPrice(support)} — ${formatPrice(resistance)}`,
    reason: `Поддержка ${formatPrice(support)} на ${supportDistance.toFixed(1)}% ниже цены; сопротивление ${formatPrice(resistance)} на ${resistanceDistance.toFixed(1)}% выше.`,
  };

  const trendScore = trend === "Восходящий" ? 2 : trend === "Нисходящий" ? -2 : 0;
  const impulseScore = impulse === "Положительный" ? 1 : impulse === "Отрицательный" ? -1 : 0;
  const volumeScore =
    volumeRatio20 >= 1.2 ? (trendScore > 0 ? 1 : trendScore < 0 ? -1 : 0) : 0;
  const levelScore = resistanceDistance <= 2 ? -1 : supportDistance <= 2 ? 1 : 0;
  const scenarioScore = trendScore + impulseScore + volumeScore + levelScore;
  const scenario =
    scenarioScore >= 2
      ? "Бычий сценарий"
      : scenarioScore <= -2
        ? "Медвежий сценарий"
        : "Нейтральный сценарий";
  const scenarioSection: AnalysisSection = {
    value: scenario,
    reason: `Сценарий собран из признаков: тренд «${trendSection.value}», импульс «${impulseSection.value}», объём «${volumeSection.value.toLowerCase()}» и положение цены внутри зоны уровней.`,
  };

  return {
    symbol: "BTCUSDT",
    timeframe,
    source: "binance",
    fetchedAt: new Date().toISOString(),
    market: {
      price,
      change24hPercent: Number(ticker.priceChangePercent),
      high24h: Number(ticker.highPrice),
      low24h: Number(ticker.lowPrice),
      quoteVolume24h: Number(ticker.quoteVolume),
    },
    indicators: {
      ema21: latest.ema21,
      ema50: latest.ema50,
      rsi14: latest.rsi14,
      macd: latest.macd,
      signal: latest.signal,
      histogram: latest.histogram,
      candleVolume: latest.volume,
      averageVolume20,
      volumeRatio20,
    },
    levels: { support, resistance },
    trend,
    scenario,
    analysis: {
      trend: trendSection,
      impulse: impulseSection,
      volume: volumeSection,
      levels: levelsSection,
      scenario: scenarioSection,
      text: `${trendSection.value} тренд. ${impulseSection.value} импульс. Объём ${volumeSection.value.toLowerCase()}. Диапазон уровней ${levelsSection.value}. Итог: ${scenarioSection.value}.`,
    },
  };
};

export const isBtcTimeframe = (value: string): value is BtcTimeframe =>
  value in timeframeConfig;

export const getBtcMarketAnalysis = async (
  timeframe: BtcTimeframe,
): Promise<BtcMarketAnalysis> => {
  const config = timeframeConfig[timeframe];
  const [ticker, candles] = await Promise.all([
    fetchBinanceJson<BinanceTicker>("/ticker/24hr?symbol=BTCUSDT"),
    fetchBinanceJson<BinanceKline[]>(
      `/klines?symbol=BTCUSDT&interval=${config.interval}&limit=${config.historyLimit}`,
    ),
  ]);
  if (
    !isRecord(ticker) ||
    !Array.isArray(candles) ||
    candles.length < 50 ||
    !Number.isFinite(Number(ticker.lastPrice))
  ) {
    throw new BtcMarketDataError(
      "Binance вернул неполный набор данных BTCUSDT",
      "invalid",
    );
  }
  return buildAnalysis(calculatePoints(candles), ticker, timeframe);
};