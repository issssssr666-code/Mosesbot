import { Router, type IRouter } from "express";
import {
  BtcMarketDataError,
  getBtcMarketAnalysis,
  isBtcTimeframe,
  type BtcTimeframe,
} from "../lib/btc-market-analysis";
import { getMosesContext } from "../lib/market-sentiment";
import {
  getMarketIntelligence,
  getMarketIntelligenceHistory,
  MarketIntelligenceError,
} from "../lib/market-intelligence";

const router: IRouter = Router();

router.get("/moses/btc-analysis", async (req, res): Promise<void> => {
  const rawTimeframe = req.query.timeframe;
  const timeframe =
    typeof rawTimeframe === "string" ? rawTimeframe.toUpperCase() : "4H";

  if (!isBtcTimeframe(timeframe)) {
    res.status(400).json({
      error: "Неверный timeframe. Используйте 1H, 4H, 1D или 1W.",
    });
    return;
  }

  try {
    const data = await getBtcMarketAnalysis(timeframe as BtcTimeframe);
    res.json(data);
  } catch (error) {
    if (error instanceof BtcMarketDataError) {
      req.log.warn({ timeframe, kind: error.kind }, error.message);
      res.status(error.kind === "timeout" ? 504 : 502).json({
        error: error.message,
        source: "binance",
        timeframe,
      });
      return;
    }
    req.log.error({ timeframe, error }, "Unexpected BTC analysis error");
    res.status(500).json({
      error: "Внутренняя ошибка расчёта BTC-анализа",
      timeframe,
    });
  }
});

router.get("/moses/market-context", async (req, res): Promise<void> => {
  const rawTimeframe = req.query.timeframe;
  const timeframe =
    typeof rawTimeframe === "string" ? rawTimeframe.toUpperCase() : "4H";
  if (!isBtcTimeframe(timeframe)) {
    res.status(400).json({
      error: "Неверный timeframe. Используйте 1H, 4H, 1D или 1W.",
    });
    return;
  }
  try {
    res.json(await getMosesContext(timeframe as BtcTimeframe));
  } catch (error) {
    req.log.warn(
      { timeframe, error: error instanceof Error ? error.message : error },
      "Moses market context failed",
    );
    res.status(502).json({
      error: error instanceof Error ? error.message : "Не удалось собрать рыночный фон.",
      timeframe,
    });
  }
});

router.get("/moses/market-intelligence", async (req, res): Promise<void> => {
  const rawTimeframe = req.query.timeframe;
  const timeframe =
    typeof rawTimeframe === "string" ? rawTimeframe.toUpperCase() : "4H";
  if (!isBtcTimeframe(timeframe)) {
    res.status(400).json({
      error: "Неверный timeframe. Используйте 1H, 4H, 1D или 1W.",
    });
    return;
  }
  try {
    res.json(await getMarketIntelligence(timeframe as BtcTimeframe));
  } catch (error) {
    const status = error instanceof MarketIntelligenceError && error.kind === "timeout" ? 504 : 502;
    req.log.warn(
      { timeframe, error: error instanceof Error ? error.message : error },
      "Market intelligence failed",
    );
    res.status(status).json({
      error: error instanceof Error ? error.message : "Не удалось собрать поведение рынка.",
      timeframe,
    });
  }
});

router.get("/moses/market-intelligence/history", async (req, res): Promise<void> => {
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : 20;
  try {
    res.json(await getMarketIntelligenceHistory(limit));
  } catch (error) {
    req.log.error(
      { limit, error: error instanceof Error ? error.message : error },
      "Market intelligence history failed",
    );
    res.status(500).json({ error: "Не удалось прочитать историю поведения рынка." });
  }
});

export default router;