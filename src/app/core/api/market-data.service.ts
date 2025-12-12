// ... Imports habituels
import { Injectable, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Observable, merge, of, timer, forkJoin } from 'rxjs';
import { switchMap, scan, shareReplay, catchError, map } from 'rxjs/operators';
import { BinanceService } from './binance.service';
import { AlphaVantageService } from './alpha-vantage.service';
import { FrankfurterService } from './frankfurter.service';
import { NewsProviderService } from './news-provider.service';
import { UniversalQuote, Candle, getAssetType, CompanyProfile, AssetType } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class MarketDataService {
  private binance = inject(BinanceService);
  private alpha = inject(AlphaVantageService);
  private forex = inject(FrankfurterService);
  private news = inject(NewsProviderService);
  private platformId = inject(PLATFORM_ID);

  // --- RECHERCHE INTELLIGENTE ---
  search(query: string, type: AssetType): Observable<{ symbol: string; description: string }[]> {
    // Routage selon le type d'actif choisi
    if (type === 'CRYPTO') {
      return this.binance.search(query);
    } 
    else if (type === 'FOREX') {
      return this.forex.search(query);
    } 
    else {
      // STOCK par défaut
      return this.alpha.search(query);
    }
  }

  // ... (Tout le reste du fichier reste inchangé : watch, getHistory, etc.) ...
  watch(symbols: string[], refreshMs = 60000): Observable<UniversalQuote[]> {
    if (symbols.length === 0) return of([]);
    if (!isPlatformBrowser(this.platformId)) return of([]);

    const crypto = symbols.filter(s => getAssetType(s) === 'CRYPTO');
    const stocks = symbols.filter(s => getAssetType(s) === 'STOCK');
    const currencies = symbols.filter(s => getAssetType(s) === 'FOREX');

    const streams: Observable<UniversalQuote | UniversalQuote[]>[] = [];

    // CRYPTO (Binance)
    if (crypto.length > 0) streams.push(this.binance.connect(crypto));

    // STOCKS (Alpha)
    if (stocks.length > 0) {
      const stockStream$ = timer(0, Math.max(refreshMs, 60000)).pipe(
        switchMap(() => {
          const safeStocks = stocks.slice(0, 5);
          const requests = safeStocks.map(s => this.alpha.getQuote(s));
          return forkJoin(requests).pipe(
            map(results => results.filter((r): r is UniversalQuote => !!r)),
            catchError(() => of([]))
          );
        })
      );
      streams.push(stockStream$);
    }

    // FOREX (Frankfurter)
    if (currencies.length > 0) {
      const forexStream$ = timer(0, refreshMs).pipe(
        switchMap(() => {
          const requests = currencies.map(c => {
            const clean = c.replace('/', '').replace('-', '');
            const base = clean.substring(0, 3);
            const target = clean.substring(3, 6);
            if (base && target) return this.forex.getRate(base, target);
            return of(null);
          });
          return forkJoin(requests).pipe(
            map(results => results.filter((r): r is UniversalQuote => !!r)),
            catchError(() => of([]))
          );
        })
      );
      streams.push(forexStream$);
    }

    return merge(...streams).pipe(
      scan((acc, val) => {
        const map = new Map(acc.map(q => [q.symbol, q]));
        const update = (q: UniversalQuote) => { if (q && q.price > 0) map.set(q.symbol, q); };
        if (Array.isArray(val)) val.forEach(update); else update(val);
        return Array.from(map.values());
      }, [] as UniversalQuote[]),
      shareReplay({ bufferSize: 1, refCount: true })
    );
  }

  getHistory(symbol: string, interval: string = '1h'): Observable<Candle[]> {
    const type = getAssetType(symbol);
    if (type === 'CRYPTO') return this.binance.getKlines(symbol, interval);
    return this.alpha.getHistory(symbol);
  }

  getNews(symbol: string): Observable<any[]> {
    return this.news.getNews(symbol);
  }

  getCompanyProfile(symbol: string): Observable<CompanyProfile | null> {
    return of({
      name: symbol,
      description: "Données fondamentales fournies via Alpha Vantage (Mode Standard).",
      exchange: "Global",
      sector: getAssetType(symbol)
    });
  }
}