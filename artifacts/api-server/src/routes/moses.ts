import { Router, type IRouter } from "express";
import {
  BtcMarketDataError,
  getBtcMarketAnalysis,
  isBtcTimeframe,
  type BtcTimeframe,
} from "../lib/btc-market-analysis";

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

export default router;