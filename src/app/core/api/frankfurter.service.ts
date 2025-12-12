import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, shareReplay } from 'rxjs/operators';
import { UniversalQuote } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class FrankfurterService {
  private http = inject(HttpClient);
  private readonly baseUrl = 'https://api.frankfurter.app';

  private currenciesCache$: Observable<any> | null = null;

  // --- RECHERCHE ---
  search(query: string): Observable<{ symbol: string; description: string }[]> {
    if (!this.currenciesCache$) {
      this.currenciesCache$ = this.http.get<any>(`${this.baseUrl}/currencies`).pipe(shareReplay(1));
    }

    const q = query.toUpperCase();
    
    return this.currenciesCache$.pipe(
      map(currencies => {
        // Frankfurter donne une liste de devises (USD, EUR, GBP...)
        // On va essayer de deviner la paire que l'utilisateur cherche
        const results: { symbol: string; description: string }[] = [];
        const codes = Object.keys(currencies);

        // Si l'utilisateur tape "EUR", on propose "EURUSD", "EURGBP", etc.
        if (q.length === 3 && codes.includes(q)) {
          // Top paires avec cette devise
          ['USD', 'EUR', 'GBP', 'JPY'].forEach(target => {
            if (target !== q) {
              results.push({ symbol: `${q}${target}`, description: `${currencies[q]} / ${currencies[target]}` });
            }
          });
        } 
        // Si l'utilisateur tape déjà une paire "EURUSD"
        else if (q.length === 6) {
           const base = q.substring(0, 3);
           const target = q.substring(3, 6);
           if (codes.includes(base) && codes.includes(target)) {
             results.push({ symbol: q, description: `${currencies[base]} / ${currencies[target]}` });
           }
        }
        // Recherche générique dans les noms
        else {
           codes.filter(c => c.includes(q) || currencies[c].toUpperCase().includes(q))
                .slice(0, 5)
                .forEach(c => {
                   results.push({ symbol: `${c}USD`, description: `${currencies[c]} / US Dollar` });
                });
        }

        return results;
      }),
      catchError(() => of([]))
    );
  }

  // ... (Garde getRate inchangé) ...
  getRate(base: string, target: string): Observable<UniversalQuote | null> {
    return this.http.get<any>(`${this.baseUrl}/latest`, {
      params: { from: base.toUpperCase(), to: target.toUpperCase() }
    }).pipe(
      map(res => {
        if (!res || !res.rates || !res.rates[target.toUpperCase()]) return null;
        return {
          symbol: `${base}/${target}`.toUpperCase(),
          price: res.rates[target.toUpperCase()],
          changePct: 0,
          ts: new Date(res.date).getTime(),
          source: 'FRANKFURTER',
          type: 'FOREX'
        } as UniversalQuote;
      }),
      catchError(() => of(null))
    );
  }
}