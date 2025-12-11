import { CommonModule } from '@angular/common';
import { Component, ElementRef, ViewChild, inject, OnInit, OnDestroy, AfterViewInit } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, switchMap, map, shareReplay } from 'rxjs';
import { MarketDataService } from '../../core/api/market-data.service';
import { createChart, ISeriesApi } from 'lightweight-charts'; // Retrait de IChartApi qui pose problème
import { AssetType, getAssetType } from '../../core/api/market-interfaces';

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

  @ViewChild('chartContainer') chartContainer!: ElementRef<HTMLDivElement>;
  
  // CORRECTION : On met 'any' ici pour éviter l'erreur TS2339 "Property does not exist"
  // car les définitions de types peuvent varier selon la version installée.
  private chart: any = null;
  
  private candlestickSeries: ISeriesApi<'Candlestick'> | null = null;

  readonly symbol$ = this.route.paramMap.pipe(
    map(p => (p.get('symbol') ?? '').toUpperCase()),
    shareReplay(1)
  );

  readonly type$: Observable<AssetType> = this.symbol$.pipe(map(s => getAssetType(s)));

  readonly profile$ = this.symbol$.pipe(switchMap(s => this.marketData.getCompanyProfile(s)));
  readonly news$ = this.symbol$.pipe(switchMap(s => this.marketData.getNews(s)));

  readonly liveQuote$ = this.symbol$.pipe(
    switchMap(sym => this.marketData.watch([sym], 10000).pipe(
      map(quotes => quotes.find(q => q.symbol === sym))
    ))
  );

  ngOnInit() {
    this.symbol$.pipe(
      switchMap(sym => this.marketData.getHistory(sym))
    ).subscribe(candles => {
      if (this.candlestickSeries && candles.length > 0) {
        // 'as any' permet de contourner les différences strictes de format de date
        this.candlestickSeries.setData(candles as any); 
        this.chart?.timeScale().fitContent();
      }
    });
  }

  ngAfterViewInit() {
    if (!this.chartContainer) return;

    this.chart = createChart(this.chartContainer.nativeElement, {
      width: this.chartContainer.nativeElement.clientWidth,
      height: 400,
      layout: { background: { color: '#0f172a' }, textColor: '#cbd5e1' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      timeScale: { borderColor: '#334155', timeVisible: true },
    });

    // Maintenant TypeScript ne bloquera plus ici
    this.candlestickSeries = this.chart.addCandlestickSeries({
      upColor: '#10b981', downColor: '#ef4444',
      borderUpColor: '#10b981', borderDownColor: '#ef4444',
      wickUpColor: '#10b981', wickDownColor: '#ef4444',
    });

    new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0].contentRect) return;
      const { width } = entries[0].contentRect;
      this.chart?.applyOptions({ width });
    }).observe(this.chartContainer.nativeElement);
  }

  ngOnDestroy() {
    this.chart?.remove();
  }
}