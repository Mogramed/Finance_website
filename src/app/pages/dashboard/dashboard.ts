import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  timer,
  catchError,
  take,
} from 'rxjs';

import { FinnhubService, FinnhubSearchResult } from '../../core/api/finnhub.service';
import { MarketStore, SortBy, SortDir, WatchlistVm } from '../../core/store/market.store';

type UiRow = WatchlistVm & {
  priceDisplay: string;
  chgDisplay: string;
  updatedLabel: string;
  isUp: boolean;
  isDown: boolean;
  isStale: boolean;
};

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function formatAgo(msAgo: number): string {
  if (!isFiniteNumber(msAgo) || msAgo < 0) return '—';
  if (msAgo < 1000) return 'now';
  const s = Math.floor(msAgo / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly store = inject(MarketStore);
  private readonly finnhub = inject(FinnhubService);
  private readonly destroyRef = inject(DestroyRef);

  // Exposé au template (debug)
  readonly debug$ = this.store.snapshot$;
  readonly filters$ = this.store.filters$;

  // Controls
  readonly searchCtrl = new FormControl<string>('', { nonNullable: true });
  readonly minChangeCtrl = new FormControl<number | null>(null);
  readonly sortByCtrl = new FormControl<SortBy>('addedAt', { nonNullable: true });
  readonly sortDirCtrl = new FormControl<SortDir>('desc', { nonNullable: true });

  readonly addCtrl = new FormControl<string>('', { nonNullable: true });
  private readonly picked$ = new BehaviorSubject<string | null>(null);

  // Store streams
  private readonly vm$ = this.store.filteredWatchlistVm$.pipe(
    catchError((err) => {
      console.error('[Dashboard] filteredWatchlistVm$ error', err);
      return of<WatchlistVm[]>([]);
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly watchlistCount$ = this.store.watchlist$.pipe(
    map((w) => w.length),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  readonly refreshLabel$ = combineLatest([
    this.store.settings$.pipe(map((s) => s.refreshMs), distinctUntilChanged()),
    this.store.effectiveRefreshMs$.pipe(distinctUntilChanged()),
    this.store.hasToken$,
  ]).pipe(
    map(([desired, effective, hasToken]) =>
      hasToken ? `${effective} ms (demandé: ${desired} ms)` : `${desired} ms (mock)`
    ),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  
  private readonly now$ = timer(0, 1000).pipe(shareReplay({ bufferSize: 1, refCount: false }));

  readonly rows$ = combineLatest([this.vm$, this.now$]).pipe(
  map(([rows]) => {
    const now = Date.now();
    return rows.map((r) => {
      const hasPrice = isFiniteNumber(r.price);
      const hasChg = isFiniteNumber(r.changePct);
      const STALE_MS = 15 * 60_000; // 15 minutes
      const priceDisplay = hasPrice ? r.price.toFixed(2) : '—';
      const chgVal = hasChg ? r.changePct : 0;
      const chgDisplay = hasChg ? `${chgVal >= 0 ? '+' : ''}${chgVal.toFixed(2)}%` : '—';

      const ts = isFiniteNumber(r.ts) ? r.ts : now;
      const age = now - ts;

      const isStale = age > STALE_MS;
      let updatedLabel = formatAgo(age);
      if (isStale) {
        updatedLabel += ' • marché probablement fermé';
      }

      return {
        ...r,
        priceDisplay,
        chgDisplay,
        updatedLabel,
        isUp: hasChg && chgVal > 0,
        isDown: hasChg && chgVal < 0,
        isStale,
      } satisfies UiRow;
    });
  }),
  shareReplay({ bufferSize: 1, refCount: false })
);

  

  // Typeahead Finnhub
  readonly suggestions$ = combineLatest([
    this.addCtrl.valueChanges.pipe(startWith(this.addCtrl.value), debounceTime(200), distinctUntilChanged()),
    this.store.apiToken$,
  ]).pipe(
    switchMap(([q, token]) => {
      const qq = (q ?? '').trim();
      if (!qq || qq.length < 1) return of<FinnhubSearchResult[]>([]);
      if (!token) return of<FinnhubSearchResult[]>([]);
      return this.finnhub.search(qq, token).pipe(
        map((r) => (r.result ?? []).slice(0, 8)),
        catchError(() => of<FinnhubSearchResult[]>([]))
      );
    }),
    shareReplay({ bufferSize: 1, refCount: false })
  );

  constructor() {
    // ✅ IMPORTANT : on synchronise les controls avec les filtres réels du store (persistés)
    this.store.filters$
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe((f) => {
        this.searchCtrl.setValue(f.query ?? '', { emitEvent: false });
        this.minChangeCtrl.setValue(f.minChangePct ?? null, { emitEvent: false });
        this.sortByCtrl.setValue(f.sortBy, { emitEvent: false });
        this.sortDirCtrl.setValue(f.sortDir, { emitEvent: false });
      });

    // push filtres -> store
    this.searchCtrl.valueChanges
      .pipe(
        startWith(this.searchCtrl.value),
        debounceTime(250),
        map((v) => v ?? ''),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((q) => this.store.setQuery(q));

    this.minChangeCtrl.valueChanges
      .pipe(
        startWith(this.minChangeCtrl.value),
        debounceTime(150),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((v) => this.store.setMinChangePct(v));

    combineLatest([
      this.sortByCtrl.valueChanges.pipe(startWith(this.sortByCtrl.value), distinctUntilChanged()),
      this.sortDirCtrl.valueChanges.pipe(startWith(this.sortDirCtrl.value), distinctUntilChanged()),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([by, dir]) => this.store.setSort(by, dir));
  }

  pickSuggestion(s: FinnhubSearchResult) {
    this.addCtrl.setValue(s.symbol.toUpperCase());
    this.picked$.next(s.symbol.toUpperCase());
  }

  addSymbol() {
    const raw = this.picked$.value ?? this.addCtrl.value;
    const symbol = (raw ?? '').trim().toUpperCase();
    if (!symbol) return;
    this.store.addSymbol(symbol);
    this.addCtrl.setValue('');
    this.picked$.next(null);
  }

  remove(symbol: string) {
    this.store.removeSymbol(symbol);
  }

  resetAll() {
    this.store.reset();
    // on remet aussi les inputs en cohérence
    this.searchCtrl.setValue('', { emitEvent: true });
    this.minChangeCtrl.setValue(null, { emitEvent: true });
    this.sortByCtrl.setValue('addedAt', { emitEvent: true });
    this.sortDirCtrl.setValue('desc', { emitEvent: true });
    this.addCtrl.setValue('', { emitEvent: false });
    this.picked$.next(null);
  }

  
}
