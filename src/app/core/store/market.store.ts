import { Injectable, inject } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  distinctUntilChanged,
  map,
  scan,
  shareReplay,
  skip,
  startWith,
  switchMap,
  tap
} from 'rxjs';

import { MarketDataService } from '../api/market-data.service';
import { UniversalQuote, AssetType } from '../api/market-interfaces';

/** ---------- Types ---------- */
export type SortBy = 'symbol' | 'addedAt' | 'changePct';
export type SortDir = 'asc' | 'desc';
// On ajoute 'STATS' ici pour gérer l'onglet
export type FilterType = 'ALL' | AssetType | 'STATS'; 

export interface WatchlistItem {
  symbol: string;
  addedAt: number;
}

export interface Filters {
  query: string;
  minChangePct: number | null;
  sortBy: SortBy;
  sortDir: SortDir;
  assetType: FilterType;
}

export interface Settings {
  refreshMs: number;
}

export interface MarketState {
  watchlist: WatchlistItem[];
  selectedSymbol: string | null;
  filters: Filters;
  settings: Settings;
}

export interface WatchlistVm extends WatchlistItem, UniversalQuote {}

// Interface pour nos statistiques
export interface MarketStats {
  topGainer: WatchlistVm | null;
  topLoser: WatchlistVm | null;
  avgChange: number;
  totalCount: number;
  distribution: { type: AssetType; count: number; pct: number; color: string }[];
}

/** ---------- Actions ---------- */
type Action =
  | { type: '@@INIT' }
  | { type: 'ADD_SYMBOL'; symbol: string }
  | { type: 'REMOVE_SYMBOL'; symbol: string }
  | { type: 'SELECT_SYMBOL'; symbol: string | null }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_MIN_CHANGE_PCT'; value: number | null }
  | { type: 'SET_SORT'; sortBy: SortBy; sortDir: SortDir }
  | { type: 'SET_ASSET_TYPE'; assetType: FilterType }
  | { type: 'SET_REFRESH_MS'; refreshMs: number }
  | { type: 'RESET' };

/** ---------- Storage Utils ---------- */
const STORAGE_KEY = 'rmd.market.v3'; 

function getLocalStorage() {
  try { return typeof globalThis !== 'undefined' ? localStorage : null; } catch { return null; }
}

function loadPersisted(): Partial<MarketState> {
  const ls = getLocalStorage();
  if (!ls) return {};
  try {
    const parsed = JSON.parse(ls.getItem(STORAGE_KEY) || '{}');
    return parsed;
  } catch { return {}; }
}

function persistState(s: MarketState) {
  const ls = getLocalStorage();
  if (ls) ls.setItem(STORAGE_KEY, JSON.stringify({ watchlist: s.watchlist, settings: s.settings }));
}

/** ---------- Reducer ---------- */
const DEFAULT_STATE: MarketState = {
  watchlist: [
    { symbol: 'BTCUSDT', addedAt: Date.now() },
    { symbol: 'ETHUSDT', addedAt: Date.now() },
    { symbol: 'AAPL', addedAt: Date.now() },
    { symbol: 'EUR/USD', addedAt: Date.now() }
  ],
  selectedSymbol: null,
  filters: { query: '', minChangePct: null, sortBy: 'addedAt', sortDir: 'desc', assetType: 'ALL' },
  settings: { refreshMs: 30000 },
};

function reducer(state: MarketState, action: Action): MarketState {
  switch (action.type) {
    case '@@INIT': return state;
    case 'RESET': return DEFAULT_STATE;
    
    case 'ADD_SYMBOL':
      const s = action.symbol.trim().toUpperCase();
      if (state.watchlist.some(w => w.symbol === s)) return state;
      return { ...state, watchlist: [{ symbol: s, addedAt: Date.now() }, ...state.watchlist] };
      
    case 'REMOVE_SYMBOL':
      return { ...state, watchlist: state.watchlist.filter(w => w.symbol !== action.symbol) };
      
    case 'SELECT_SYMBOL':
      return { ...state, selectedSymbol: action.symbol };
      
    case 'SET_QUERY':
      return { ...state, filters: { ...state.filters, query: action.query } };
      
    case 'SET_MIN_CHANGE_PCT':
      return { ...state, filters: { ...state.filters, minChangePct: action.value } };
      
    case 'SET_SORT':
      return { ...state, filters: { ...state.filters, sortBy: action.sortBy, sortDir: action.sortDir } };
      
    case 'SET_ASSET_TYPE': 
      return { ...state, filters: { ...state.filters, assetType: action.assetType } };
      
    case 'SET_REFRESH_MS':
      return { ...state, settings: { ...state.settings, refreshMs: action.refreshMs } };
      
    default: return state;
  }
}

/** ---------- Store ---------- */
@Injectable({ providedIn: 'root' })
export class MarketStore {
  private readonly marketData = inject(MarketDataService);
  
  private readonly actions$ = new Subject<Action>();
  private readonly snapshotSubject = new BehaviorSubject<MarketState>(this.computeInitialState());
  
  readonly snapshot$ = this.snapshotSubject.asObservable();

  readonly state$ = this.actions$.pipe(
    startWith({ type: '@@INIT' } as Action),
    scan((s, a) => reducer(s, a), this.snapshotSubject.value),
    tap(s => this.snapshotSubject.next(s)),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  // --- Selectors ---
  readonly watchlist$ = this.snapshot$.pipe(map(s => s.watchlist), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: true }));
  readonly settings$ = this.snapshot$.pipe(map(s => s.settings), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: true }));
  readonly filters$ = this.snapshot$.pipe(map(s => s.filters), distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: true }));
  
  readonly watchlistCount$ = this.watchlist$.pipe(map(w => w.length));
  readonly hasToken$ = this.snapshot$.pipe(map(() => true)); 

  // --- Live Feed ---
  readonly quotes$ = combineLatest([this.watchlist$, this.settings$]).pipe(
    switchMap(([list, settings]) => {
      const symbols = list.map(w => w.symbol);
      return this.marketData.watch(symbols, settings.refreshMs);
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // --- Vue Combinée ---
  readonly watchlistVm$ = combineLatest([this.watchlist$, this.quotes$]).pipe(
    map(([list, quotes]) => {
      const qMap = new Map(quotes.map(q => [q.symbol, q]));
      return list.map(w => {
        const quote = qMap.get(w.symbol) ?? { 
          symbol: w.symbol, price: 0, changePct: 0, ts: Date.now(), source: 'MOCK', type: 'STOCK' 
        };
        return { ...w, ...quote };
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // --- NOUVEAU : CALCULATEUR DE STATS ---
  readonly stats$ = this.watchlistVm$.pipe(
    map((items): MarketStats | null => {
      if (!items.length) return null;

      // 1. Top Winners/Losers
      // On trie par performance
      const sorted = [...items].sort((a, b) => b.changePct - a.changePct);
      const topGainer = sorted[0];
      const topLoser = sorted[sorted.length - 1];
      
      // 2. Moyenne
      const avgChange = items.reduce((acc, i) => acc + i.changePct, 0) / items.length;

      // 3. Distribution
      const counts: Record<string, number> = {};
      items.forEach(i => counts[i.type] = (counts[i.type] || 0) + 1);

      const colorMap: Record<string, string> = {
        'CRYPTO': '#8b5cf6', // Violet
        'STOCK': '#0ea5e9',  // Bleu
        'FOREX': '#10b981'   // Vert (ou autre)
      };

      const distribution = Object.entries(counts).map(([type, count]) => ({
        type: type as AssetType,
        count,
        pct: (count / items.length) * 100,
        color: colorMap[type] || '#64748b'
      })).sort((a, b) => b.pct - a.pct); // Les plus gros segments d'abord

      return { topGainer, topLoser, avgChange, totalCount: items.length, distribution };
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // --- Filtrage ---
  readonly filteredWatchlistVm$ = combineLatest([this.watchlistVm$, this.filters$]).pipe(
    map(([items, f]) => {
      // Si on est en mode STATS, on ne filtre pas la liste ici, mais le composant gérera l'affichage
      if (f.assetType === 'STATS') return items; 

      let out = items;
      if (f.assetType !== 'ALL') out = out.filter(x => x.type === f.assetType);
      
      const q = f.query.trim().toUpperCase();
      if (q) out = out.filter(x => x.symbol.includes(q));
      
      if (f.minChangePct) out = out.filter(x => x.changePct >= f.minChangePct!);

      const dir = f.sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        let valA: any = a[f.sortBy];
        let valB: any = b[f.sortBy];
        if (typeof valA === 'string') return valA.localeCompare(valB) * dir;
        return (valA - valB) * dir;
      });
      return out;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    this.state$.pipe(skip(1), tap(persistState)).subscribe();
  }

  // --- API ---
  addSymbol(symbol: string) { this.actions$.next({ type: 'ADD_SYMBOL', symbol }); }
  removeSymbol(symbol: string) { this.actions$.next({ type: 'REMOVE_SYMBOL', symbol }); }
  selectSymbol(symbol: string | null) { this.actions$.next({ type: 'SELECT_SYMBOL', symbol }); }
  setQuery(query: string) { this.actions$.next({ type: 'SET_QUERY', query }); }
  setSort(sortBy: SortBy, sortDir: SortDir) { this.actions$.next({ type: 'SET_SORT', sortBy, sortDir }); }
  setMinChangePct(value: number | null) { this.actions$.next({ type: 'SET_MIN_CHANGE_PCT', value }); }
  setRefreshMs(refreshMs: number) { this.actions$.next({ type: 'SET_REFRESH_MS', refreshMs }); }
  setAssetType(assetType: FilterType) { this.actions$.next({ type: 'SET_ASSET_TYPE', assetType }); }
  reset() { this.actions$.next({ type: 'RESET' }); }
  
  private computeInitialState(): MarketState {
    const p = loadPersisted();
    return { ...DEFAULT_STATE, ...p, filters: { ...DEFAULT_STATE.filters, assetType: 'ALL' } };
  }
}