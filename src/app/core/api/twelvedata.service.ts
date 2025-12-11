import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class TwelveDataService {
  private http = inject(HttpClient);
  // Ta clé API
  private readonly apiKey = '9b8c75d1856e45ecbf6b574f6e0bd9c0';
  private readonly baseUrl = 'https://api.twelvedata.com';

  /** Récupère les prix pour une liste de symboles */
  getQuotes(symbols: string[]): Observable<UniversalQuote[]> {
    if (!symbols.length) return of([]);
    const symString = symbols.join(',');

    return this.http.get<any>(`${this.baseUrl}/quote`, {
      params: { symbol: symString, apikey: this.apiKey }
    }).pipe(
      map(res => {
        let rawItems: any[] = [];
        if (res.symbol) rawItems = [res];
        else if (typeof res === 'object') rawItems = Object.values(res).filter((x: any) => x.symbol);

        return rawItems.map(item => ({
          symbol: item.symbol,
          price: parseFloat(item.close),
          changePct: parseFloat(item.percent_change),
          ts: Date.now(), 
          source: 'TWELVE_DATA',
          type: item.symbol.includes('/') ? 'FOREX' : 'STOCK'
        } as UniversalQuote))
        .filter(q => q.price > 0 && !isNaN(q.price)); 
      }),
      catchError(err => {
        console.warn('TwelveData Error:', err);
        return of([]);
      })
    );
  }

  /** Recherche de symboles (Autocomplete) */
  search(query: string): Observable<{ symbol: string; description: string }[]> {
    if (!query || query.length < 2) return of([]);

    return this.http.get<any>(`${this.baseUrl}/symbol_search`, {
      params: { symbol: query, outputsize: '10' } // Pas besoin d'API key pour la recherche simple parfois, sinon ajoute-la
    }).pipe(
      map(res => {
        if (!res.data) return [];
        return res.data.map((item: any) => ({
          symbol: item.symbol,
          description: item.instrument_name
        }));
      }),
      catchError(() => of([]))
    );
  }
}