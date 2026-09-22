import { desc } from "drizzle-orm";
import {
  db,
  marketMetricsTable,
  type MarketMetric,
} from "@workspace/db";
import {
  type BinanceKline,
  type BtcTimeframe,
} from "./btc-market-analysis";

const SPOT_API = "https://api.binance.com/api/v3";
const FUTURES_API = "https://fapi.binance.com";
const REQUEST_TIMEOUT_MS = 12_000;
const CANDLE_LIMIT = 120;

type TimeframeConfig = {
  interval: "1h" | "4h" | "1d" | "1w";
  derivativePeriod: "1h" | "4h" | "1d";
};

const timeframeConfig: Record<BtcTimeframe, TimeframeConfig> = {
  "1H": { interval: "1h", derivativePeriod: "1h" },
  "4H": { interval: "4h", derivativePeriod: "4h" },
  "1D": { interval: "1d", derivativePeriod: "1d" },
  "1W": { interval: "1d", derivativePeriod: "1d" },
};

type BinanceTicker = {
  lastPrice: string;
};

type OpenInterest = {
  openInterest: string;
};

type OpenInterestHistory = {
  sumOpenInterest: string;
  timestamp: number;
}[];

type PremiumIndex = {
  lastFundingRate: string;
  time: number;
};

type LongShortRatio = {
  longShortRatio: string;
  timestamp: number;
}[];

type ForceOrder = {
  side: "BUY" | "SELL";
  price: string;
  origQty: string;
  time: number;
};

export type MarketIntelligenceSource = {
  source: string;
  ok: boolean;
  error?: string;
};

export type MarketBehavior =
  | "Накопление"
  | "Распределение"
  | "Сильный покупательский интерес"
  | "Сильное продавцовое давление"
  | "Смешанное поведение";

export type VolatilityState = "Расширение" | "Сжатие" | "Стабильная";

export type MarketIntelligence = {
  symbol: "BTCUSDT";
  timeframe: BtcTimeframe;
  source: "binance";
  fetchedAt: string;
  signalCandleTime: string;
  stale: boolean;
  historyStored: boolean;
  volume: {
    current: number;
    average20: number;
    ratio20: number;
    changePercent: number;
    spike: boolean;
  };
  volatility: {
    atr14: number;
    atrPercent: number;
    candleRangePercent: number;
    averageRangePercent: number;
    changeRatio: number;
    state: VolatilityState;
    unusualMove: boolean;
  };
  derivatives: {
    openInterest: number | null;
    openInterestChangePercent: number | null;
    fundingRate: number | null;
    longShortRatio: number | null;
    liquidations: {
      longUsd: number;
      shortUsd: number;
      totalUsd: number;
    } | null;
  };
  pressureScore: number;
  pressureLabel: "Покупатели" | "Продавцы" | "Нейтральное";
  behavior: MarketBehavior;
  risks: string[];
  sources: MarketIntelligenceSource[];
};

export class MarketIntelligenceError extends Error {
  constructor(
    message: string,
    public readonly kind: "timeout" | "upstream" | "invalid",
  ) {
    super(message);
    this.name = "MarketIntelligenceError";
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const fetchJson = async <T>(baseUrl: string, path: string): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new MarketIntelligenceError(
        `Binance вернул HTTP ${response.status}`,
        "upstream",
      );
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof MarketIntelligenceError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new MarketIntelligenceError(
        "Binance не ответил в течение 12 секунд",
        "timeout",
      );
    }
    throw new MarketIntelligenceError(
      "Не удалось получить данные Binance",
      "upstream",
    );
  } finally {
    clearTimeout(timeout);
  }
};

const optional = async <T>(
  source: string,
  request: Promise<T>,
): Promise<{ value: T | null; status: MarketIntelligenceSource }> => {
  try {
    return {
      value: await request,
      status: { source, ok: true },
    };
  } catch (error) {
    return {
      value: null,
      status: {
        source,
        ok: false,
        error: error instanceof Error ? error.message : "Источник недоступен",
      },
    };
  }
};

const average = (values: number[]): number =>
  values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;

const calculateAtr = (candles: BinanceKline[], period = 14): number => {
  const ranges = candles.slice(1).map((candle, index) => {
    const previousClose = Number(candles[index][4]);
    const high = Number(candle[2]);
    const low = Number(candle[3]);
    return Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
  });
  return average(ranges.slice(-period));
};

const calculateRangePercents = (candles: BinanceKline[]): number[] =>
  candles.map((candle) => {
    const close = Number(candle[4]);
    return close > 0 ? ((Number(candle[2]) - Number(candle[3])) / close) * 100 : 0;
  });

const formatError = (error: unknown): string =>
  error instanceof Error ? error.message : "Источник недоступен";

const deriveBehavior = (
  pressureScore: number,
  volumeRatio: number,
  priceChangePercent: number,
): MarketBehavior => {
  if (pressureScore >= 38) return "Сильный покупательский интерес";
  if (pressureScore <= -38) return "Сильное продавцовое давление";
  if (pressureScore >= 12 && volumeRatio < 1 && priceChangePercent >= 0) {
    return "Накопление";
  }
  if (pressureScore <= -12 && volumeRatio < 1 && priceChangePercent <= 0) {
    return "Распределение";
  }
  return "Смешанное поведение";
};

const buildRisks = (
  volatility: MarketIntelligence["volatility"],
  derivatives: MarketIntelligence["derivatives"],
  sources: MarketIntelligenceSource[],
): string[] => {
  const risks: string[] = [];
  if (volatility.unusualMove || volatility.state === "Расширение") {
    risks.push("Волатильность расширяется: возрастает риск резкого движения.");
  }
  if (derivatives.fundingRate !== null && Math.abs(derivatives.fundingRate) >= 0.0005) {
    risks.push("Funding отклонился от нейтральной зоны: позиции могут быть перегружены.");
  }
  if (
    derivatives.liquidations &&
    derivatives.liquidations.totalUsd >= 10_000_000
  ) {
    risks.push("За последним окном прошёл заметный кластер ликвидаций.");
  }
  const failedDerivatives = sources.filter(
    (source) => !source.ok && source.source !== "Binance spot candles",
  );
  if (failedDerivatives.length > 0) {
    risks.push("Часть деривативных данных недоступна и не использована в оценке.");
  }
  if (risks.length === 0) {
    risks.push("Явных аномалий в текущем окне не обнаружено.");
  }
  return risks;
};

const saveMetric = async (
  intelligence: MarketIntelligence,
): Promise<boolean> => {
  try {
    await db
      .insert(marketMetricsTable)
      .values({
        symbol: intelligence.symbol,
        timeframe: intelligence.timeframe,
        signalCandleTime: new Date(intelligence.signalCandleTime),
        price: intelligence.volume.current.toFixed(8),
        volume: intelligence.volume.current.toFixed(8),
        averageVolume: intelligence.volume.average20.toFixed(8),
        volumeRatio: intelligence.volume.ratio20.toFixed(6),
        atr: intelligence.volatility.atr14.toFixed(8),
        volatilityPercent: intelligence.volatility.atrPercent.toFixed(6),
        openInterest:
          intelligence.derivatives.openInterest === null
            ? null
            : intelligence.derivatives.openInterest.toFixed(8),
        fundingRate:
          intelligence.derivatives.fundingRate === null
            ? null
            : intelligence.derivatives.fundingRate.toFixed(10),
        longShortRatio:
          intelligence.derivatives.longShortRatio === null
            ? null
            : intelligence.derivatives.longShortRatio.toFixed(8),
        longLiquidationsUsd:
          intelligence.derivatives.liquidations === null
            ? null
            : intelligence.derivatives.liquidations.longUsd.toFixed(8),
        shortLiquidationsUsd:
          intelligence.derivatives.liquidations === null
            ? null
            : intelligence.derivatives.liquidations.shortUsd.toFixed(8),
        pressureScore: intelligence.pressureScore,
        behavior: intelligence.behavior,
        sources: intelligence.sources,
      })
      .onConflictDoNothing({
        target: [
          marketMetricsTable.symbol,
          marketMetricsTable.timeframe,
          marketMetricsTable.signalCandleTime,
        ],
      });
    return true;
  } catch {
    return false;
  }
};

export const getMarketIntelligenceHistory = async (
  limit = 20,
): Promise<MarketMetric[]> =>
  db
    .select()
    .from(marketMetricsTable)
    .orderBy(desc(marketMetricsTable.measuredAt))
    .limit(Math.min(Math.max(limit, 1), 100));

export const getMarketIntelligence = async (
  timeframe: BtcTimeframe = "4H",
): Promise<MarketIntelligence> => {
  const config = timeframeConfig[timeframe];
  const [ticker, candles] = await Promise.all([
    fetchJson<BinanceTicker>(SPOT_API, "/ticker/24hr?symbol=BTCUSDT"),
    fetchJson<BinanceKline[]>(
      `${SPOT_API}`,
      `/klines?symbol=BTCUSDT&interval=${config.interval}&limit=${CANDLE_LIMIT}`,
    ),
  ]);
  const closedCandles = candles.filter((candle) => candle[6] <= Date.now());
  const price = Number(ticker.lastPrice);
  if (
    !isRecord(ticker) ||
    !Array.isArray(closedCandles) ||
    closedCandles.length < 50 ||
    !Number.isFinite(price)
  ) {
    throw new MarketIntelligenceError(
      "Binance вернул неполный набор данных для Market Intelligence",
      "invalid",
    );
  }

  const [openInterest, openInterestHistory, funding, longShort, forceOrders] =
    await Promise.all([
      optional(
        "Binance open interest",
        fetchJson<OpenInterest>(
          FUTURES_API,
          "/fapi/v1/openInterest?symbol=BTCUSDT",
        ),
      ),
      optional(
        "Binance open interest history",
        fetchJson<OpenInterestHistory>(
          FUTURES_API,
          `/futures/data/openInterestHist?symbol=BTCUSDT&period=${config.derivativePeriod}&limit=2`,
        ),
      ),
      optional(
        "Binance funding rate",
        fetchJson<PremiumIndex>(
          FUTURES_API,
          "/fapi/v1/premiumIndex?symbol=BTCUSDT",
        ),
      ),
      optional(
        "Binance long/short ratio",
        fetchJson<LongShortRatio>(
          FUTURES_API,
          `/futures/data/globalLongShortAccountRatio?symbol=BTCUSDT&period=${config.derivativePeriod}&limit=1`,
        ),
      ),
      optional(
        "Binance liquidation orders",
        fetchJson<ForceOrder[]>(
          FUTURES_API,
          "/fapi/v1/allForceOrders?symbol=BTCUSDT&limit=100",
        ),
      ),
    ]);

  const latest = closedCandles.at(-1);
  const previous = closedCandles.at(-2);
  if (!latest || !previous) {
    throw new MarketIntelligenceError(
      "Недостаточно закрытых свечей для Market Intelligence",
      "invalid",
    );
  }
  const latestClose = Number(latest[4]);
  const previousClose = Number(previous[4]);
  const volume = Number(latest[5]);
  const previousVolumes = closedCandles.slice(-21, -1).map((candle) => Number(candle[5]));
  const averageVolume20 = average(previousVolumes);
  const volumeRatio = averageVolume20 > 0 ? volume / averageVolume20 : 1;
  const volumeChangePercent =
    averageVolume20 > 0 ? ((volume / averageVolume20) - 1) * 100 : 0;
  const rangePercents = calculateRangePercents(closedCandles);
  const averageRangePercent = average(rangePercents.slice(-21, -1));
  const priorRangeAverage = average(rangePercents.slice(-41, -21));
  const recentRangeAverage = average(rangePercents.slice(-5));
  const changeRatio =
    priorRangeAverage > 0 ? recentRangeAverage / priorRangeAverage : 1;
  const atr14 = calculateAtr(closedCandles);
  const candleRangePercent =
    latestClose > 0 ? ((Number(latest[2]) - Number(latest[3])) / latestClose) * 100 : 0;
  const volatility: MarketIntelligence["volatility"] = {
    atr14,
    atrPercent: latestClose > 0 ? (atr14 / latestClose) * 100 : 0,
    candleRangePercent,
    averageRangePercent,
    changeRatio,
    state: changeRatio >= 1.15 ? "Расширение" : changeRatio <= 0.85 ? "Сжатие" : "Стабильная",
    unusualMove:
      averageRangePercent > 0 && candleRangePercent >= averageRangePercent * 2,
  };

  const openInterestValue = openInterest.value
    ? Number(openInterest.value.openInterest)
    : null;
  const openInterestChangePercent =
    openInterestHistory.value && openInterestHistory.value.length >= 2
      ? ((Number(openInterestHistory.value.at(-1)?.sumOpenInterest) /
          Number(openInterestHistory.value.at(-2)?.sumOpenInterest)) -
          1) *
        100
      : null;
  const fundingRate = funding.value ? Number(funding.value.lastFundingRate) : null;
  const longShortRatio = longShort.value?.[0]
    ? Number(longShort.value[0].longShortRatio)
    : null;
  const liquidations = forceOrders.value
    ? forceOrders.value.reduce(
        (totals, order) => {
          const usd = Number(order.price) * Number(order.origQty);
          if (!Number.isFinite(usd)) return totals;
          if (order.side === "SELL") totals.longUsd += usd;
          if (order.side === "BUY") totals.shortUsd += usd;
          return totals;
        },
        { longUsd: 0, shortUsd: 0 },
      )
    : null;
  const normalizedLiquidations = liquidations
    ? {
        ...liquidations,
        totalUsd: liquidations.longUsd + liquidations.shortUsd,
      }
    : null;
  const priceChangePercent =
    previousClose > 0 ? ((latestClose / previousClose) - 1) * 100 : 0;
  const candlePosition =
    Number(latest[2]) > Number(latest[3])
      ? ((latestClose - Number(latest[3])) /
          (Number(latest[2]) - Number(latest[3])) -
          0.5) *
        30
      : 0;
  const priceComponent = clamp(priceChangePercent * 18, -35, 35);
  const volumeComponent = clamp((volumeRatio - 1) * 35, -20, 20);
  const openInterestComponent =
    openInterestChangePercent === null
      ? 0
      : clamp(openInterestChangePercent * (priceChangePercent >= 0 ? 1 : -1) * 1.5, -15, 15);
  const fundingComponent =
    fundingRate === null ? 0 : clamp(-fundingRate * 20_000, -8, 8);
  const pressureScore = Math.round(
    clamp(priceComponent + volumeComponent + candlePosition + openInterestComponent + fundingComponent, -100, 100),
  );
  const pressureLabel =
    pressureScore >= 15 ? "Покупатели" : pressureScore <= -15 ? "Продавцы" : "Нейтральное";
  const behavior = deriveBehavior(pressureScore, volumeRatio, priceChangePercent);
  const sources: MarketIntelligenceSource[] = [
    { source: "Binance spot candles", ok: true },
    openInterest.status,
    openInterestHistory.status,
    funding.status,
    longShort.status,
    forceOrders.status,
  ];
  const stale = Date.now() - Number(latest[6]) > 2 * 60 * 60 * 1000;
  const intelligence: MarketIntelligence = {
    symbol: "BTCUSDT",
    timeframe,
    source: "binance",
    fetchedAt: new Date().toISOString(),
    signalCandleTime: new Date(latest[0]).toISOString(),
    stale,
    historyStored: false,
    volume: {
      current: volume,
      average20: averageVolume20,
      ratio20: volumeRatio,
      changePercent: volumeChangePercent,
      spike: volumeRatio >= 1.5,
    },
    volatility,
    derivatives: {
      openInterest: finite(openInterestValue) ? openInterestValue : null,
      openInterestChangePercent: finite(openInterestChangePercent)
        ? openInterestChangePercent
        : null,
      fundingRate: finite(fundingRate) ? fundingRate : null,
      longShortRatio: finite(longShortRatio) ? longShortRatio : null,
      liquidations: normalizedLiquidations,
    },
    pressureScore,
    pressureLabel,
    behavior,
    risks: [],
    sources,
  };
  intelligence.risks = buildRisks(volatility, intelligence.derivatives, sources);
  intelligence.historyStored = await saveMetric(intelligence);
  return intelligence;
};