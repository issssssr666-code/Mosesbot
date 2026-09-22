import {
  getRecentBacktestReports,
  type BacktestReport,
  type BacktestTrade,
} from "./backtesting";
import type { BtcTimeframe } from "./btc-market-analysis";

const TIMEFRAMES: BtcTimeframe[] = ["1H", "4H", "1D", "1W"];
const DIRECTIONS = ["LONG", "SHORT"] as const;
const MIN_VALIDATION_TRADES = 50;
const CALIBRATION_FRACTION = 0.7;
const WILSON_Z = 1.96;

export type CalibratedDirection = (typeof DIRECTIONS)[number];

export type ConfidenceCalibration = {
  timeframe: BtcTimeframe;
  direction: CalibratedDirection;
  eligible: boolean;
  probability: number | null;
  lowerBound: number | null;
  validationTrades: number;
  validationWins: number;
  sourceTrades: number;
  reason: string;
};

const wilsonLowerBound = (wins: number, total: number): number => {
  if (total <= 0) return 0;
  const p = wins / total;
  const zSquared = WILSON_Z ** 2;
  const denominator = 1 + zSquared / total;
  const center = p + zSquared / (2 * total);
  const margin =
    WILSON_Z *
    Math.sqrt((p * (1 - p) + zSquared / (4 * total)) / total);
  return (center - margin) / denominator;
};

const latestReportsByTimeframe = (reports: BacktestReport[]): Map<BtcTimeframe, BacktestReport> => {
  const latest = new Map<BtcTimeframe, BacktestReport>();
  for (const report of reports) {
    if (!latest.has(report.timeframe)) latest.set(report.timeframe, report);
  }
  return latest;
};

const calibrate = (
  timeframe: BtcTimeframe,
  direction: CalibratedDirection,
  report?: BacktestReport,
): ConfidenceCalibration => {
  const trades = (report?.trades ?? [])
    .filter((trade) => trade.direction === direction)
    .sort(
      (left, right) =>
        new Date(left.entryTime).getTime() - new Date(right.entryTime).getTime(),
    );
  const splitIndex = Math.floor(trades.length * CALIBRATION_FRACTION);
  const validationTrades = trades.slice(splitIndex);
  const validationWins = validationTrades.filter((trade) => trade.pnl > 0).length;
  const probability =
    validationTrades.length > 0
      ? (validationWins / validationTrades.length) * 100
      : null;
  const lowerBound =
    validationTrades.length > 0
      ? wilsonLowerBound(validationWins, validationTrades.length) * 100
      : null;
  const eligible =
    validationTrades.length >= MIN_VALIDATION_TRADES &&
    lowerBound !== null &&
    lowerBound >= 90;
  let reason = "";
  if (!report) {
    reason = "Нет сохранённого backtest для этого таймфрейма.";
  } else if (validationTrades.length < MIN_VALIDATION_TRADES) {
    reason = `Нужно минимум ${MIN_VALIDATION_TRADES} сделок на независимом проверочном отрезке; сейчас ${validationTrades.length}.`;
  } else if ((lowerBound ?? 0) < 90) {
    reason = `Нижняя граница 95% интервала — ${(lowerBound ?? 0).toFixed(1)}%, ниже порога 90%.`;
  } else {
    reason = "Калибровочный порог 90% подтверждён.";
  }
  return {
    timeframe,
    direction,
    eligible,
    probability,
    lowerBound,
    validationTrades: validationTrades.length,
    validationWins,
    sourceTrades: trades.length,
    reason,
  };
};

export const getConfidenceCalibration = async (): Promise<ConfidenceCalibration[]> => {
  const reports = await getRecentBacktestReports(20);
  const latest = latestReportsByTimeframe(reports);
  return TIMEFRAMES.flatMap((timeframe) =>
    DIRECTIONS.map((direction) => calibrate(timeframe, direction, latest.get(timeframe))),
  );
};

export const isCalibratedConfidenceEligible = (
  calibrations: ConfidenceCalibration[],
  timeframe: BtcTimeframe,
  direction: CalibratedDirection,
): boolean =>
  calibrations.some(
    (calibration) =>
      calibration.timeframe === timeframe &&
      calibration.direction === direction &&
      calibration.eligible,
  );
