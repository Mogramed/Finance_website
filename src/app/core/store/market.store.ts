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
export type SortBy = 'symbol' | 'addedAt' | 'changePct' | 'pnl';
export type SortDir = 'asc' | 'desc';
export type FilterType = 'ALL' | AssetType | 'STATS'; 

export interface Position {
  quantity: number;
  avgPrice: number;
}

export interface Transaction {
  id: string;
  type: 'BUY' | 'SELL';
  symbol: string;
  qty: number;
  price: number;
  total: number;
  date: number;
}

export interface WatchlistItem {
  symbol: string;
  addedAt: number;
  position?: Position;
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
  balance: number;
  transactions: Transaction[];
  watchlist: WatchlistItem[];
  selectedSymbol: string | null;
  filters: Filters;
  settings: Settings;
}

export interface WatchlistVm extends WatchlistItem, UniversalQuote {
  holdingValue?: number;
  investedValue?: number;
  pnl?: number;
  pnlPct?: number;
}

export interface MarketStats {
  topGainer: WatchlistVm | null;
  topLoser: WatchlistVm | null;
  avgChange: number;
  totalCount: number;
  distribution: { type: AssetType; count: number; pct: number; color: string }[];
  totalInvested: number;
  totalValue: number;
  totalPnl: number;
  balance: number;
  netWorth: number;
}

/** ---------- Actions ---------- */
type Action =
  | { type: '@@INIT' }
  | { type: 'ADD_SYMBOL'; symbol: string }
  | { type: 'REMOVE_SYMBOL'; symbol: string }
  | { type: 'EXECUTE_ORDER'; side: 'BUY' | 'SELL'; symbol: string; qty: number; price: number }
  | { type: 'UPDATE_POSITION'; symbol: string; qty: number; price: number } // <--- LE RETOUR !
  | { type: 'SELECT_SYMBOL'; symbol: string | null }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_MIN_CHANGE_PCT'; value: number | null }
  | { type: 'SET_SORT'; sortBy: SortBy; sortDir: SortDir }
  | { type: 'SET_ASSET_TYPE'; assetType: FilterType }
  | { type: 'SET_REFRESH_MS'; refreshMs: number }
  | { type: 'RESET' };

const STORAGE_KEY = 'rmd.market.v5'; 

function getLocalStorage() {
  try { return typeof globalThis !== 'undefined' ? localStorage : null; } catch { return null; }
}

function loadPersisted(): Partial<MarketState> {
  const ls = getLocalStorage();
  if (!ls) return {};
  try { return JSON.parse(ls.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

function persistState(s: MarketState) {
  const ls = getLocalStorage();
  if (ls) ls.setItem(STORAGE_KEY, JSON.stringify({ 
    watchlist: s.watchlist, 
    settings: s.settings, 
    balance: s.balance, 
    transactions: s.transactions 
  }));
}

const DEFAULT_STATE: MarketState = {
  balance: 50000, 
  transactions: [],
  watchlist: [
    { symbol: 'BTCUSDT', addedAt: Date.now() },
    { symbol: 'AAPL', addedAt: Date.now() }
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

    // --- MISE À JOUR MANUELLE (Sans toucher au Cash) ---
    case 'UPDATE_POSITION': {
      return {
        ...state,
        watchlist: state.watchlist.map(w => {
          if (w.symbol !== action.symbol) return w;
          if (action.qty <= 0) {
            const { position, ...rest } = w;
            return rest;
          }
          return { ...w, position: { quantity: action.qty, avgPrice: action.price } };
        })
      };
    }

    // --- TRADING (Touche au Cash + Historique) ---
    case 'EXECUTE_ORDER': {
      const { side, symbol, qty, price } = action;
      const total = qty * price;
      
      if (side === 'BUY' && total > state.balance) {
        alert("Pas assez de cash !"); 
        return state;
      }

      const newBalance = side === 'BUY' ? state.balance - total : state.balance + total;

      const tx: Transaction = {
        id: Date.now().toString(),
        type: side,
        symbol, qty, price, total,
        date: Date.now()
      };

      const existingItem = state.watchlist.find(w => w.symbol === symbol);
      let newWatchlist = [...state.watchlist];

      if (!existingItem) {
        if (side === 'BUY') {
          newWatchlist.unshift({ 
            symbol, 
            addedAt: Date.now(), 
            position: { quantity: qty, avgPrice: price } 
          });
        }
      } else {
        newWatchlist = newWatchlist.map(w => {
          if (w.symbol !== symbol) return w;
          
          const currentQty = w.position?.quantity || 0;
          const currentAvg = w.position?.avgPrice || 0;
          
          let newQty = 0;
          let newAvg = 0;

          if (side === 'BUY') {
            newQty = currentQty + qty;
            const currentInvested = currentQty * currentAvg;
            newAvg = (currentInvested + total) / newQty;
          } else {
            newQty = Math.max(0, currentQty - qty);
            newAvg = currentAvg; 
          }

          if (newQty === 0) {
            const { position, ...rest } = w;
            return rest;
          }
          return { ...w, position: { quantity: newQty, avgPrice: newAvg } };
        });
      }

      return {
        ...state,
        balance: newBalance,
        transactions: [tx, ...state.transactions].slice(0, 50),
        watchlist: newWatchlist
      };
    }
      
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

  // Selectors
  readonly watchlist$ = this.snapshot$.pipe(map(s => s.watchlist), distinctUntilChanged(), shareReplay(1));
  readonly settings$ = this.snapshot$.pipe(map(s => s.settings), distinctUntilChanged(), shareReplay(1));
  readonly filters$ = this.snapshot$.pipe(map(s => s.filters), distinctUntilChanged(), shareReplay(1));
  readonly balance$ = this.snapshot$.pipe(map(s => s.balance), distinctUntilChanged(), shareReplay(1));
  readonly transactions$ = this.snapshot$.pipe(map(s => s.transactions), distinctUntilChanged(), shareReplay(1));
  
  readonly watchlistCount$ = this.watchlist$.pipe(map(w => w.length));
  readonly hasToken$ = this.snapshot$.pipe(map(() => true)); 

  readonly quotes$ = combineLatest([this.watchlist$, this.settings$]).pipe(
    switchMap(([list, settings]) => {
      const symbols = list.map(w => w.symbol);
      return this.marketData.watch(symbols, settings.refreshMs);
    }),
    shareReplay(1)
  );

  readonly watchlistVm$ = combineLatest([this.watchlist$, this.quotes$]).pipe(
    map(([list, quotes]) => {
      const qMap = new Map(quotes.map(q => [q.symbol, q]));
      return list.map(w => {
        const quote = qMap.get(w.symbol) ?? { 
          symbol: w.symbol, price: 0, changePct: 0, ts: Date.now(), source: 'MOCK', type: 'STOCK' 
        };
        const vm: WatchlistVm = { ...w, ...quote };
        if (w.position && quote.price > 0) {
          vm.investedValue = w.position.quantity * w.position.avgPrice;
          vm.holdingValue = w.position.quantity * quote.price;
          vm.pnl = vm.holdingValue - vm.investedValue;
          vm.pnlPct = (vm.pnl / vm.investedValue) * 100;
        }
        return vm;
      });
    }),
    shareReplay(1)
  );

  readonly stats$ = combineLatest([this.watchlistVm$, this.balance$]).pipe(
    map(([items, balance]): MarketStats | null => {
      if (!items.length && balance === 0) return null;
      const sorted = [...items].sort((a, b) => b.changePct - a.changePct);
      const counts: Record<string, number> = {};
      let totalInvested = 0;
      let totalValue = 0;

      items.forEach(i => {
        counts[i.type] = (counts[i.type] || 0) + 1;
        if (i.investedValue && i.holdingValue) {
          totalInvested += i.investedValue;
          totalValue += i.holdingValue;
        }
      });

      const distribution = Object.entries(counts).map(([type, count]) => ({
        type: type as AssetType, count, pct: (count / items.length) * 100, color: this.getColor(type)
      })).sort((a, b) => b.pct - a.pct);

      return { 
        topGainer: sorted[0], topLoser: sorted[sorted.length - 1], 
        avgChange: items.length ? items.reduce((acc, i) => acc + i.changePct, 0) / items.length : 0,
        totalCount: items.length, distribution,
        totalInvested, totalValue, totalPnl: totalValue - totalInvested,
        balance,
        netWorth: balance + totalValue
      };
    }),
    shareReplay(1)
  );

  private getColor(type: string): string {
    if (type === 'CRYPTO') return '#8b5cf6';
    if (type === 'STOCK') return '#0ea5e9';
    return '#10b981';
  }

  readonly filteredWatchlistVm$ = combineLatest([this.watchlistVm$, this.filters$]).pipe(
    map(([items, f]) => {
      if (f.assetType === 'STATS') return items; 
      let out = items;
      if (f.assetType !== 'ALL') out = out.filter(x => x.type === f.assetType);
      const q = f.query.trim().toUpperCase();
      if (q) out = out.filter(x => x.symbol.includes(q));
      if (f.minChangePct) out = out.filter(x => x.changePct >= f.minChangePct!);
      const dir = f.sortDir === 'asc' ? 1 : -1;
      out = [...out].sort((a, b) => {
        let valA: any = a[f.sortBy] ?? 0;
        let valB: any = b[f.sortBy] ?? 0;
        if (typeof valA === 'string') return valA.localeCompare(valB) * dir;
        return (valA - valB) * dir;
      });
      return out;
    }),
    shareReplay(1)
  );

  constructor() {
    this.state$.pipe(skip(1), tap(persistState)).subscribe();
  }

  addSymbol(symbol: string) { this.actions$.next({ type: 'ADD_SYMBOL', symbol }); }
  removeSymbol(symbol: string) { this.actions$.next({ type: 'REMOVE_SYMBOL', symbol }); }
  
  // Cette méthode était manquante !
  updatePosition(symbol: string, qty: number, price: number) { 
    this.actions$.next({ type: 'UPDATE_POSITION', symbol, qty, price }); 
  }

  executeOrder(side: 'BUY' | 'SELL', symbol: string, qty: number, price: number) { 
    this.actions$.next({ type: 'EXECUTE_ORDER', side, symbol, qty, price }); 
  }

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