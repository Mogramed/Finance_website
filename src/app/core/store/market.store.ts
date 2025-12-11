import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Subject,
  combineLatest,
  distinctUntilChanged,
  exhaustMap,
  filter,
  forkJoin,
  map,
  merge,
  of,
  scan,
  shareReplay,
  skip,
  startWith,
  switchMap,
  tap,
  timer,
} from 'rxjs';
import { catchError, retry } from 'rxjs/operators';

import { FinnhubService } from '../api/finnhub.service';
import { FinnhubWsService, TradeTick } from '../api/finnhub-ws.service';

export type SortBy = 'symbol' | 'addedAt' | 'changePct';
export type SortDir = 'asc' | 'desc';

export type LiveMode = 'ws' | 'poll';

export interface WatchlistItem {
  symbol: string;
  addedAt: number;
}

export interface Filters {
  query: string;
  minChangePct: number | null;
  sortBy: SortBy;
  sortDir: SortDir;
}

export interface Settings {
  apiToken: string | null;
  refreshMs: number;     // utilisé en mode poll
  liveMode: LiveMode;    // 'ws' ou 'poll'
}

export interface MarketState {
  watchlist: WatchlistItem[];
  selectedSymbol: string | null;
  filters: Filters;
  settings: Settings;
}

export interface QuoteVm {
  symbol: string;
  price: number;
  changePct: number;
  ts: number;
}

export interface WatchlistVm extends WatchlistItem, QuoteVm {}

type Action =
  | { type: '@@INIT' }
  | { type: 'ADD_SYMBOL'; symbol: string }
  | { type: 'REMOVE_SYMBOL'; symbol: string }
  | { type: 'SELECT_SYMBOL'; symbol: string | null }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_MIN_CHANGE_PCT'; value: number | null }
  | { type: 'SET_SORT'; sortBy: SortBy; sortDir: SortDir }
  | { type: 'SET_REFRESH_MS'; refreshMs: number }
  | { type: 'SET_API_TOKEN'; apiToken: string | null }
  | { type: 'SET_LIVE_MODE'; liveMode: LiveMode }
  | { type: 'RESET' };

const STORAGE_KEY = 'rmd.market.v2';

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function getLocalStorage(): Storage | null {
  try {
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? ((globalThis as any).localStorage as Storage)
      : null;
  } catch {
    return null;
  }
}

function isValidSymbol(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Z0-9.\-]{1,12}$/.test(s);
}

function loadPersisted(): Partial<MarketState> {
  const ls = getLocalStorage();
  if (!ls) return {};

  const parsed = safeParse<Partial<MarketState>>(ls.getItem(STORAGE_KEY));
  if (!parsed) return {};

  const watchlistRaw = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
  const watchlist: WatchlistItem[] = watchlistRaw
    .map((x: any) => ({
      symbol: String(x?.symbol ?? '').toUpperCase(),
      addedAt: Number(x?.addedAt ?? Date.now()),
    }))
    .filter((x) => isValidSymbol(x.symbol) && Number.isFinite(x.addedAt));

  const settings = parsed.settings ?? {};
  const refreshMs = typeof (settings as any).refreshMs === 'number' ? Math.max(500, (settings as any).refreshMs) : 1500;
  const apiToken = typeof (settings as any).apiToken === 'string' ? (settings as any).apiToken : null;
  const liveMode: LiveMode = (settings as any).liveMode === 'poll' ? 'poll' : 'ws';

  return { watchlist, settings: { apiToken, refreshMs, liveMode } };
}

function persistState(s: MarketState) {
  const ls = getLocalStorage();
  if (!ls) return;
  ls.setItem(
    STORAGE_KEY,
    JSON.stringify({
      watchlist: s.watchlist,
      settings: s.settings,
    })
  );
}

function normalizeSymbol(s: string) {
  return s.trim().toUpperCase();
}

const DEFAULT_STATE: MarketState = {
  watchlist: [
    { symbol: 'AAPL', addedAt: Date.now() - 1000 * 60 * 60 },
    { symbol: 'MSFT', addedAt: Date.now() - 1000 * 60 * 45 },
    { symbol: 'TSLA', addedAt: Date.now() - 1000 * 60 * 30 },
  ],
  selectedSymbol: null,
  filters: {
    query: '',
    minChangePct: null,
    sortBy: 'addedAt',
    sortDir: 'desc',
  },
  settings: {
    apiToken: null,
    refreshMs: 1500,
    liveMode: 'ws',
  },
};

function reducer(state: MarketState, action: Action): MarketState {
  switch (action.type) {
    case '@@INIT':
      return state;

    case 'RESET':
      return DEFAULT_STATE;

    case 'ADD_SYMBOL': {
      const symbol = normalizeSymbol(action.symbol);
      if (!isValidSymbol(symbol)) return state;
      if (state.watchlist.some((w) => w.symbol === symbol)) return state;
      return { ...state, watchlist: [{ symbol, addedAt: Date.now() }, ...state.watchlist] };
    }

    case 'REMOVE_SYMBOL': {
      const symbol = normalizeSymbol(action.symbol);
      const next = state.watchlist.filter((w) => w.symbol !== symbol);
      const selectedSymbol = state.selectedSymbol === symbol ? null : state.selectedSymbol;
      return { ...state, watchlist: next, selectedSymbol };
    }

    case 'SELECT_SYMBOL':
      return { ...state, selectedSymbol: action.symbol };

    case 'SET_QUERY':
      return { ...state, filters: { ...state.filters, query: action.query } };

    case 'SET_MIN_CHANGE_PCT':
      return { ...state, filters: { ...state.filters, minChangePct: action.value } };

    case 'SET_SORT':
      return { ...state, filters: { ...state.filters, sortBy: action.sortBy, sortDir: action.sortDir } };

    case 'SET_REFRESH_MS':
      return { ...state, settings: { ...state.settings, refreshMs: action.refreshMs } };

    case 'SET_API_TOKEN':
      return { ...state, settings: { ...state.settings, apiToken: action.apiToken } };

    case 'SET_LIVE_MODE':
      return { ...state, settings: { ...state.settings, liveMode: action.liveMode } };

    default:
      return state;
  }
}

/** fallback mock si pas de token */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function mockQuote(symbol: string, tick: number): QuoteVm {
  const h = hashString(symbol);
  const base = 80 + (h % 220);
  const wave1 = Math.sin((tick + (h % 10)) / 3) * 2.0;
  const wave2 = Math.sin(tick / 1.7 + (h % 100)) * 0.6;
  const price = Math.max(1, base + wave1 + wave2);
  const changePct = ((price - base) / base) * 100;

  return {
    symbol,
    price: Math.round(price * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    ts: Date.now(),
  };
}

function arrayEq(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

@Injectable({ providedIn: 'root' })
export class MarketStore {
  private readonly finnhub = inject(FinnhubService);
  private readonly ws = inject(FinnhubWsService);

  private readonly actions$ = new Subject<Action>();
  private readonly snapshotSubject = new BehaviorSubject<MarketState>(this.computeInitialState());
  readonly snapshot$ = this.snapshotSubject.asObservable();

  readonly state$ = this.actions$.pipe(
    startWith({ type: '@@INIT' } as Action),
    scan((s, a) => reducer(s, a), this.snapshotSubject.value),
    tap((s) => this.snapshotSubject.next(s)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly watchlist$ = this.snapshot$.pipe(map((s) => s.watchlist), shareReplay({ bufferSize: 1, refCount: false }));
  readonly selectedSymbol$ = this.snapshot$.pipe(map((s) => s.selectedSymbol), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: false }));
  readonly filters$ = this.snapshot$.pipe(map((s) => s.filters), shareReplay({ bufferSize: 1, refCount: false }));
  readonly settings$ = this.snapshot$.pipe(map((s) => s.settings), shareReplay({ bufferSize: 1, refCount: false }));

  readonly apiToken$ = this.settings$.pipe(map((s) => s.apiToken), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: false }));
  readonly hasToken$ = this.apiToken$.pipe(map((t) => !!t));
  readonly liveMode$ = this.settings$.pipe(map((s) => s.liveMode), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: false }));

  /** Expose status WS pour UI */
  readonly wsStatus$ = this.ws.status$;

  /** Liste de symboles à “suivre” (watchlist + symbol page) */
  readonly subscriptionSymbols$ = combineLatest([this.watchlist$, this.selectedSymbol$]).pipe(
    map(([wl, selected]) => {
      const syms = wl.map((w) => w.symbol);
      if (selected) syms.push(selected);
      const uniq = Array.from(new Set(syms.map((s) => s.toUpperCase()))).sort();
      return uniq;
    }),
    distinctUntilChanged(arrayEq),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Active WS seulement si mode=ws ET token présent */
  readonly wsEnabled$ = combineLatest([this.liveMode$, this.apiToken$]).pipe(
    map(([mode, tok]) => mode === 'ws' && !!tok),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** ------------------ MODE POLL (REST) ------------------ */

  private readonly MIN_REFRESH_WITH_TOKEN = 4000;
  private readonly PER_SYMBOL_MS = 1000;

  readonly effectiveRefreshMs$ = combineLatest([this.settings$, this.subscriptionSymbols$, this.apiToken$, this.liveMode$]).pipe(
    map(([s, subs, token, mode]) => {
      if (mode !== 'poll') return s.refreshMs;
      if (!token) return Math.max(500, s.refreshMs);
      const n = Math.max(1, subs.length);
      return Math.max(s.refreshMs, this.MIN_REFRESH_WITH_TOKEN, this.PER_SYMBOL_MS * n);
    }),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Tick en mode poll */
  readonly liveTick$ = combineLatest([this.liveMode$, this.effectiveRefreshMs$]).pipe(
    switchMap(([mode, ms]) => (mode === 'poll' ? timer(0, ms) : of(0))),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Quotes via REST (/quote) */
  private readonly restQuotes$ = combineLatest([this.liveTick$, this.watchlist$, this.apiToken$]).pipe(
    exhaustMap(([tick, list, token]) => {
      if (!token) return of(list.map((w) => mockQuote(w.symbol, Number(tick))));
      if (list.length === 0) return of([]);

      return forkJoin(
        list.map((w) =>
          this.finnhub.quote(w.symbol, token).pipe(
            retry({ count: 2, delay: (_e, i) => timer(250 * i) }),
            map((q) => ({
              symbol: w.symbol,
              price: q.c,
              changePct: q.dp,
              ts: q.t ? q.t * 1000 : Date.now(),
            })),
            catchError(() => of({ symbol: w.symbol, price: Number.NaN, changePct: 0, ts: Date.now() }))
          )
        )
      );
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** ------------------ MODE WS (PUSH) ------------------ */

  /**
   * On construit un “état live” via scan :
   * - first = 1er prix reçu depuis la subscription
   * - last  = dernier prix
   * -> changePct = (last-first)/first
   */
  private readonly wsLiveState$ = merge(
    this.subscriptionSymbols$.pipe(map((syms) => ({ kind: 'set' as const, syms }))),
    this.ws.trade$.pipe(map((t) => ({ kind: 'trade' as const, t })))
  ).pipe(
    scan((state, ev) => {
      if (ev.kind === 'set') {
        const keep = new Set(ev.syms);
        const next: Record<string, { first: number; last: number; ts: number }> = {};
        for (const k of Object.keys(state)) {
          if (keep.has(k)) next[k] = state[k];
        }
        return next;
      }

      const tt: TradeTick = ev.t;
      const s = tt.symbol.toUpperCase();
      const p = tt.price;
      const ts = tt.ts;

      // si le symbole n’est pas dans l’état (pas encore / resub), init first=last
      const cur = state[s];
      if (!cur) {
        return { ...state, [s]: { first: p, last: p, ts } };
      }
      return { ...state, [s]: { first: cur.first, last: p, ts } };
    }, {} as Record<string, { first: number; last: number; ts: number }>),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Quotes list pour la watchlist, dérivées du state WS */
  private readonly wsQuotes$ = combineLatest([this.watchlist$, this.wsLiveState$]).pipe(
    map(([wl, st]) =>
      wl.map((w) => {
        const x = st[w.symbol];
        if (!x) return { symbol: w.symbol, price: Number.NaN, changePct: 0, ts: Date.now() };
        const changePct = x.first ? ((x.last - x.first) / x.first) * 100 : 0;
        return { symbol: w.symbol, price: x.last, changePct, ts: x.ts };
      })
    ),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** ------------------ Quotes “finales” (ws ou poll) ------------------ */
  readonly quotes$ = combineLatest([this.liveMode$, this.wsEnabled$]).pipe(
    switchMap(([mode, wsEnabled]) => {
      if (mode === 'ws' && wsEnabled) return this.wsQuotes$;
      return this.restQuotes$; // poll ou token absent => REST/mock
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Join watchlist + quotes => VM */
  readonly watchlistVm$ = combineLatest([this.watchlist$, this.quotes$]).pipe(
    map(([list, quotes]) => {
      const bySym = new Map(quotes.map((q) => [q.symbol, q]));
      return list.map((w) => {
        const q = bySym.get(w.symbol);
        return {
          ...w,
          symbol: w.symbol,
          price: q?.price ?? Number.NaN,
          changePct: q?.changePct ?? 0,
          ts: q?.ts ?? Date.now(),
        } as WatchlistVm;
      });
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Filtrage + tri */
  readonly filteredWatchlistVm$ = combineLatest([this.watchlistVm$, this.filters$]).pipe(
    map(([items, f]) => {
      const q = f.query.trim().toUpperCase();
      const min = f.minChangePct;

      let out = items;
      if (q) out = out.filter((x) => x.symbol.includes(q));
      if (typeof min === 'number') out = out.filter((x) => x.changePct >= min);

      const dir = f.sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        let av: number | string = a.symbol;
        let bv: number | string = b.symbol;

        if (f.sortBy === 'addedAt') { av = a.addedAt; bv = b.addedAt; }
        if (f.sortBy === 'changePct') { av = a.changePct; bv = b.changePct; }

        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
        return (Number(av) - Number(bv)) * dir;
      });

      return out;
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  constructor() {
    // persist
    this.state$.pipe(skip(1), tap(persistState)).subscribe();

    // Pilote le WS service (token + subscriptions) de façon réactive
    combineLatest([this.wsEnabled$, this.apiToken$]).subscribe(([enabled, tok]) => {
      this.ws.setToken(enabled ? tok : null);
    });

    combineLatest([this.wsEnabled$, this.subscriptionSymbols$]).subscribe(([enabled, syms]) => {
      this.ws.setSubscriptions(enabled ? syms : []);
    });
  }

  addSymbol(symbol: string) { this.actions$.next({ type: 'ADD_SYMBOL', symbol }); }
  removeSymbol(symbol: string) { this.actions$.next({ type: 'REMOVE_SYMBOL', symbol }); }
  selectSymbol(symbol: string | null) { this.actions$.next({ type: 'SELECT_SYMBOL', symbol }); }
  setQuery(query: string) { this.actions$.next({ type: 'SET_QUERY', query }); }
  setMinChangePct(value: number | null) { this.actions$.next({ type: 'SET_MIN_CHANGE_PCT', value }); }
  setSort(sortBy: SortBy, sortDir: SortDir) { this.actions$.next({ type: 'SET_SORT', sortBy, sortDir }); }
  setRefreshMs(refreshMs: number) { this.actions$.next({ type: 'SET_REFRESH_MS', refreshMs }); }
  setApiToken(apiToken: string | null) { this.actions$.next({ type: 'SET_API_TOKEN', apiToken }); }
  setLiveMode(liveMode: LiveMode) { this.actions$.next({ type: 'SET_LIVE_MODE', liveMode }); }
  reset() { this.actions$.next({ type: 'RESET' }); }

  private computeInitialState(): MarketState {
    const persisted = loadPersisted();
    return {
      ...DEFAULT_STATE,
      ...persisted,
      filters: { ...DEFAULT_STATE.filters, ...(persisted.filters ?? {}) },
      settings: { ...DEFAULT_STATE.settings, ...(persisted.settings ?? {}) },
    };
  }
}
  