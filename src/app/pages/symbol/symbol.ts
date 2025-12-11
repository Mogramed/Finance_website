import { CommonModule } from '@angular/common';
import { Component, DestroyRef, ViewChild, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NgApexchartsModule, ChartComponent, ApexOptions } from "ng-apexcharts"; 
import {
  combineLatest, debounceTime, distinctUntilChanged, map,
  of, timer, shareReplay, startWith, switchMap, exhaustMap,
  withLatestFrom, filter
} from 'rxjs';
import { catchError, retry } from 'rxjs/operators';

import { MarketStore } from '../../core/store/market.store';
import { FinnhubService } from '../../core/api/finnhub.service';

type Resolution = '5' | '15' | '30' | '60' | 'D';

function yyyyMmDd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

@Component({
  selector: 'app-symbol',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, NgApexchartsModule],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol {
  private readonly route = inject(ActivatedRoute);
  private readonly store = inject(MarketStore);
  private readonly finnhub = inject(FinnhubService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild("chart") chart!: ChartComponent;

 public chartOptions: Partial<ApexOptions> = {
    series: [],
    chart: {
      type: "candlestick",
      height: 400, // Un peu plus grand
      background: 'transparent',
      fontFamily: 'Inter, sans-serif',
      toolbar: { show: false }, // Plus épuré sans la toolbar par défaut
      animations: { enabled: false } // Plus performant pour la finance
    },
    // Couleurs "Binance style"
    plotOptions: {
      candlestick: {
        colors: {
          upward: '#10b981',   // Vert Néon
          downward: '#ef4444'  // Rouge Vif
        }
      }
    },
    title: { text: "", align: "left" },
    xaxis: { 
      type: "datetime",
      labels: { style: { colors: '#e2e8f0' } }, // Texte gris clair
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { 
      tooltip: { enabled: true },
      labels: { 
        style: { colors: '#94a3b8', fontFamily: 'JetBrains Mono' },
        formatter: (val) => val.toFixed(2) // Format propre
      }
    },
    grid: {
      borderColor: 'rgba(148, 163, 184, 0.1)', // Grille très subtile
      strokeDashArray: 4
    },
    theme: { mode: 'dark' }
  };

  // Controls
  readonly resolutionCtrl = new FormControl<Resolution>('D', { nonNullable: true });
  readonly daysCtrl = new FormControl<number>(90, { nonNullable: true });

  // Flux de base (Symbole courant)
  readonly symbol$ = this.route.paramMap.pipe(
    map((p) => (p.get('symbol') ?? '').trim().toUpperCase()),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly token$ = this.store.apiToken$;
  readonly hasToken$ = this.store.hasToken$;

  constructor() {
    this.symbol$.pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sym) => this.store.selectSymbol(sym));
  }

  // Watchlist Logic
  readonly inWatchlist$ = combineLatest([this.symbol$, this.store.watchlist$]).pipe(
    map(([sym, wl]) => wl.some((x) => x.symbol === sym)),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  addToWatchlist(sym: string) { this.store.addSymbol(sym); }
  removeFromWatchlist(sym: string) { this.store.removeSymbol(sym); }
  
  isFiniteNumber(x: unknown): x is number { 
    return typeof x === 'number' && Number.isFinite(x); 
  }

  // API Call: Profile
  readonly profile$ = combineLatest([this.symbol$, this.token$]).pipe(
    switchMap(([sym, token]) => sym ? this.finnhub.profile2(sym, token || undefined).pipe(catchError(() => of(null))) : of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // API Call: Key Metrics (Fondamentaux) - NOUVEAU
  readonly metrics$ = this.symbol$.pipe(
    switchMap(sym => sym ? this.finnhub.metrics(sym).pipe(catchError(() => of(null))) : of(null)),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // API Call: Quote Live
  readonly quote$ = this.store.liveTick$.pipe(
    withLatestFrom(this.symbol$, this.token$),
    filter(([, sym]) => !!sym),
    exhaustMap(([, sym, token]) => this.finnhub.quote(sym, token || undefined).pipe(catchError(() => of(null)))),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // API Call: News
  readonly news$ = combineLatest([this.symbol$, this.token$]).pipe(
    switchMap(([sym, token]) => {
      if (!sym) return of([]);
      const to = new Date();
      const from = new Date(Date.now() - 7 * 24 * 3600 * 1000); 
      return this.finnhub.companyNews(sym, yyyyMmDd(from), yyyyMmDd(to), token || undefined).pipe(
        map(items => (items ?? []).slice(0, 10)),
        catchError(() => of([]))
      );
    })
  );

  // API Call: Chart Data (Transformation pour ApexCharts)
  readonly chartSeries$ = combineLatest([
    this.symbol$, 
    this.resolutionCtrl.valueChanges.pipe(startWith('D')),
    this.daysCtrl.valueChanges.pipe(startWith(90)),
    this.token$
  ]).pipe(
    switchMap(([sym, res, days, token]) => {
      if (!sym) return of([]);
      
      const safeDays = res === 'D' ? days : Math.min(days, 60);
      const to = Math.floor(Date.now() / 1000);
      const from = to - (safeDays * 24 * 3600);

      return this.finnhub.candles(sym, res, from, to, token || undefined).pipe(
        map(data => {
          if (data.s !== 'ok' || !data.t) return [];
          
          const seriesData = data.t.map((timestamp, i) => ({
            x: new Date(timestamp * 1000),
            y: [data.o[i], data.h[i], data.l[i], data.c[i]]
          }));

          return [{
            name: sym,
            data: seriesData
          }];
        }),
        catchError(() => of([]))
      );
    })
  );
}