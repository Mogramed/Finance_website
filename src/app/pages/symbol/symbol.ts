import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  exhaustMap,
  filter,
  map,
  of,
  shareReplay,
  startWith,
  switchMap,
  timer,
  withLatestFrom,
} from 'rxjs';
import { catchError, retry } from 'rxjs/operators';

import { MarketStore } from '../../core/store/market.store';
import { FinnhubService, FinnhubCompanyNewsItem, FinnhubCompanyProfile2 } from '../../core/api/finnhub.service';

type Resolution = '5' | '15' | '30' | '60' | 'D';

function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function toUnixSec(d: Date): number {
  return Math.floor(d.getTime() / 1000);
}
function sparklinePoints(values: number[], w = 640, h = 160, pad = 10): { points: string; min: number; max: number } {
  const nums = values.filter((x) => Number.isFinite(x));
  if (nums.length < 2) return { points: '', min: 0, max: 0 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = Math.max(1e-9, max - min);

  const innerW = w - pad * 2;
  const innerH = h - pad * 2;
  const step = innerW / (nums.length - 1);

  const pts = nums.map((v, i) => {
    const x = pad + i * step;
    const y = pad + (1 - (v - min) / span) * innerH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return { points: pts.join(' '), min, max };
}

@Component({
  selector: 'app-symbol',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(MarketStore);
  private readonly finnhub = inject(FinnhubService);
  private readonly destroyRef = inject(DestroyRef);

  readonly resolutionCtrl = new FormControl<Resolution>('60', { nonNullable: true });
  readonly daysCtrl = new FormControl<number>(30, { nonNullable: true });

  readonly symbol$ = this.route.paramMap.pipe(
    map((p) => (p.get('symbol') ?? '').trim().toUpperCase()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly token$ = this.store.apiToken$;
  readonly hasToken$ = this.store.hasToken$;

  constructor() {
    this.symbol$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((sym) => this.store.selectSymbol(sym));
  }

  isFiniteNumber(x: unknown): x is number {
    return typeof x === 'number' && Number.isFinite(x);
  }

  readonly inWatchlist$ = combineLatest([this.symbol$, this.store.watchlist$]).pipe(
    map(([sym, wl]) => wl.some((x) => x.symbol === sym)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  addToWatchlist(sym: string) { this.store.addSymbol(sym); }
  removeFromWatchlist(sym: string) { this.store.removeSymbol(sym); }

  /** ✅ Quote live stable : tick -> exhaustMap */
  readonly quote$ = this.store.liveTick$.pipe(
    withLatestFrom(this.symbol$, this.token$),
    filter(([, sym, token]) => !!sym && !!token),
    exhaustMap(([, sym, token]) =>
      this.finnhub.quote(sym, token!).pipe(
        retry({ count: 2, delay: (_e, i) => timer(250 * i) }),
        catchError(() => of(null))
      )
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly profile$ = combineLatest([this.symbol$, this.token$]).pipe(
    switchMap(([sym, token]) => {
      if (!token || !sym) return of(null as FinnhubCompanyProfile2 | null);
      return this.finnhub.profile2(sym, token).pipe(catchError(() => of(null)));
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly resolution$ = this.resolutionCtrl.valueChanges.pipe(
    startWith(this.resolutionCtrl.value),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly days$ = this.daysCtrl.valueChanges.pipe(
    startWith(this.daysCtrl.value),
    debounceTime(150),
    map((d) => Math.max(3, Math.min(365, Number(d || 30)))),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  /** Candles (avec clamp intraday) */
 /** Candles (plus robuste + fallback daily) */
readonly candles$ = combineLatest([
  this.symbol$,
  this.token$,
  this.resolution$,
  this.days$,
]).pipe(
  switchMap(([sym, token, res, days]) => {
    if (!token || !sym) {
      return of(null);
    }

    // Clamp des jours
    const clampedDays = Math.max(3, Math.min(365, Number(days || 30)));

    // On évite de demander jusqu'à "maintenant" pile (certains free plans n'ont pas le très temps réel)
    const nowMs = Date.now();
    const endSec = toUnixSec(new Date(nowMs - 60 * 60 * 1000)); // maintenant - 1h
    const startSec = endSec - clampedDays * 24 * 3600;

    const wantIntraday = res !== 'D';
    const intradayRes = wantIntraday ? res : 'D';

    const base$ = this.finnhub
      .candles(sym, intradayRes, startSec, endSec, token)
      .pipe(
        // Si l'intraday n'a pas de data → on retente en daily
        switchMap((c) => {
          if (c && c.s === 'ok') {
            return of(c);
          }

          // Fallback daily
          return this.finnhub.candles(sym, 'D', startSec, endSec, token);
        }),
        catchError((err) => {
          console.error('❌ candles error', err);
          return of(null);
        })
      );

    return base$;
  }),
  shareReplay({ bufferSize: 1, refCount: true })
);

  readonly chartVm$ = this.candles$.pipe(
  map((c) => {
    const values = c?.s === 'ok' ? (c.c ?? []) : [];
    const { points, min, max } = sparklinePoints(values);
    return { points, min, max, n: values.length };
  }),
  shareReplay({ bufferSize: 1, refCount: true })
);


  readonly news$ = combineLatest([this.symbol$, this.token$, this.days$]).pipe(
    switchMap(([sym, token, days]) => {
      if (!token || !sym) return of([] as FinnhubCompanyNewsItem[]);
      const to = new Date();
      const from = new Date(Date.now() - days * 24 * 3600 * 1000);
      return this.finnhub.companyNews(sym, yyyyMmDd(from), yyyyMmDd(to), token).pipe(
        map((items) => (items ?? []).slice(0, 12)),
        catchError(() => of([] as FinnhubCompanyNewsItem[]))
      );
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
