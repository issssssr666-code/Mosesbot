import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  Bitcoin,
  BookOpen,
  Check,
  Clock3,
  Eye,
  Filter,
  Gauge,
  LayoutDashboard,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Moon,
  Pin,
  RefreshCw,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const queryClient = new QueryClient();

type Timeframe = '1H' | '4H' | '1D' | '1W';
type ValidationFilter = 'All checks' | 'Passed' | 'Watch';

type Asset = {
  symbol: string;
  name: string;
  price: string;
  move: string;
  positive: boolean;
  tone: string;
  note: string;
};

type TechnicalPoint = {
  label: string;
  value: number;
  high: number;
  low: number;
  volume: number;
  ema21: number | null;
  ema50: number | null;
  rsi: number | null;
  macd: number | null;
  signal: number | null;
  histogram: number | null;
};
type LiveMarket = {
  price: number;
  move: number;
  high: number;
  low: number;
  quoteVolume: number;
};
type BinanceTicker = {
  lastPrice: string;
  priceChangePercent: string;
  highPrice: string;
  lowPrice: string;
  quoteVolume: string;
};
type BinanceKline = [number, string, string, string, string, string, number, string];
type AnalysisTone = 'good' | 'warn' | 'neutral';
type AnalysisSection = {
  title: string;
  value: string;
  reason: string;
  tone: AnalysisTone;
};
type TechnicalAnalysis = {
  ema21: number;
  ema50: number;
  rsi: number;
  macd: number;
  signal: number;
  histogram: number;
  volume: number;
  support: number;
  resistance: number;
  trend: 'Восходящий' | 'Нисходящий' | 'Боковой';
  trendSection: AnalysisSection;
  impulseSection: AnalysisSection;
  volumeSection: AnalysisSection;
  levelsSection: AnalysisSection;
  scenarioSection: AnalysisSection;
};
type MarketNewsItem = {
  id: number;
  source: string;
  canonicalUrl: string;
  publishedAt: string;
  title: string;
  summary: string;
  category: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  impactScore: number;
  impactDirection: 'positive' | 'neutral' | 'negative';
};
type MarketSentiment = {
  label: 'positive' | 'neutral' | 'negative';
  score: number;
  newsCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  calculatedAt: string;
  lookbackHours: number;
  topNews: MarketNewsItem[];
  risks: string[];
  sourceStatus: { source: string; ok: boolean; error?: string }[];
};
type MarketContext = {
  technical: { scenario: string };
  sentiment: MarketSentiment | null;
  alignment: string;
};
type ForumThread = {
  id: number;
  title: string;
  body: string;
  category: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  replyCount: number;
};
type ForumPost = {
  id: number;
  threadId: number;
  body: string;
  authorName: string;
  createdAt: string;
};
type ForumThreadDetail = Omit<ForumThread, 'replyCount'> & { posts: ForumPost[] };

const BINANCE_API = 'https://api.binance.com/api/v3';
const API_BASE = '/api';
const timeframeRequests: Record<Timeframe, { interval: string; historyLimit: number; displayLimit: number }> = {
  '1H': { interval: '1h', historyLimit: 200, displayLimit: 24 },
  '4H': { interval: '4h', historyLimit: 200, displayLimit: 24 },
  '1D': { interval: '1d', historyLimit: 200, displayLimit: 30 },
  '1W': { interval: '1w', historyLimit: 200, displayLimit: 26 },
};

const watchlist: Asset[] = [
  { symbol: 'BTC', name: 'Биткоин', price: '—', move: '—', positive: true, tone: 'orange', note: 'Ожидание рыночного потока' },
  { symbol: 'ETH', name: 'Эфириум', price: '$3,492.60', move: '+1.19%', positive: true, tone: 'violet', note: 'Отстаёт от BTC; следим за сжатием ETH/BTC' },
  { symbol: 'SOL', name: 'Солана', price: '$182.14', move: '-0.64%', positive: false, tone: 'teal', note: 'Отбой от максимума прошлого диапазона' },
  { symbol: 'DXY', name: 'Индекс доллара', price: '104.21', move: '-0.18%', positive: false, tone: 'slate', note: 'Слабость доллара поддерживает риск' },
  { symbol: 'NDX', name: 'Nasdaq 100', price: '18,442.80', move: '+0.42%', positive: true, tone: 'blue', note: 'Ширина рынка улучшается к закрытию США' },
];

const checks = [
  { id: 'structure', label: 'Структура рынка', detail: 'Повышающийся минимум сохраняется на 4H', status: 'Passed', time: '11 мин назад', score: '0.82' },
  { id: 'funding', label: 'Фандинг бессрочных контрактов', detail: 'Положительный, без перегрева', status: 'Passed', time: '18 мин назад', score: '0.68' },
  { id: 'oi', label: 'Открытый интерес', detail: 'Рост следует за спотовым спросом', status: 'Passed', time: '23 мин назад', score: '0.76' },
  { id: 'basis', label: 'Срочная структура', detail: 'Базис расширяется у сопротивления', status: 'Watch', time: '31 мин назад', score: '0.54' },
  { id: 'liquidations', label: 'Карта ликвидаций', detail: 'Кластер $18,4 млн сверху', status: 'Watch', time: '42 мин назад', score: '0.47' },
];

const formatPrice = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const formatUsd = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatCompactUsd = (value: number) => value >= 1_000_000_000
  ? `$${(value / 1_000_000_000).toFixed(2)} млрд`
  : `$${(value / 1_000_000).toFixed(0)} млн`;
const formatChartLabel = (timestamp: number, timeframe: Timeframe) => new Intl.DateTimeFormat(
  'ru-RU',
  timeframe === '1D' || timeframe === '1W'
    ? { day: '2-digit', month: 'short' }
    : { hour: '2-digit', minute: '2-digit', hour12: false },
).format(new Date(timestamp));
const formatCompactBtc = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} BTC`;
const formatRelativeTime = (value: string) => {
  const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (ageMinutes < 60) return `${ageMinutes} мин назад`;
  if (ageMinutes < 1_440) return `${Math.round(ageMinutes / 60)} ч назад`;
  return `${Math.round(ageMinutes / 1_440)} дн назад`;
};
const sentimentLabel: Record<MarketSentiment['label'], string> = {
  positive: 'Позитивное',
  neutral: 'Нейтральное',
  negative: 'Негативное',
};
const categoryLabels: Record<string, string> = {
  general: 'Общее',
  technical: 'Техника',
  news: 'Новости',
  risk: 'Риски',
  paper: 'Paper trading',
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
  result[period] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  for (let index = period + 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return result;
};

const calculateTechnicalPoints = (candles: BinanceKline[], timeframe: Timeframe): TechnicalPoint[] => {
  const closes = candles.map((candle) => Number(candle[4]));
  const ema21 = calculateEma(closes, 21);
  const ema50 = calculateEma(closes, 50);
  const rsi = calculateRsi(closes);
  const fastEma = calculateEma(closes, 12);
  const slowEma = calculateEma(closes, 26);
  const macd = closes.map((_, index) => (
    fastEma[index] !== null && slowEma[index] !== null ? fastEma[index] - slowEma[index] : null
  ));
  const signal = calculateEma(macd.filter((value): value is number => value !== null), 9);
  const macdOffset = macd.findIndex((value) => value !== null);

  return candles.map((candle, index) => {
    const macdValue = macd[index];
    const signalValue = index >= macdOffset ? signal[index - macdOffset] : null;
    return {
      label: formatChartLabel(candle[0], timeframe),
      value: closes[index],
      high: Number(candle[2]),
      low: Number(candle[3]),
      volume: Number(candle[5]),
      ema21: ema21[index],
      ema50: ema50[index],
      rsi: rsi[index],
      macd: macdValue,
      signal: signalValue,
      histogram: macdValue !== null && signalValue !== null ? macdValue - signalValue : null,
    };
  });
};

const createTechnicalAnalysis = (points: TechnicalPoint[], price: number): TechnicalAnalysis | null => {
  const latest = points.at(-1);
  if (!latest || latest.ema21 === null || latest.ema50 === null || latest.rsi === null || latest.macd === null || latest.signal === null || latest.histogram === null) {
    return null;
  }
  const recent = points.slice(-50);
  const support = Math.min(...recent.map((point) => point.low));
  const resistance = Math.max(...recent.map((point) => point.high));
  const trend = price > latest.ema21 && latest.ema21 > latest.ema50
    ? 'Восходящий'
    : price < latest.ema21 && latest.ema21 < latest.ema50
      ? 'Нисходящий'
      : 'Боковой';
  const averageVolume = recent.slice(-20).reduce((sum, point) => sum + point.volume, 0) / Math.min(20, recent.length);
  const volumeRatio = averageVolume > 0 ? latest.volume / averageVolume : 1;
  const priceVsEma21 = price >= latest.ema21 ? 'выше' : 'ниже';
  const emaAlignment = latest.ema21 >= latest.ema50 ? 'выше' : 'ниже';
  const trendSection: AnalysisSection = {
    title: 'Тренд',
    value: trend,
    tone: trend === 'Восходящий' ? 'good' : trend === 'Нисходящий' ? 'warn' : 'neutral',
    reason: `Цена ${formatPrice(price)} ${priceVsEma21} EMA 21 (${formatPrice(latest.ema21)}), а EMA 21 ${emaAlignment} EMA 50 (${formatPrice(latest.ema50)}).`,
  };
  const rsiState = latest.rsi >= 70
    ? 'RSI показывает перегретость'
    : latest.rsi <= 30
      ? 'RSI указывает на перепроданность'
      : latest.rsi >= 50
        ? 'RSI выше нейтральной середины'
        : 'RSI ниже нейтральной середины';
  const macdState = latest.macd >= latest.signal
    ? 'MACD выше сигнальной линии'
    : 'MACD ниже сигнальной линии';
  const impulseValue = latest.macd >= latest.signal && latest.rsi >= 50
    ? 'Положительный'
    : latest.macd < latest.signal && latest.rsi < 50
      ? 'Отрицательный'
      : 'Смешанный';
  const impulseSection: AnalysisSection = {
    title: 'Импульс',
    value: impulseValue,
    tone: impulseValue === 'Положительный' ? 'good' : impulseValue === 'Отрицательный' ? 'warn' : 'neutral',
    reason: `RSI 14: ${latest.rsi.toFixed(1)} (${rsiState}); MACD ${latest.macd.toFixed(2)} против сигнала ${latest.signal.toFixed(2)}, гистограмма ${latest.histogram >= 0 ? 'положительная' : 'отрицательная'} (${latest.histogram.toFixed(2)}).`,
  };
  const volumeValue = volumeRatio >= 1.2 ? 'Выше среднего' : volumeRatio <= 0.8 ? 'Ниже среднего' : 'Около среднего';
  const volumeSection: AnalysisSection = {
    title: 'Объём',
    value: volumeValue,
    tone: volumeRatio >= 1.2 ? 'good' : volumeRatio <= 0.8 ? 'warn' : 'neutral',
    reason: `Последняя свеча: ${formatCompactBtc(latest.volume)}; средний объём 20 свечей: ${formatCompactBtc(averageVolume)} (${(volumeRatio * 100).toFixed(0)}% от среднего).`,
  };
  const supportDistance = ((price - support) / price) * 100;
  const resistanceDistance = ((resistance - price) / price) * 100;
  const levelsSection: AnalysisSection = {
    title: 'Ключевые уровни',
    value: `${formatPrice(support)} — ${formatPrice(resistance)}`,
    tone: resistanceDistance <= 2 ? 'warn' : supportDistance <= 2 ? 'good' : 'neutral',
    reason: `Поддержка ${formatPrice(support)} находится на ${supportDistance.toFixed(1)}% ниже цены, сопротивление ${formatPrice(resistance)} — на ${resistanceDistance.toFixed(1)}% выше.`,
  };
  const trendScore = trend === 'Восходящий' ? 2 : trend === 'Нисходящий' ? -2 : 0;
  const impulseScore = impulseValue === 'Положительный' ? 1 : impulseValue === 'Отрицательный' ? -1 : 0;
  const volumeScore = volumeRatio >= 1.2 ? (trendScore > 0 ? 1 : trendScore < 0 ? -1 : 0) : 0;
  const levelScore = resistanceDistance <= 2 ? -1 : supportDistance <= 2 ? 1 : 0;
  const scenarioScore = trendScore + impulseScore + volumeScore + levelScore;
  const scenarioValue = scenarioScore >= 2 ? 'Бычий сценарий' : scenarioScore <= -2 ? 'Медвежий сценарий' : 'Нейтральный сценарий';
  const scenarioSection: AnalysisSection = {
    title: 'Сценарий',
    value: scenarioValue,
    tone: scenarioValue === 'Бычий сценарий' ? 'good' : scenarioValue === 'Медвежий сценарий' ? 'warn' : 'neutral',
    reason: `Вывод основан на связке «${trendSection.value} тренд», «${impulseSection.value} импульс», «${volumeSection.value.toLowerCase()}» и положении цены внутри рассчитанной зоны уровней.`,
  };
  return {
    ema21: latest.ema21,
    ema50: latest.ema50,
    rsi: latest.rsi,
    macd: latest.macd,
    signal: latest.signal,
    histogram: latest.histogram,
    volume: latest.volume,
    support,
    resistance,
    trend,
    trendSection,
    impulseSection,
    volumeSection,
    levelsSection,
    scenarioSection,
  };
};
const filterLabels: Record<ValidationFilter, string> = {
  'All checks': 'Все проверки',
  Passed: 'Пройдены',
  Watch: 'Наблюдение',
};

function Home() {
  const [timeframe, setTimeframe] = useState<Timeframe>('4H');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('только что');
  const [liveMarket, setLiveMarket] = useState<LiveMarket | null>(null);
  const [technicalData, setTechnicalData] = useState<TechnicalPoint[]>([]);
  const [analysis, setAnalysis] = useState<TechnicalAnalysis | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [briefPinned, setBriefPinned] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('All checks');
  const [search, setSearch] = useState('');
  const [isDark, setIsDark] = useState(false);
  const [marketContext, setMarketContext] = useState<MarketContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [forumThreads, setForumThreads] = useState<ForumThread[]>([]);
  const [forumCategory, setForumCategory] = useState('all');
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null);
  const [selectedThread, setSelectedThread] = useState<ForumThreadDetail | null>(null);
  const [forumLoading, setForumLoading] = useState(true);
  const [forumBusy, setForumBusy] = useState(false);
  const [forumError, setForumError] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState(() => {
    if (typeof window === 'undefined') return 'Наблюдатель';
    return window.localStorage.getItem('moses-forum-name') ?? 'Наблюдатель';
  });
  const [threadForm, setThreadForm] = useState({ title: '', body: '', category: 'general' });
  const [replyBody, setReplyBody] = useState('');

  useEffect(() => {
    document.title = 'BTC Market Console — Слой решений';
    document.documentElement.classList.toggle('dark', isDark);
    return () => document.documentElement.classList.remove('dark');
  }, [isDark]);

  const liveWatchlist = useMemo(
    () => watchlist.map((asset) => asset.symbol === 'BTC' && liveMarket
      ? {
          ...asset,
          price: formatUsd(liveMarket.price),
          move: `${liveMarket.move >= 0 ? '+' : ''}${liveMarket.move.toFixed(2)}%`,
          positive: liveMarket.move >= 0,
          note: 'Данные Binance · обновляется по запросу',
        }
      : asset),
    [liveMarket],
  );
  const selectedAsset = liveWatchlist.find((asset) => asset.symbol === selectedSymbol) ?? liveWatchlist[0];
  const filteredWatchlist = useMemo(
    () => liveWatchlist.filter((asset) => `${asset.symbol} ${asset.name}`.toLowerCase().includes(search.toLowerCase())),
    [liveWatchlist, search],
  );
  const filteredChecks = useMemo(
    () => checks.filter((check) => validationFilter === 'All checks' || check.status === validationFilter),
    [validationFilter],
  );
  const chartData = useMemo(
    () => technicalData.slice(-timeframeRequests[timeframe].displayLimit),
    [technicalData, timeframe],
  );
  const requestSequence = useRef(0);

  const loadMarket = useCallback(async (period: Timeframe) => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    setRefreshing(true);
    setMarketError(null);
    const request = timeframeRequests[period];
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    try {
      const [tickerResponse, candlesResponse] = await Promise.all([
        fetch(`${BINANCE_API}/ticker/24hr?symbol=BTCUSDT`, { signal: controller.signal }),
        fetch(`${BINANCE_API}/klines?symbol=BTCUSDT&interval=${request.interval}&limit=${request.historyLimit}`, { signal: controller.signal }),
      ]);
      if (!tickerResponse.ok || !candlesResponse.ok) {
        throw new Error('Binance не вернул рыночные данные');
      }
      const ticker = await tickerResponse.json() as BinanceTicker;
      const candles = await candlesResponse.json() as BinanceKline[];
      if (!Array.isArray(candles) || candles.length === 0) {
        throw new Error('Поток свечей BTC пуст');
      }
      if (sequence !== requestSequence.current) return;
      const price = Number(ticker.lastPrice);
      const points = calculateTechnicalPoints(candles, period);
      setLiveMarket({
        price,
        move: Number(ticker.priceChangePercent),
        high: Number(ticker.highPrice),
        low: Number(ticker.lowPrice),
        quoteVolume: Number(ticker.quoteVolume),
      });
      setTechnicalData(points);
      setAnalysis(createTechnicalAnalysis(points, price));
      setLastRefresh(new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()));
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      setMarketError(error instanceof Error ? error.message : 'Не удалось получить рыночные данные BTC');
    } finally {
      window.clearTimeout(timeout);
      if (sequence === requestSequence.current) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadMarket(timeframe);
  }, [loadMarket, timeframe]);

  const loadMarketContext = useCallback(async (period: Timeframe) => {
    setContextLoading(true);
    setContextError(null);
    try {
      const response = await fetch(`${API_BASE}/moses/market-context?timeframe=${period}`);
      const payload = await response.json() as MarketContext & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось загрузить рыночный фон');
      setMarketContext(payload);
    } catch (error) {
      setContextError(error instanceof Error ? error.message : 'Рыночный фон недоступен');
    } finally {
      setContextLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketContext(timeframe);
  }, [loadMarketContext, timeframe]);

  const loadForumThreads = useCallback(async (category: string) => {
    setForumLoading(true);
    setForumError(null);
    try {
      const query = category === 'all' ? '' : `?category=${category}`;
      const response = await fetch(`${API_BASE}/forum/threads${query}`);
      const payload = await response.json() as ForumThread[] & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось загрузить форум');
      setForumThreads(payload);
      if (selectedThreadId && !payload.some((thread) => thread.id === selectedThreadId)) {
        setSelectedThreadId(null);
        setSelectedThread(null);
      }
    } catch (error) {
      setForumError(error instanceof Error ? error.message : 'Форум недоступен');
    } finally {
      setForumLoading(false);
    }
  }, [selectedThreadId]);

  useEffect(() => {
    void loadForumThreads(forumCategory);
  }, [forumCategory, loadForumThreads]);

  const openThread = async (threadId: number) => {
    setSelectedThreadId(threadId);
    setForumError(null);
    try {
      const response = await fetch(`${API_BASE}/forum/threads/${threadId}`);
      const payload = await response.json() as ForumThreadDetail & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось открыть тему');
      setSelectedThread(payload);
    } catch (error) {
      setForumError(error instanceof Error ? error.message : 'Не удалось открыть тему');
    }
  };

  const rememberAuthor = () => {
    const name = authorName.trim() || 'Наблюдатель';
    setAuthorName(name);
    window.localStorage.setItem('moses-forum-name', name);
    return name;
  };

  const createThread = async () => {
    const name = rememberAuthor();
    if (threadForm.title.trim().length < 3 || !threadForm.body.trim()) {
      setForumError('Добавьте заголовок и текст темы.');
      return;
    }
    setForumBusy(true);
    setForumError(null);
    try {
      const response = await fetch(`${API_BASE}/forum/threads`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...threadForm, authorName: name }),
      });
      const payload = await response.json() as ForumThread & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось создать тему');
      setThreadForm({ title: '', body: '', category: 'general' });
      await loadForumThreads(forumCategory);
      await openThread(payload.id);
    } catch (error) {
      setForumError(error instanceof Error ? error.message : 'Не удалось создать тему');
    } finally {
      setForumBusy(false);
    }
  };

  const createReply = async () => {
    if (!selectedThreadId || !replyBody.trim()) return;
    const name = rememberAuthor();
    setForumBusy(true);
    setForumError(null);
    try {
      const response = await fetch(`${API_BASE}/forum/threads/${selectedThreadId}/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: replyBody, authorName: name }),
      });
      const payload = await response.json() as ForumPost & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Не удалось отправить ответ');
      setReplyBody('');
      await openThread(selectedThreadId);
      await loadForumThreads(forumCategory);
    } catch (error) {
      setForumError(error instanceof Error ? error.message : 'Не удалось отправить ответ');
    } finally {
      setForumBusy(false);
    }
  };

  const refreshMarket = () => {
    if (refreshing) return;
    void loadMarket(timeframe);
  };

  const copyBrief = async () => {
    const brief = analysis
      ? `BTCUSDT: ${analysis.trend} тренд, RSI 14 ${analysis.rsi.toFixed(1)}, MACD ${analysis.histogram >= 0 ? 'положительный' : 'отрицательный'}. Поддержка ${formatPrice(analysis.support)}, сопротивление ${formatPrice(analysis.resistance)}.`
      : 'Анализ BTCUSDT пока загружается из Binance.';
    await navigator.clipboard?.writeText(brief);
    setBriefPinned(true);
  };

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <div className="flex min-h-[100dvh]">
        <aside className={`${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-40 w-[264px] shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-300 md:static md:translate-x-0`}>
          <div className="flex h-full flex-col">
            <div className="flex h-[82px] items-center border-b border-sidebar-border px-6">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[0_0_0_5px_hsl(31_100%_50%_/_0.12)]">
                  <Bitcoin size={20} strokeWidth={2.5} />
                </div>
                <div>
                  <div className="font-semibold tracking-[-0.03em]">Рыночная консоль</div>
                  <div className="data-mono mt-0.5 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">BTC / слой решений</div>
                </div>
              </div>
              <button data-testid="button-close-mobile-nav" aria-label="Закрыть навигацию" onClick={() => setMobileNavOpen(false)} className="ml-auto rounded-md p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden">
                <X size={18} />
              </button>
            </div>

            <div className="px-4 pt-7">
              <div className="data-mono px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/40">Рабочая область</div>
              <nav className="mt-3 space-y-1">
                <button data-testid="button-nav-overview" className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5 text-left text-sm font-medium text-sidebar-accent-foreground shadow-[inset_3px_0_0_hsl(31_100%_55%)]">
                  <LayoutDashboard size={17} className="text-primary" /> Обзор
                </button>
                <button data-testid="button-nav-watchlist" onClick={() => document.getElementById('watchlist')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <Eye size={17} /> Наблюдение <span className="data-mono ml-auto text-[10px] text-sidebar-foreground/35">05</span>
                </button>
                <button data-testid="button-nav-validation" onClick={() => document.getElementById('validation')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <ShieldCheck size={17} /> Проверки <span className="data-mono ml-auto text-[10px] text-sidebar-foreground/35">05</span>
                </button>
                <button data-testid="button-nav-context" onClick={() => document.getElementById('market-background')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <Newspaper size={17} /> Рыночный фон
                </button>
                <button data-testid="button-nav-forum" onClick={() => document.getElementById('forum')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <MessageCircle size={17} /> Форум <span className="data-mono ml-auto text-[10px] text-sidebar-foreground/35">{forumThreads.length.toString().padStart(2, '0')}</span>
                </button>
              </nav>
            </div>

            <div className="mt-8 px-4">
              <div className="data-mono px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/40">Группы сигналов</div>
              <div className="mt-3 space-y-1">
                {[
                  ['Импульс', 'BTC · 4H', TrendingUp, 'text-primary'],
                  ['Режим риска', 'Сбалансирован', Gauge, 'text-emerald-400'],
                  ['Макроконтекст', 'Аппетит к риску', Activity, 'text-sky-300'],
                ].map(([label, sublabel, Icon, tone]) => (
                  <button key={String(label)} data-testid={`button-signal-${String(label).toLowerCase().replace(' ', '-')}`} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent">
                    <Icon size={16} className={String(tone)} />
                    <span className="min-w-0">
                      <span className="block text-sm text-sidebar-foreground/80">{String(label)}</span>
                      <span className="data-mono block truncate text-[10px] text-sidebar-foreground/35">{String(sublabel)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-auto border-t border-sidebar-border p-4">
              <div className="rounded-xl bg-sidebar-accent/70 p-3.5">
                <div className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground/80"><Zap size={14} className="text-primary" /> Состояние консоли</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="data-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/40">Локальный поток</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> Синхронизирован</span>
                </div>
              </div>
              <button data-testid="button-settings" className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"><Settings2 size={16} /> Настройки области</button>
            </div>
          </div>
        </aside>

        {mobileNavOpen && <button data-testid="button-mobile-backdrop" aria-label="Закрыть меню" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-30 bg-sidebar/50 md:hidden" />}

        <main className="terminal-grid min-w-0 flex-1 overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
            <div className="flex h-[82px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-9">
              <div className="flex items-center gap-3">
                <button data-testid="button-open-mobile-nav" aria-label="Открыть навигацию" onClick={() => setMobileNavOpen(true)} className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground md:hidden"><Menu size={19} /></button>
                <div>
                   <div className="data-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())} <span className="mx-1 text-primary">/</span> Сессия Нью-Йорка</div>
                  <h1 className="mt-1 text-xl font-semibold tracking-[-0.04em] sm:text-[22px]">Обзор рынка</h1>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                 <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground lg:flex"><Clock3 size={14} /><span className="data-mono">{lastRefresh}</span><span className="text-muted-foreground/60">локальное время</span></div>
                <button data-testid="button-refresh-market" aria-label="Обновить данные рынка" onClick={refreshMarket} className={`group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition-all hover:border-primary/50 hover:text-primary ${refreshing ? 'text-primary' : ''}`}><RefreshCw size={15} className={refreshing ? 'animate-spin' : 'transition-transform group-hover:rotate-45'} /> <span className="hidden sm:block">{refreshing ? 'Синхронизация' : 'Обновить'}</span></button>
                <button data-testid="button-toggle-notifications" aria-label="Открыть уведомления" onClick={() => setShowNotifications((value) => !value)} className={`relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground ${showNotifications ? 'text-primary' : ''}`}><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /></button>
                <button data-testid="button-toggle-theme" aria-label="Переключить тему" onClick={() => setIsDark((value) => !value)} className="hidden rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground sm:block">{isDark ? <Sparkles size={17} /> : <Moon size={17} />}</button>
                <div className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">AK</div>
              </div>
              {showNotifications && (
                <div className="absolute right-4 top-[72px] w-[280px] rounded-xl border border-border bg-card p-4 shadow-2xl sm:right-9">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Уведомления консоли</span>
                    <span className="data-mono text-[10px] text-muted-foreground">01 новое</span>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/70 p-3">
                    <div className="flex gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      <div>
                        <div className="text-xs font-medium">Обновлён кластер сопротивления</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                           {analysis ? `Сопротивление ${formatPrice(analysis.resistance)} рассчитано по максимумам последних 50 свечей.` : 'Ждём подтверждения уровней по свечам Binance.'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </header>

          <div className="mx-auto max-w-[1600px] px-4 pb-12 pt-6 sm:px-6 lg:px-9 lg:pt-8">
            <section className="rise-in grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
              <div className="min-w-0">
                <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Bitcoin size={18} strokeWidth={2.5} /></span>
                      <span className="data-mono text-xs font-semibold tracking-[0.08em]">BTC / USD</span>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${marketError ? 'bg-red-500/10 text-red-700 dark:text-red-300' : liveMarket ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-primary/10 text-primary'}`}>{marketError ? 'Поток недоступен' : liveMarket ? 'Binance онлайн' : 'Подключение'}</span>
                    </div>
                    <div className="mt-4 flex items-baseline gap-3">
                       <span data-testid="text-btc-price" className="data-mono text-[32px] font-semibold tracking-[-0.07em] sm:text-[42px]">{selectedSymbol === 'BTC' ? liveMarket ? formatUsd(liveMarket.price) : '—' : selectedAsset.price}</span>
                      <span data-testid="text-btc-move" className={`flex items-center gap-1 text-sm font-semibold ${selectedAsset.positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{selectedAsset.positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{selectedAsset.move}</span>
                    </div>
                      <p className="mt-1 text-xs text-muted-foreground">Спотовый индекс Binance <span className="mx-1 text-border">·</span> Диапазон за 24 ч <span className="data-mono font-medium text-foreground">{liveMarket ? `${formatPrice(liveMarket.low)} — ${formatPrice(liveMarket.high)}` : '—'}</span></p>
                  </div>
                  <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
                    {(['1H', '4H', '1D', '1W'] as Timeframe[]).map((period) => (
                      <button key={period} data-testid={`button-timeframe-${period.toLowerCase()}`} onClick={() => setTimeframe(period)} className={`data-mono rounded-lg px-3 py-2 text-[11px] font-medium transition-all ${timeframe === period ? 'bg-secondary text-secondary-foreground shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>{period}</button>
                    ))}
                  </div>
                </div>

                <div className={`panel relative overflow-hidden rounded-2xl p-4 sm:p-5 ${refreshing ? 'opacity-75' : ''}`}>
                  <div className="mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-4 text-xs">
                       <span className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full bg-primary" />Цена</span>
                       <span className="hidden items-center gap-2 text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-600" />EMA 21</span>
                       <span className="hidden items-center gap-2 text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-sky-600" />EMA 50</span>
                       <button data-testid="button-toggle-levels" onClick={() => setShowLevels((value) => !value)} className={`hidden items-center gap-2 transition-colors sm:flex ${showLevels ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}><span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground" />Ключевые уровни</button>
                    </div>
                    <button data-testid="button-chart-options" aria-label="Chart options" onClick={() => setShowMore((value) => !value)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal size={18} /></button>
                  </div>
                  <div className="relative h-[280px] w-full sm:h-[330px]">
                      {refreshing ? <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/55 backdrop-blur-[2px]"><div className="data-mono rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground"><RefreshCw size={14} className="mr-2 inline animate-spin text-primary" />Обновляем рыночную картину</div></div> : null}
                      {!refreshing && chartData.length === 0 ? <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/70"><div className="max-w-xs text-center text-xs text-muted-foreground">{marketError ?? 'Ожидание свечей BTC'}</div></div> : null}
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                        <defs>
                          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(31 100% 50%)" stopOpacity={0.25} />
                            <stop offset="100%" stopColor="hsl(31 100% 50%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke="hsl(37 20% 84% / 0.7)" vertical={false} />
                        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'hsl(222 13% 43%)', fontSize: 10, fontFamily: 'IBM Plex Mono' }} dy={10} />
                        <YAxis domain={['dataMin - 500', 'dataMax + 500']} axisLine={false} tickLine={false} tick={{ fill: 'hsl(222 13% 43%)', fontSize: 10, fontFamily: 'IBM Plex Mono' }} tickFormatter={(value) => `${Math.round(value / 1000)}k`} orientation="right" />
                         {showLevels && analysis && <ReferenceLine y={analysis.support} stroke="hsl(162 44% 34% / 0.65)" strokeDasharray="4 4" label={{ value: `ПОДДЕРЖКА ${formatPrice(analysis.support)}`, position: 'insideTopLeft', fill: 'hsl(162 44% 34%)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />}
                         {showLevels && analysis && <ReferenceLine y={analysis.resistance} stroke="hsl(4 69% 51% / 0.65)" strokeDasharray="4 4" label={{ value: `СОПРОТИВЛЕНИЕ ${formatPrice(analysis.resistance)}`, position: 'insideTopLeft', fill: 'hsl(4 69% 51%)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />}
                        <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl"><div className="data-mono text-[10px] text-muted-foreground">{label}</div><div className="data-mono mt-1 text-sm font-semibold">{formatPrice(Number(payload[0].value))}</div></div> : null} />
                        <Area type="monotone" dataKey="value" stroke="hsl(31 100% 50%)" strokeWidth={2.5} fill="url(#priceFill)" activeDot={{ r: 4, fill: 'hsl(31 100% 50%)', stroke: 'hsl(42 40% 98%)', strokeWidth: 2 }} />
                         <Line type="monotone" dataKey="ema21" stroke="hsl(162 44% 34%)" strokeWidth={1.5} dot={false} connectNulls />
                         <Line type="monotone" dataKey="ema50" stroke="hsl(205 75% 45%)" strokeWidth={1.5} dot={false} connectNulls />
                      </AreaChart>
                    </ResponsiveContainer>
                     {showMore && <div className="absolute right-3 top-9 z-10 w-40 rounded-lg border border-border bg-card p-1.5 shadow-xl"><button data-testid="button-reset-chart" onClick={() => setShowLevels(true)} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted">Сбросить уровни</button><button data-testid="button-copy-chart" onClick={copyBrief} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted">Скопировать снимок</button></div>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
                    {[
                        ['Объём', liveMarket ? formatCompactUsd(liveMarket.quoteVolume) : '—', '24 ч · Binance', true],
                       ['Волатильность', '43.8%', 'Повышенная', false],
                       ['Фандинг', '0.008%', 'Нейтральный', true],
                       ['Доминирование', '53.7%', '+0.31%', true],
                    ].map(([label, value, change, positive]) => <div key={String(label)}><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{String(label)}</div><div className="data-mono mt-1 text-sm font-semibold">{String(value)}</div><div className={`mt-0.5 text-[10px] ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-primary'}`}>{String(change)}</div></div>)}
                  </div>
                </div>
              </div>

              <aside className="rise-in rise-in-delay-1">
                <div className="panel scanline relative overflow-hidden rounded-2xl bg-secondary p-5 text-secondary-foreground sm:p-6">
                  <div className="relative z-[1]">
                    <div className="flex items-center justify-between">
                       <div className="flex items-center gap-2 text-xs font-medium"><Sparkles size={15} className="text-primary" /> Сводка аналитика</div>
                       <button data-testid="button-pin-brief" aria-label="Закрепить сводку аналитика" onClick={() => setBriefPinned((value) => !value)} className={`rounded-md p-1.5 transition-colors ${briefPinned ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground/50 hover:bg-secondary-foreground/10 hover:text-secondary-foreground'}`}><Pin size={15} className={briefPinned ? 'fill-current' : ''} /></button>
                    </div>
                    <div className="mt-7 flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-xl border border-primary/30 bg-primary/15 text-primary"><TrendingUp size={22} /></div>
                        <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-secondary-foreground/45">Текущая позиция</div><div className="mt-1 text-xl font-semibold tracking-[-0.04em]">{analysis?.trend ?? 'Загрузка'}</div></div>
                    </div>
                      <p className="mt-6 text-[13px] leading-[1.7] text-secondary-foreground/72">{analysis ? analysis.scenarioSection.reason : 'Получаем свечи Binance для расчёта технических показателей.'}</p>
                    <div className="mt-6 space-y-3">
                      {[
                          ['Сценарий', analysis ? analysis.scenarioSection.value : 'Ожидание данных', analysis?.scenarioSection.tone ?? 'neutral'],
                          ['Импульс', analysis ? analysis.impulseSection.value : 'Ожидание данных', analysis?.impulseSection.tone ?? 'neutral'],
                          ['Уровни', analysis ? analysis.levelsSection.value : 'Расчёт уровней', analysis?.levelsSection.tone ?? 'neutral'],
                      ].map(([label, value, tone]) => <div key={String(label)} className="flex items-center justify-between border-b border-secondary-foreground/10 pb-3 text-xs last:border-0 last:pb-0"><span className="text-secondary-foreground/45">{String(label)}</span><span className={`flex items-center gap-1.5 font-medium ${tone === 'warn' ? 'text-primary' : 'text-secondary-foreground/90'}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === 'warn' ? 'bg-primary' : 'bg-emerald-400'}`} />{String(value)}</span></div>)}
                    </div>
                     <button data-testid="button-copy-brief" onClick={copyBrief} className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg border border-secondary-foreground/15 bg-secondary-foreground/5 py-2.5 text-xs font-medium transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary"><BookOpen size={14} /> {briefPinned ? 'Сводка скопирована' : 'Скопировать сводку'}</button>
                  </div>
                </div>
                <div className="panel mt-4 rounded-2xl p-5">
                   <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Gauge size={16} className="text-primary" /> Панель риска</div><span className="data-mono text-[10px] text-muted-foreground">ОНЛАЙН</span></div>
                   <div className="mt-5 flex items-center gap-4"><div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full" style={{ background: 'conic-gradient(hsl(31 100% 50%) 0 62%, hsl(39 30% 91%) 62% 100%)' }}><div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-card"><span className="data-mono text-xl font-semibold">62</span></div></div><div><div className="text-sm font-medium">Умеренный риск</div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Запас сохраняется, но потенциал снижается выше локального максимума.</p></div></div>
                    <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-lg bg-muted/70 p-2.5"><div className="text-[10px] text-muted-foreground">Ближайшая поддержка</div><div className="data-mono mt-1 text-xs font-semibold">{analysis ? formatPrice(analysis.support) : '—'}</div></div><div className="rounded-lg bg-muted/70 p-2.5"><div className="text-[10px] text-muted-foreground">Ближайшее сопротивление</div><div className="data-mono mt-1 text-xs font-semibold">{analysis ? formatPrice(analysis.resistance) : '—'}</div></div></div>
                </div>
                 <div className="panel mt-4 rounded-2xl p-5">
                   <div className="flex items-center justify-between">
                     <div className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} className="text-primary" /> Анализ Моисея</div>
                     <span className="data-mono text-[10px] text-muted-foreground">{timeframe} · Binance</span>
                   </div>
                   {analysis ? (
                     <>
                       <div className="mt-4 space-y-2">
                         {[analysis.trendSection, analysis.impulseSection, analysis.volumeSection, analysis.levelsSection, analysis.scenarioSection].map((section) => <div key={section.title} className="rounded-lg bg-muted/55 p-3">
                           <div className="flex items-start justify-between gap-3">
                             <span className="text-[11px] font-semibold">{section.title}</span>
                             <span className={`text-right text-[11px] font-semibold ${section.tone === 'good' ? 'text-emerald-700 dark:text-emerald-300' : section.tone === 'warn' ? 'text-primary' : 'text-muted-foreground'}`}>{section.value}</span>
                           </div>
                           <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">{section.reason}</p>
                         </div>)}
                       </div>
                       <div className="mt-4 grid grid-cols-2 gap-2">
                         {[
                           ['EMA 21', formatPrice(analysis.ema21)],
                           ['EMA 50', formatPrice(analysis.ema50)],
                           ['RSI 14', analysis.rsi.toFixed(1)],
                           ['Объём свечи', formatCompactBtc(analysis.volume)],
                           ['MACD', analysis.macd.toFixed(2)],
                           ['Сигнал', analysis.signal.toFixed(2)],
                         ].map(([label, value]) => <div key={label} className="rounded-lg bg-muted/70 p-2.5"><div className="text-[10px] text-muted-foreground">{label}</div><div className="data-mono mt-1 text-xs font-semibold">{value}</div></div>)}
                       </div>
                     </>
                   ) : <div className="mt-4 rounded-lg bg-muted/70 p-3 text-[11px] text-muted-foreground">{marketError ?? 'Индикаторы появятся после загрузки истории свечей.'}</div>}
                 </div>
              </aside>
            </section>

            <section id="watchlist" className="rise-in rise-in-delay-2 mt-7">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                 <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Контекст</div><h2 className="mt-1 text-lg font-semibold tracking-[-0.04em]">Список наблюдения</h2></div>
                 <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground focus-within:border-primary/60"><Search size={14} /><input data-testid="input-search-watchlist" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Фильтр активов" className="w-28 bg-transparent outline-none placeholder:text-muted-foreground/60 sm:w-36" /></label>
              </div>
               {filteredWatchlist.length === 0 ? <div className="panel rounded-xl p-8 text-center text-sm text-muted-foreground">Нет совпадений для <span className="font-medium text-foreground">“{search}”</span>.</div> : <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-1">{filteredWatchlist.map((asset) => <button key={asset.symbol} data-testid={`button-watchlist-${asset.symbol.toLowerCase()}`} onClick={() => setSelectedSymbol(asset.symbol)} className={`panel panel-hover min-w-[205px] flex-1 rounded-xl p-4 text-left ${selectedSymbol === asset.symbol ? 'border-primary/70 ring-1 ring-primary/20' : ''}`}><div className="flex items-start justify-between"><div className="flex items-center gap-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg text-[10px] font-bold ${asset.tone === 'orange' ? 'bg-primary text-primary-foreground' : asset.tone === 'violet' ? 'bg-violet-600 text-white' : asset.tone === 'teal' ? 'bg-teal-700 text-white' : asset.tone === 'blue' ? 'bg-sky-700 text-white' : 'bg-slate-500 text-white'}`}>{asset.symbol.slice(0, 1)}</span><div><div className="text-sm font-semibold">{asset.symbol}</div><div className="text-[10px] text-muted-foreground">{asset.name}</div></div></div><Star size={14} className={selectedSymbol === asset.symbol ? 'fill-primary text-primary' : 'text-muted-foreground/45'} /></div><div className="mt-4 flex items-baseline justify-between gap-2"><span className="data-mono text-sm font-semibold">{asset.price}</span><span className={`data-mono text-[10px] font-medium ${asset.positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{asset.move}</span></div><div className="mt-2 truncate text-[10px] text-muted-foreground">{asset.note}</div></button>)}</div>}
            </section>

            <section id="validation" className="rise-in rise-in-delay-3 mt-8">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                 <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Журнал подтверждений</div><h2 className="mt-1 text-lg font-semibold tracking-[-0.04em]">Последние проверки</h2></div>
                 <div className="flex items-center gap-2"><Filter size={14} className="text-muted-foreground" /> <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">{(['All checks', 'Passed', 'Watch'] as ValidationFilter[]).map((filter) => <button key={filter} data-testid={`button-validation-${filter.toLowerCase().replace(' ', '-')}`} onClick={() => setValidationFilter(filter)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors ${validationFilter === filter ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{filterLabels[filter]}</button>)}</div></div>
              </div>
              <div className="panel overflow-hidden rounded-2xl">
                 <div className="hidden grid-cols-[1.35fr_1.65fr_.65fr_1fr_.55fr] gap-4 border-b border-border bg-muted/45 px-5 py-3 text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground sm:grid"><span>Проверка</span><span>Результат</span><span>Оценка</span><span>Последний запуск</span><span>Статус</span></div>
                 {filteredChecks.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">В этом представлении нет проверок.</div> : filteredChecks.map((check) => <div key={check.id} data-testid={`row-validation-${check.id}`} className="grid gap-2 border-b border-border px-4 py-4 last:border-0 hover:bg-muted/30 sm:grid-cols-[1.35fr_1.65fr_.65fr_1fr_.55fr] sm:items-center sm:gap-4 sm:px-5"><div className="flex items-center gap-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg ${check.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-primary/12 text-primary'}`}>{check.status === 'Passed' ? <Check size={14} /> : <SlidersHorizontal size={14} />}</span><span className="text-xs font-semibold">{check.label}</span></div><div className="pl-9 text-[11px] text-muted-foreground sm:pl-0">{check.detail}</div><div className="data-mono pl-9 text-[11px] font-medium sm:pl-0">{check.score}</div><div className="data-mono pl-9 text-[10px] text-muted-foreground sm:pl-0">{check.time}</div><div className="pl-9 sm:pl-0"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${check.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-primary/12 text-primary'}`}><span className={`h-1.5 w-1.5 rounded-full ${check.status === 'Passed' ? 'bg-emerald-600' : 'bg-primary'}`} />{check.status === 'Passed' ? 'Пройдена' : 'Наблюдение'}</span></div></div>)}
                  <div className="flex items-center justify-between border-t border-border bg-muted/25 px-5 py-3"><span className="data-mono text-[10px] text-muted-foreground">{marketError ? 'Поток Binance недоступен · проверьте соединение' : 'BTC · Binance · обновление вручную'}</span><button data-testid="button-run-validation" onClick={refreshMarket} className="flex items-center gap-1.5 text-[10px] font-medium text-primary hover:underline"><RefreshCw size={12} /> Запустить снова</button></div>
              </div>
            </section>

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[10px] text-muted-foreground">
              <span className="data-mono uppercase tracking-[0.14em]">Слой решений / v0.8.4</span>
              <span className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${marketError ? 'bg-red-600' : liveMarket ? 'bg-emerald-600' : 'bg-primary'}`} /> {marketError ? 'Поток BTC требует внимания' : liveMarket ? 'Рынок BTC синхронизирован' : 'Подключение к Binance'} <span className="mx-1 text-border">·</span> Binance</span>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;