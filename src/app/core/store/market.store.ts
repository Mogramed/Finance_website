import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  scan,
  shareReplay,
  skip,
  startWith,
  switchMap,
  tap,
  timer,
  withLatestFrom,
  exhaustMap,
} from 'rxjs';
import { catchError, retry } from 'rxjs/operators';
import { FinnhubService } from '../api/finnhub.service';


/** ---------- Types ---------- */

export type SortBy = 'symbol' | 'addedAt' | 'changePct';
export type SortDir = 'asc' | 'desc';

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
  refreshMs: number;
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

/** ---------- Actions (Subject) ---------- */

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
  | { type: 'RESET' };

/** ---------- Storage ---------- */

const STORAGE_KEY = 'rmd.market.v1';
function getLocalStorage(): Storage | null {
  try {
    // SSR: globalThis existe, mais localStorage non
    return typeof globalThis !== 'undefined' && 'localStorage' in globalThis
      ? (globalThis as any).localStorage as Storage
      : null;
  } catch {
    return null;
  }
}


function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isValidSymbol(s: unknown): s is string {
  return typeof s === 'string' && /^[A-Z0-9.\-]{1,12}$/.test(s);
}

function loadPersisted(): Partial<MarketState> {
  const ls = getLocalStorage();
  if (!ls) return {}; // SSR: pas de localStorage

  const parsed = safeParse<Partial<MarketState>>(ls.getItem(STORAGE_KEY));
  if (!parsed) return {};

  const watchlistRaw = Array.isArray(parsed.watchlist) ? parsed.watchlist : [];
  const watchlist: WatchlistItem[] = watchlistRaw
    .map((x: any) => ({
      symbol: String(x?.symbol ?? '').toUpperCase(),
      addedAt: Number(x?.addedAt ?? Date.now()),
    }))
    .filter((x) => isValidSymbol(x.symbol) && Number.isFinite(x.addedAt));

  const settings = parsed.settings ?? undefined;
  const refreshMs =
    typeof settings?.refreshMs === 'number' && settings.refreshMs >= 500 ? settings.refreshMs : undefined;

  const apiToken = typeof settings?.apiToken === 'string' ? settings.apiToken : null;

  return {
    watchlist,
    settings: {
      apiToken,
      refreshMs: refreshMs ?? 1500,
    },
  };
}

function persistState(s: MarketState) {
  const ls = getLocalStorage();
  if (!ls) return; // SSR: pas de localStorage

  const payload: Partial<MarketState> = {
    watchlist: s.watchlist,
    settings: s.settings,
  };
  ls.setItem(STORAGE_KEY, JSON.stringify(payload));
}

/** ---------- Reducer ---------- */

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
  },
};

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

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

      const next: WatchlistItem = { symbol, addedAt: Date.now() };
      return { ...state, watchlist: [next, ...state.watchlist] };
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

    default:
      return state;
  }
}

/** ---------- Mock quote generator (fallback si pas de token) ---------- */

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

/** ---------- Store ---------- */

@Injectable({ providedIn: 'root' })
export class MarketStore {
  private readonly finnhub = inject(FinnhubService);

  /** Subject = bus d’actions */
  private readonly actions$ = new Subject<Action>();

  /** BehaviorSubject = snapshot courant */
  private readonly snapshotSubject = new BehaviorSubject<MarketState>(this.computeInitialState());
  readonly snapshot$ = this.snapshotSubject.asObservable();

  /** Observable d’état (scan = reducer RxJS) */
  readonly state$: Observable<MarketState> = this.actions$.pipe(
    startWith({ type: '@@INIT' } as Action),
    scan((s, a) => reducer(s, a), this.snapshotSubject.value),
    tap((s) => this.snapshotSubject.next(s)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Selectors (flux dérivés) */
  readonly watchlist$ = this.snapshot$.pipe(
    map((s) => s.watchlist),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly selectedSymbol$ = this.snapshot$.pipe(
    map((s) => s.selectedSymbol),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly filters$ = this.snapshot$.pipe(
    map((s) => s.filters),
    distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly settings$ = this.snapshot$.pipe(
    map((s) => s.settings),
    distinctUntilChanged((a, b) => a.apiToken === b.apiToken && a.refreshMs === b.refreshMs),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly apiToken$ = this.settings$.pipe(
    map((s) => s.apiToken),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly hasToken$ = this.apiToken$.pipe(map((t) => !!t));

  readonly watchlistCount$ = this.watchlist$.pipe(map((w) => w.length));

  /** Tick “live” dépendant de refreshMs (switchMap) */
  readonly liveTick$ = this.settings$.pipe(
    map((x) => x.refreshMs),
    distinctUntilChanged(),
    switchMap((ms) => timer(0, ms)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Quotes live: Finnhub si token, sinon fallback mock */
  readonly quotes$ = combineLatest([this.liveTick$, this.watchlist$, this.apiToken$]).pipe(
  exhaustMap(([tick, list, token]) => {
    if (!token) {
      return of(list.map((w) => mockQuote(w.symbol, Number(tick))));
    }
    if (list.length === 0) return of([]);

    return forkJoin(
      list.map((w) =>
        this.finnhub.quote(w.symbol, token).pipe(
          retry({ count: 2, delay: (_err, retryCount) => timer(250 * retryCount) }),
          map((q) => ({
            symbol: w.symbol,
            price: q.c,
            changePct: q.dp,
            ts: q.t ? q.t * 1000 : Date.now(),
          })),
          catchError(() =>
            of({ symbol: w.symbol, price: Number.NaN, changePct: 0, ts: Date.now() })
          )
        )
      )
    );
  }),
  shareReplay({ bufferSize: 1, refCount: false })
);


  /** Watchlist enrichie (combineLatest) */
  readonly watchlistVm$ = combineLatest([this.watchlist$, this.quotes$]).pipe(
    map(([list, quotes]) => {
      const bySym = new Map(quotes.map((q) => [q.symbol, q]));
      return list.map((w) => {
        const q = bySym.get(w.symbol) ?? { symbol: w.symbol, price: NaN, changePct: 0, ts: Date.now() };
        return { ...w, ...q } as WatchlistVm;
      });
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  /** Filtrage + tri (map) */
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
    // Active le stream d’état + persistance
    this.state$.pipe(skip(1), tap(persistState)).subscribe();
  }

  /** ---------- API du store (dispatch) ---------- */

  addSymbol(symbol: string) {
    this.actions$.next({ type: 'ADD_SYMBOL', symbol });
  }
  removeSymbol(symbol: string) {
    this.actions$.next({ type: 'REMOVE_SYMBOL', symbol });
  }
  selectSymbol(symbol: string | null) {
    this.actions$.next({ type: 'SELECT_SYMBOL', symbol });
  }
  setQuery(query: string) {
    this.actions$.next({ type: 'SET_QUERY', query });
  }
  setMinChangePct(value: number | null) {
    this.actions$.next({ type: 'SET_MIN_CHANGE_PCT', value });
  }
  setSort(sortBy: SortBy, sortDir: SortDir) {
    this.actions$.next({ type: 'SET_SORT', sortBy, sortDir });
  }
  setRefreshMs(refreshMs: number) {
    this.actions$.next({ type: 'SET_REFRESH_MS', refreshMs });
  }
  setApiToken(apiToken: string | null) {
    this.actions$.next({ type: 'SET_API_TOKEN', apiToken });
  }
  reset() {
    this.actions$.next({ type: 'RESET' });
  }

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
