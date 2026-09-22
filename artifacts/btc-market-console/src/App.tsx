import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
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
  MoreHorizontal,
  Moon,
  Pin,
  RefreshCw,
  Search,
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

const watchlist: Asset[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: '$67,842.18', move: '+2.84%', positive: true, tone: 'orange', note: 'Holding above the weekly value area' },
  { symbol: 'ETH', name: 'Ethereum', price: '$3,492.60', move: '+1.19%', positive: true, tone: 'violet', note: 'Lagging beta; watch ETH/BTC compression' },
  { symbol: 'SOL', name: 'Solana', price: '$182.14', move: '-0.64%', positive: false, tone: 'teal', note: 'Rejected at prior range high' },
  { symbol: 'DXY', name: 'Dollar index', price: '104.21', move: '-0.18%', positive: false, tone: 'slate', note: 'Softness is a modest tailwind for risk' },
  { symbol: 'NDX', name: 'Nasdaq 100', price: '18,442.80', move: '+0.42%', positive: true, tone: 'blue', note: 'Breadth improving into US close' },
];

const chartSets: Record<Timeframe, { label: string; value: number }[]> = {
  '1H': [
    { label: '09:00', value: 67240 }, { label: '09:10', value: 67310 }, { label: '09:20', value: 67285 },
    { label: '09:30', value: 67490 }, { label: '09:40', value: 67425 }, { label: '09:50', value: 67580 },
    { label: '10:00', value: 67620 }, { label: '10:10', value: 67540 }, { label: '10:20', value: 67720 },
    { label: '10:30', value: 67842 },
  ],
  '4H': [
    { label: '08:00', value: 65890 }, { label: '10:00', value: 66280 }, { label: '12:00', value: 66040 },
    { label: '14:00', value: 66690 }, { label: '16:00', value: 66410 }, { label: '18:00', value: 67180 },
    { label: '20:00', value: 66970 }, { label: '22:00', value: 67540 }, { label: '00:00', value: 67210 },
    { label: '02:00', value: 67842 },
  ],
  '1D': [
    { label: '17 May', value: 64280 }, { label: '18 May', value: 65140 }, { label: '19 May', value: 64830 },
    { label: '20 May', value: 66020 }, { label: '21 May', value: 65640 }, { label: '22 May', value: 66980 },
    { label: '23 May', value: 66410 }, { label: '24 May', value: 67580 }, { label: '25 May', value: 67120 },
    { label: '26 May', value: 67842 },
  ],
  '1W': [
    { label: 'Mar 18', value: 58420 }, { label: 'Mar 25', value: 61480 }, { label: 'Apr 01', value: 59840 },
    { label: 'Apr 08', value: 67280 }, { label: 'Apr 15', value: 64390 }, { label: 'Apr 22', value: 65810 },
    { label: 'Apr 29', value: 62940 }, { label: 'May 06', value: 68420 }, { label: 'May 13', value: 66110 },
    { label: 'May 20', value: 67842 },
  ],
};

const checks = [
  { id: 'structure', label: 'Market structure', detail: 'Higher low intact on 4H', status: 'Passed', time: '11 min ago', score: '0.82' },
  { id: 'funding', label: 'Perpetual funding', detail: 'Positive, not crowded', status: 'Passed', time: '18 min ago', score: '0.68' },
  { id: 'oi', label: 'Open interest', detail: 'Expansion follows spot bid', status: 'Passed', time: '23 min ago', score: '0.76' },
  { id: 'basis', label: 'Term structure', detail: 'Basis widening into resistance', status: 'Watch', time: '31 min ago', score: '0.54' },
  { id: 'liquidations', label: 'Liquidation map', detail: '$18.4m overhead cluster', status: 'Watch', time: '42 min ago', score: '0.47' },
];

const formatPrice = (value: number) => `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function Home() {
  const [timeframe, setTimeframe] = useState<Timeframe>('4H');
  const [selectedSymbol, setSelectedSymbol] = useState('BTC');
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState('just now');
  const [briefPinned, setBriefPinned] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [showLevels, setShowLevels] = useState(true);
  const [validationFilter, setValidationFilter] = useState<ValidationFilter>('All checks');
  const [search, setSearch] = useState('');
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    document.title = 'BTC Market Console — Decision surface';
    document.documentElement.classList.toggle('dark', isDark);
    return () => document.documentElement.classList.remove('dark');
  }, [isDark]);

  const selectedAsset = watchlist.find((asset) => asset.symbol === selectedSymbol) ?? watchlist[0];
  const chartData = chartSets[timeframe];
  const filteredWatchlist = useMemo(
    () => watchlist.filter((asset) => `${asset.symbol} ${asset.name}`.toLowerCase().includes(search.toLowerCase())),
    [search],
  );
  const filteredChecks = useMemo(
    () => checks.filter((check) => validationFilter === 'All checks' || check.status === validationFilter),
    [validationFilter],
  );

  const refreshMarket = () => {
    if (refreshing) return;
    setRefreshing(true);
    window.setTimeout(() => {
      setRefreshing(false);
      setLastRefresh('just now');
    }, 900);
  };

  const copyBrief = async () => {
    await navigator.clipboard?.writeText('BTC remains constructive above 66.9k. Momentum is improving, but leverage is building into 68.8k resistance.');
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
                  <div className="font-semibold tracking-[-0.03em]">Market Console</div>
                  <div className="data-mono mt-0.5 text-[10px] uppercase tracking-[0.16em] text-sidebar-foreground/50">BTC / decision layer</div>
                </div>
              </div>
              <button data-testid="button-close-mobile-nav" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} className="ml-auto rounded-md p-1 text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground md:hidden">
                <X size={18} />
              </button>
            </div>

            <div className="px-4 pt-7">
              <div className="data-mono px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/40">Workspace</div>
              <nav className="mt-3 space-y-1">
                <button data-testid="button-nav-overview" className="flex w-full items-center gap-3 rounded-lg bg-sidebar-accent px-3 py-2.5 text-left text-sm font-medium text-sidebar-accent-foreground shadow-[inset_3px_0_0_hsl(31_100%_55%)]">
                  <LayoutDashboard size={17} className="text-primary" /> Overview
                </button>
                <button data-testid="button-nav-watchlist" onClick={() => document.getElementById('watchlist')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <Eye size={17} /> Watchlist <span className="data-mono ml-auto text-[10px] text-sidebar-foreground/35">05</span>
                </button>
                <button data-testid="button-nav-validation" onClick={() => document.getElementById('validation')?.scrollIntoView({ behavior: 'smooth' })} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-sidebar-foreground/65 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground">
                  <ShieldCheck size={17} /> Validation <span className="data-mono ml-auto text-[10px] text-sidebar-foreground/35">05</span>
                </button>
              </nav>
            </div>

            <div className="mt-8 px-4">
              <div className="data-mono px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-sidebar-foreground/40">Signal groups</div>
              <div className="mt-3 space-y-1">
                {[
                  ['Momentum', 'BTC · 4H', TrendingUp, 'text-primary'],
                  ['Risk regime', 'Balanced', Gauge, 'text-emerald-400'],
                  ['Macro context', 'Risk-on', Activity, 'text-sky-300'],
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
                <div className="flex items-center gap-2 text-xs font-medium text-sidebar-foreground/80"><Zap size={14} className="text-primary" /> Desk status</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="data-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/40">Local feed</span>
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-300"><span className="pulse-dot h-1.5 w-1.5 rounded-full bg-emerald-400" /> Synchronized</span>
                </div>
              </div>
              <button data-testid="button-settings" className="mt-3 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground"><Settings2 size={16} /> Workspace settings</button>
            </div>
          </div>
        </aside>

        {mobileNavOpen && <button data-testid="button-mobile-backdrop" aria-label="Close menu" onClick={() => setMobileNavOpen(false)} className="fixed inset-0 z-30 bg-sidebar/50 md:hidden" />}

        <main className="terminal-grid min-w-0 flex-1 overflow-hidden">
          <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur-md">
            <div className="flex h-[82px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-9">
              <div className="flex items-center gap-3">
                <button data-testid="button-open-mobile-nav" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)} className="rounded-lg border border-border bg-card p-2 text-muted-foreground hover:text-foreground md:hidden"><Menu size={19} /></button>
                <div>
                  <div className="data-mono text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Tuesday, May 28, 2024 <span className="mx-1 text-primary">/</span> New York session</div>
                  <h1 className="mt-1 text-xl font-semibold tracking-[-0.04em] sm:text-[22px]">Market overview</h1>
                </div>
              </div>
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground lg:flex"><Clock3 size={14} /><span className="data-mono">{lastRefresh === 'just now' ? '10:42:18' : lastRefresh}</span><span className="text-muted-foreground/60">UTC</span></div>
                <button data-testid="button-refresh-market" aria-label="Refresh market data" onClick={refreshMarket} className={`group flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium transition-all hover:border-primary/50 hover:text-primary ${refreshing ? 'text-primary' : ''}`}><RefreshCw size={15} className={refreshing ? 'animate-spin' : 'transition-transform group-hover:rotate-45'} /> <span className="hidden sm:block">{refreshing ? 'Syncing' : 'Refresh'}</span></button>
                <button data-testid="button-toggle-notifications" aria-label="Toggle notifications" onClick={() => setShowNotifications((value) => !value)} className={`relative rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground ${showNotifications ? 'text-primary' : ''}`}><Bell size={17} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary" /></button>
                <button data-testid="button-toggle-theme" aria-label="Toggle theme" onClick={() => setIsDark((value) => !value)} className="hidden rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:text-foreground sm:block">{isDark ? <Sparkles size={17} /> : <Moon size={17} />}</button>
                <div className="ml-1 grid h-8 w-8 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">AK</div>
              </div>
              {showNotifications && (
                <div className="absolute right-4 top-[72px] w-[280px] rounded-xl border border-border bg-card p-4 shadow-2xl sm:right-9">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Desk alerts</span>
                    <span className="data-mono text-[10px] text-muted-foreground">01 new</span>
                  </div>
                  <div className="mt-3 rounded-lg bg-muted/70 p-3">
                    <div className="flex gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full bg-primary" />
                      <div>
                        <div className="text-xs font-medium">Resistance cluster updated</div>
                        <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          68.8k now carries $18.4m in overhead liquidity.
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
                      <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Live market</span>
                    </div>
                    <div className="mt-4 flex items-baseline gap-3">
                      <span data-testid="text-btc-price" className="data-mono text-[32px] font-semibold tracking-[-0.07em] sm:text-[42px]">{selectedSymbol === 'BTC' ? '$67,842.18' : selectedAsset.price}</span>
                      <span data-testid="text-btc-move" className={`flex items-center gap-1 text-sm font-semibold ${selectedAsset.positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{selectedAsset.positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}{selectedAsset.move}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">Spot composite <span className="mx-1 text-border">·</span> 24h range <span className="data-mono font-medium text-foreground">$65,940 — $68,210</span></p>
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
                      <span className="flex items-center gap-2 font-medium"><span className="h-2 w-2 rounded-full bg-primary" />Price</span>
                      <span className="hidden items-center gap-2 text-muted-foreground sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-600" />EMA 21</span>
                      <button data-testid="button-toggle-levels" onClick={() => setShowLevels((value) => !value)} className={`hidden items-center gap-2 transition-colors sm:flex ${showLevels ? 'text-muted-foreground' : 'text-muted-foreground/40'}`}><span className="h-2 w-2 rounded-full border border-dashed border-muted-foreground" />Key levels</button>
                    </div>
                    <button data-testid="button-chart-options" aria-label="Chart options" onClick={() => setShowMore((value) => !value)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal size={18} /></button>
                  </div>
                  <div className="relative h-[280px] w-full sm:h-[330px]">
                    {refreshing ? <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-card/55 backdrop-blur-[2px]"><div className="data-mono rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground"><RefreshCw size={14} className="mr-2 inline animate-spin text-primary" />Rebuilding market surface</div></div> : null}
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
                        {showLevels && <ReferenceLine y={66900} stroke="hsl(162 44% 34% / 0.65)" strokeDasharray="4 4" label={{ value: 'VALUE LOW 66.9k', position: 'insideTopLeft', fill: 'hsl(162 44% 34%)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />}
                        {showLevels && <ReferenceLine y={68800} stroke="hsl(4 69% 51% / 0.65)" strokeDasharray="4 4" label={{ value: 'RESISTANCE 68.8k', position: 'insideTopLeft', fill: 'hsl(4 69% 51%)', fontSize: 9, fontFamily: 'IBM Plex Mono' }} />}
                        <Tooltip content={({ active, payload, label }) => active && payload?.length ? <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-xl"><div className="data-mono text-[10px] text-muted-foreground">{label}</div><div className="data-mono mt-1 text-sm font-semibold">{formatPrice(Number(payload[0].value))}</div></div> : null} />
                        <Area type="monotone" dataKey="value" stroke="hsl(31 100% 50%)" strokeWidth={2.5} fill="url(#priceFill)" activeDot={{ r: 4, fill: 'hsl(31 100% 50%)', stroke: 'hsl(42 40% 98%)', strokeWidth: 2 }} />
                      </AreaChart>
                    </ResponsiveContainer>
                    {showMore && <div className="absolute right-3 top-9 z-10 w-40 rounded-lg border border-border bg-card p-1.5 shadow-xl"><button data-testid="button-reset-chart" onClick={() => setShowLevels(true)} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted">Reset overlays</button><button data-testid="button-copy-chart" onClick={copyBrief} className="flex w-full items-center rounded-md px-2.5 py-2 text-left text-xs hover:bg-muted">Copy snapshot</button></div>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-4 sm:grid-cols-4">
                    {[
                      ['Volume', '$1.84B', '+12.4%', true],
                      ['Volatility', '43.8%', 'Elevated', false],
                      ['Funding', '0.008%', 'Neutral', true],
                      ['Dominance', '53.7%', '+0.31%', true],
                    ].map(([label, value, change, positive]) => <div key={String(label)}><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{String(label)}</div><div className="data-mono mt-1 text-sm font-semibold">{String(value)}</div><div className={`mt-0.5 text-[10px] ${positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-primary'}`}>{String(change)}</div></div>)}
                  </div>
                </div>
              </div>

              <aside className="rise-in rise-in-delay-1">
                <div className="panel scanline relative overflow-hidden rounded-2xl bg-secondary p-5 text-secondary-foreground sm:p-6">
                  <div className="relative z-[1]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-medium"><Sparkles size={15} className="text-primary" /> Analyst brief</div>
                      <button data-testid="button-pin-brief" aria-label="Pin analyst brief" onClick={() => setBriefPinned((value) => !value)} className={`rounded-md p-1.5 transition-colors ${briefPinned ? 'bg-primary text-primary-foreground' : 'text-secondary-foreground/50 hover:bg-secondary-foreground/10 hover:text-secondary-foreground'}`}><Pin size={15} className={briefPinned ? 'fill-current' : ''} /></button>
                    </div>
                    <div className="mt-7 flex items-center gap-3">
                      <div className="grid h-12 w-12 place-items-center rounded-xl border border-primary/30 bg-primary/15 text-primary"><TrendingUp size={22} /></div>
                      <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-secondary-foreground/45">Current posture</div><div className="mt-1 text-xl font-semibold tracking-[-0.04em]">Constructive</div></div>
                    </div>
                    <p className="mt-6 text-[13px] leading-[1.7] text-secondary-foreground/72">Price is accepting above the prior value area, with spot leading the move. The tape is healthy, but the next decision sits at <span className="font-semibold text-primary">$68.8k</span> where overhead liquidity begins to stack.</p>
                    <div className="mt-6 space-y-3">
                      {[
                        ['Bias', 'Bullish above $66.9k', 'good'],
                        ['Conviction', '7.4 / 10', 'good'],
                        ['Risk', 'Crowding into resistance', 'warn'],
                      ].map(([label, value, tone]) => <div key={String(label)} className="flex items-center justify-between border-b border-secondary-foreground/10 pb-3 text-xs last:border-0 last:pb-0"><span className="text-secondary-foreground/45">{String(label)}</span><span className={`flex items-center gap-1.5 font-medium ${tone === 'warn' ? 'text-primary' : 'text-secondary-foreground/90'}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === 'warn' ? 'bg-primary' : 'bg-emerald-400'}`} />{String(value)}</span></div>)}
                    </div>
                    <button data-testid="button-copy-brief" onClick={copyBrief} className="mt-7 flex w-full items-center justify-center gap-2 rounded-lg border border-secondary-foreground/15 bg-secondary-foreground/5 py-2.5 text-xs font-medium transition-colors hover:bg-primary hover:text-primary-foreground hover:border-primary"><BookOpen size={14} /> {briefPinned ? 'Brief copied to clipboard' : 'Copy decision brief'}</button>
                  </div>
                </div>
                <div className="panel mt-4 rounded-2xl p-5">
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Gauge size={16} className="text-primary" /> Risk dashboard</div><span className="data-mono text-[10px] text-muted-foreground">LIVE</span></div>
                  <div className="mt-5 flex items-center gap-4"><div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full" style={{ background: 'conic-gradient(hsl(31 100% 50%) 0 62%, hsl(39 30% 91%) 62% 100%)' }}><div className="grid h-[60px] w-[60px] place-items-center rounded-full bg-card"><span className="data-mono text-xl font-semibold">62</span></div></div><div><div className="text-sm font-medium">Moderate risk</div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Room remains, but reward compresses above the local high.</p></div></div>
                  <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-lg bg-muted/70 p-2.5"><div className="text-[10px] text-muted-foreground">Nearest support</div><div className="data-mono mt-1 text-xs font-semibold">$66.9k</div></div><div className="rounded-lg bg-muted/70 p-2.5"><div className="text-[10px] text-muted-foreground">Nearest risk</div><div className="data-mono mt-1 text-xs font-semibold">$68.8k</div></div></div>
                </div>
              </aside>
            </section>

            <section id="watchlist" className="rise-in rise-in-delay-2 mt-7">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Context</div><h2 className="mt-1 text-lg font-semibold tracking-[-0.04em]">Watchlist</h2></div>
                <label className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground focus-within:border-primary/60"><Search size={14} /><input data-testid="input-search-watchlist" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter symbols" className="w-28 bg-transparent outline-none placeholder:text-muted-foreground/60 sm:w-36" /></label>
              </div>
              {filteredWatchlist.length === 0 ? <div className="panel rounded-xl p-8 text-center text-sm text-muted-foreground">No symbols match <span className="font-medium text-foreground">“{search}”</span>.</div> : <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-1">{filteredWatchlist.map((asset) => <button key={asset.symbol} data-testid={`button-watchlist-${asset.symbol.toLowerCase()}`} onClick={() => setSelectedSymbol(asset.symbol)} className={`panel panel-hover min-w-[205px] flex-1 rounded-xl p-4 text-left ${selectedSymbol === asset.symbol ? 'border-primary/70 ring-1 ring-primary/20' : ''}`}><div className="flex items-start justify-between"><div className="flex items-center gap-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg text-[10px] font-bold ${asset.tone === 'orange' ? 'bg-primary text-primary-foreground' : asset.tone === 'violet' ? 'bg-violet-600 text-white' : asset.tone === 'teal' ? 'bg-teal-700 text-white' : asset.tone === 'blue' ? 'bg-sky-700 text-white' : 'bg-slate-500 text-white'}`}>{asset.symbol.slice(0, 1)}</span><div><div className="text-sm font-semibold">{asset.symbol}</div><div className="text-[10px] text-muted-foreground">{asset.name}</div></div></div><Star size={14} className={selectedSymbol === asset.symbol ? 'fill-primary text-primary' : 'text-muted-foreground/45'} /></div><div className="mt-4 flex items-baseline justify-between gap-2"><span className="data-mono text-sm font-semibold">{asset.price}</span><span className={`data-mono text-[10px] font-medium ${asset.positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>{asset.move}</span></div><div className="mt-2 truncate text-[10px] text-muted-foreground">{asset.note}</div></button>)}</div>}
            </section>

            <section id="validation" className="rise-in rise-in-delay-3 mt-8">
              <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                <div><div className="data-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Evidence log</div><h2 className="mt-1 text-lg font-semibold tracking-[-0.04em]">Recent validation</h2></div>
                <div className="flex items-center gap-2"><Filter size={14} className="text-muted-foreground" /> <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">{(['All checks', 'Passed', 'Watch'] as ValidationFilter[]).map((filter) => <button key={filter} data-testid={`button-validation-${filter.toLowerCase().replace(' ', '-')}`} onClick={() => setValidationFilter(filter)} className={`rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors ${validationFilter === filter ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{filter}</button>)}</div></div>
              </div>
              <div className="panel overflow-hidden rounded-2xl">
                <div className="hidden grid-cols-[1.35fr_1.65fr_.65fr_1fr_.55fr] gap-4 border-b border-border bg-muted/45 px-5 py-3 text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground sm:grid"><span>Check</span><span>Read</span><span>Score</span><span>Last run</span><span>Status</span></div>
                {filteredChecks.length === 0 ? <div className="p-10 text-center text-sm text-muted-foreground">No validation checks in this view.</div> : filteredChecks.map((check) => <div key={check.id} data-testid={`row-validation-${check.id}`} className="grid gap-2 border-b border-border px-4 py-4 last:border-0 hover:bg-muted/30 sm:grid-cols-[1.35fr_1.65fr_.65fr_1fr_.55fr] sm:items-center sm:gap-4 sm:px-5"><div className="flex items-center gap-2.5"><span className={`grid h-7 w-7 place-items-center rounded-lg ${check.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-primary/12 text-primary'}`}>{check.status === 'Passed' ? <Check size={14} /> : <SlidersHorizontal size={14} />}</span><span className="text-xs font-semibold">{check.label}</span></div><div className="pl-9 text-[11px] text-muted-foreground sm:pl-0">{check.detail}</div><div className="data-mono pl-9 text-[11px] font-medium sm:pl-0">{check.score}</div><div className="data-mono pl-9 text-[10px] text-muted-foreground sm:pl-0">{check.time}</div><div className="pl-9 sm:pl-0"><span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold ${check.status === 'Passed' ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-primary/12 text-primary'}`}><span className={`h-1.5 w-1.5 rounded-full ${check.status === 'Passed' ? 'bg-emerald-600' : 'bg-primary'}`} />{check.status}</span></div></div>)}
                <div className="flex items-center justify-between border-t border-border bg-muted/25 px-5 py-3"><span className="data-mono text-[10px] text-muted-foreground">Checks run locally · no external feed</span><button data-testid="button-run-validation" onClick={refreshMarket} className="flex items-center gap-1.5 text-[10px] font-medium text-primary hover:underline"><RefreshCw size={12} /> Run again</button></div>
              </div>
            </section>

            <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5 text-[10px] text-muted-foreground">
              <span className="data-mono uppercase tracking-[0.14em]">Decision surface / v0.8.4</span>
              <span className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /> All systems nominal <span className="mx-1 text-border">·</span> Local deterministic workspace</span>
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