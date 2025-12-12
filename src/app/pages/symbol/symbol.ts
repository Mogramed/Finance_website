import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, OnInit, OnDestroy, AfterViewInit, PLATFORM_ID } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, switchMap, map, shareReplay, combineLatest, BehaviorSubject, of } from 'rxjs';
import { MarketDataService } from '../../core/api/market-data.service';
import { createChart, ISeriesApi, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts'; 
import { AssetType, getAssetType, UniversalQuote, Candle } from '../../core/api/market-interfaces';
import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

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
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  
  private chart: any = null;
  
  // SÉRIES GRAPHIQUES
  private candlestickSeries: ISeriesApi<'Candlestick'> | null = null;
  private volumeSeries: ISeriesApi<'Histogram'> | null = null;
  private smaSeries: ISeriesApi<'Line'> | null = null;
  private emaSeries: ISeriesApi<'Line'> | null = null;
  // Bollinger Bands (3 lignes)
  private bbUpperSeries: ISeriesApi<'Line'> | null = null;
  private bbLowerSeries: ISeriesApi<'Line'> | null = null;

  private lastCandle: Candle | null = null;
  private resizeObserver: ResizeObserver | null = null;

  // ÉTAT DES INDICATEURS
  showVolume = true;
  showSMA = false;
  showEMA = false;
  showBB = false;

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
      if (!isPlatformBrowser(this.platformId)) return of(null);
      return this.marketData.watch([sym], 10000).pipe(
        map(quotes => quotes.find(q => q.symbol === sym))
      );
    })
  );

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      combineLatest([this.symbol$, this.resolution$]).pipe(
        switchMap(([sym, res]) => this.marketData.getHistory(sym, res)),
        takeUntilDestroyed(this.destroyRef)
      ).subscribe(candles => {
        if (this.chart && candles.length > 0) {
          // 1. DATA PRINCIPALE
          this.candlestickSeries?.setData(candles as any);
          this.lastCandle = candles[candles.length - 1]; 

          // 2. VOLUME
          const volumeData = candles.map(c => ({
            time: c.time,
            value: c.volume ?? 0,
            color: c.close >= c.open ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'
          }));
          this.volumeSeries?.setData(volumeData as any);

          // 3. INDICATEURS (Calculs)
          this.updateIndicators(candles);

          this.chart.timeScale().fitContent();
        }
      });

      this.liveQuote$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(quote => {
        if (quote) this.updateChartWithLiveQuote(quote);
      });
    }
  }

  // --- LOGIQUE INDICATEURS ---

  toggleVolume() {
    this.showVolume = !this.showVolume;
    this.volumeSeries?.applyOptions({ visible: this.showVolume });
  }

  toggleSMA() {
    this.showSMA = !this.showSMA;
    this.smaSeries?.applyOptions({ visible: this.showSMA });
  }

  toggleEMA() {
    this.showEMA = !this.showEMA;
    this.emaSeries?.applyOptions({ visible: this.showEMA });
  }

  toggleBB() {
    this.showBB = !this.showBB;
    this.bbUpperSeries?.applyOptions({ visible: this.showBB });
    this.bbLowerSeries?.applyOptions({ visible: this.showBB });
  }

  private updateIndicators(candles: Candle[]) {
    // SMA 20
    if (this.smaSeries) {
      this.smaSeries.setData(this.calculateSMA(candles, 20) as any);
    }
    // EMA 50
    if (this.emaSeries) {
      this.emaSeries.setData(this.calculateEMA(candles, 50) as any);
    }
    // Bollinger Bands (20, 2)
    if (this.bbUpperSeries && this.bbLowerSeries) {
      const { upper, lower } = this.calculateBB(candles, 20, 2);
      this.bbUpperSeries.setData(upper as any);
      this.bbLowerSeries.setData(lower as any);
    }
  }

  // --- MATHS (Moteur de calcul) ---

  private calculateSMA(data: Candle[], period: number) {
    const result = [];
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const sum = slice.reduce((acc, val) => acc + val.close, 0);
      result.push({ time: data[i].time, value: sum / period });
    }
    return result;
  }

  private calculateEMA(data: Candle[], period: number) {
    const k = 2 / (period + 1);
    const result = [];
    let ema = data[0].close; // Initialisation simple
    for (let i = 0; i < data.length; i++) {
      ema = data[i].close * k + ema * (1 - k);
      if (i >= period) { // On commence à afficher après la période de chauffe
        result.push({ time: data[i].time, value: ema });
      }
    }
    return result;
  }

  private calculateBB(data: Candle[], period: number, stdDevMult: number) {
    const upper = [];
    const lower = [];
    
    for (let i = period - 1; i < data.length; i++) {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = slice.reduce((acc, val) => acc + val.close, 0) / period;
      
      const squaredDiffs = slice.map(val => Math.pow(val.close - mean, 2));
      const variance = squaredDiffs.reduce((acc, val) => acc + val, 0) / period;
      const stdDev = Math.sqrt(variance);

      upper.push({ time: data[i].time, value: mean + stdDev * stdDevMult });
      lower.push({ time: data[i].time, value: mean - stdDev * stdDevMult });
    }
    return { upper, lower };
  }

  // --- LIVE UPDATE ---

  private updateChartWithLiveQuote(quote: UniversalQuote) {
    if (!this.chart || !this.candlestickSeries || !this.lastCandle) return;

    const price = quote.price;
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
    if (!isPlatformBrowser(this.platformId) || !this.chartContainer) return;

    this.chart = createChart(this.chartContainer.nativeElement, {
      width: this.chartContainer.nativeElement.clientWidth,
      height: 450,
      layout: { background: { color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: 'rgba(30, 41, 59, 0.5)' }, horzLines: { color: 'rgba(30, 41, 59, 0.5)' } },
      timeScale: { borderColor: '#334155', timeVisible: true },
      crosshair: { mode: 1 },
    });

    // 1. VOLUME
    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '', 
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    // 2. BOUGIES
    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    // 3. INDICATEURS
    // SMA (Jaune)
    this.smaSeries = this.chart.addSeries(LineSeries, { color: '#fbbf24', lineWidth: 2, visible: this.showSMA, title: 'SMA 20' });
    // EMA (Bleu)
    this.emaSeries = this.chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2, visible: this.showEMA, title: 'EMA 50' });
    // Bollinger (Violet)
    this.bbUpperSeries = this.chart.addSeries(LineSeries, { color: 'rgba(167, 139, 250, 0.5)', lineWidth: 1, visible: this.showBB });
    this.bbLowerSeries = this.chart.addSeries(LineSeries, { color: 'rgba(167, 139, 250, 0.5)', lineWidth: 1, visible: this.showBB });

    this.resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      this.chart?.applyOptions({ width: entries[0].contentRect.width });
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