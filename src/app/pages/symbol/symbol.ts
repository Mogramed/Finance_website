import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, OnInit, OnDestroy, AfterViewInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, switchMap, map, shareReplay, combineLatest, BehaviorSubject, of } from 'rxjs';
import { MarketDataService } from '../../core/api/market-data.service';
import { createChart, ISeriesApi, CandlestickSeries } from 'lightweight-charts'; 
import { AssetType, getAssetType, UniversalQuote, Candle } from '../../core/api/market-interfaces';
import { DestroyRef } from '@angular/core'; // <-- Import nécessaire
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'; // <-- Import nécessaire

@Component({
  selector: 'app-symbol',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol implements OnInit, OnDestroy, AfterViewInit {
  private readonly route = inject(ActivatedRoute);
  private readonly marketData = inject(MarketDataService);
  private readonly platformId = inject(PLATFORM_ID); // <-- Pour savoir si on est sur le serveur ou navigateur
  private readonly destroyRef = inject(DestroyRef);
  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  
  private chart: any = null;
  private candlestickSeries: ISeriesApi<'Candlestick'> | null = null;
  private lastCandle: Candle | null = null;
  private resizeObserver: ResizeObserver | null = null;

  readonly resolution$ = new BehaviorSubject<string>('1h');
  
  readonly resolutions = [
    { label: '1m', val: '1m' },
    { label: '15m', val: '15m' },
    { label: '1H', val: '1h' },
    { label: '4H', val: '4h' },
    { label: '1J', val: '1d' },
  ];

  readonly symbol$ = this.route.paramMap.pipe(
    map(p => (p.get('symbol') ?? '').toUpperCase()),
    shareReplay(1)
  );

  readonly type$: Observable<AssetType> = this.symbol$.pipe(map(s => getAssetType(s)));
  readonly profile$ = this.symbol$.pipe(switchMap(s => this.marketData.getCompanyProfile(s)));
  readonly news$ = this.symbol$.pipe(switchMap(s => this.marketData.getNews(s)));

  readonly liveQuote$ = this.symbol$.pipe(
    switchMap(sym => {
      // Pas de live quote côté serveur pour éviter les fuites de mémoire
      if (!isPlatformBrowser(this.platformId)) return of(null);
      return this.marketData.watch([sym], 10000).pipe(
        map(quotes => quotes.find(q => q.symbol === sym))
      );
    })
  );

  ngOnInit() {
    // On ne charge l'historique que côté navigateur pour l'instant pour éviter les erreurs SSR
    if (isPlatformBrowser(this.platformId)) {
      combineLatest([this.symbol$, this.resolution$]).pipe(
        switchMap(([sym, res]) => this.marketData.getHistory(sym, res)),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(candles => {
        if (this.candlestickSeries && candles.length > 0) {
          this.candlestickSeries.setData(candles as any);
          this.lastCandle = candles[candles.length - 1]; 
          this.chart?.timeScale().fitContent();
        }
      });

      // 2. Live Update (C'est ici que ça plantait)
      this.liveQuote$.pipe(
        takeUntilDestroyed(this.destroyRef) // <-- CRITIQUE : Coupe le robinet avant de détruire le chart
      ).subscribe(quote => {
        if (quote) this.updateChartWithLiveQuote(quote);
      });
    }
  }

// 3. Sécurité supplémentaire dans la méthode d'update
  private updateChartWithLiveQuote(quote: UniversalQuote) {
    // On vérifie que 'chart' existe encore. Si 'chart' est null (détruit), on arrête tout.
    if (!this.chart || !this.candlestickSeries || !this.lastCandle) return;
    const price = quote.price;
    // On met à jour visuellement la dernière bougie
    const updatedCandle = {
      ...this.lastCandle,
      close: price,
      high: Math.max(this.lastCandle.high, price),
      low: Math.min(this.lastCandle.low, price)
    };

    this.candlestickSeries.update(updatedCandle as any);
    this.lastCandle = updatedCandle;
  }

  setResolution(res: string) {
    this.resolution$.next(res);
  }

  ngAfterViewInit() {
    // --- PROTECTION SSR CRITIQUE ---
    // Si on est sur le serveur, on arrête tout de suite.
    // 'document' n'existe pas ici.
    if (!isPlatformBrowser(this.platformId)) return; 

    if (!this.chartContainer) return;

    this.chart = createChart(this.chartContainer.nativeElement, {
      width: this.chartContainer.nativeElement.clientWidth,
      height: 400,
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(30, 41, 59, 0.5)' }, horzLines: { color: 'rgba(30, 41, 59, 0.5)' } },
      timeScale: { borderColor: '#334155', timeVisible: true },
      crosshair: { mode: 1 },
    });

    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    this.resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width } = entries[0].contentRect;
      this.chart?.applyOptions({ width });
    });
    
    this.resizeObserver.observe(this.chartContainer.nativeElement);
  }

  ngOnDestroy() {
    if (isPlatformBrowser(this.platformId)) {
      this.chart?.remove();
      this.resizeObserver?.disconnect();
    }
  }
}