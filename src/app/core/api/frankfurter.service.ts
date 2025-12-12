import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { UniversalQuote } from './market-interfaces';

@Injectable({ providedIn: 'root' })
export class FrankfurterService {
  private http = inject(HttpClient);
  private readonly baseUrl = 'https://api.frankfurter.app';

  /**
   * Récupère le taux de change.
   * Ex: from=EUR, to=USD
   */
  getRate(base: string, target: string): Observable<UniversalQuote | null> {
    // Frankfurter utilise 'latest'
    return this.http.get<any>(`${this.baseUrl}/latest`, {
      params: { from: base.toUpperCase(), to: target.toUpperCase() }
    }).pipe(
      map(res => {
        if (!res || !res.rates || !res.rates[target.toUpperCase()]) return null;
        return {
          symbol: `${base}/${target}`.toUpperCase(), // On normalise le format d'affichage
          price: res.rates[target.toUpperCase()],
          changePct: 0, // Frankfurter ne donne pas la variation temps réel
          ts: new Date(res.date).getTime(),
          source: 'FRANKFURTER',
          type: 'FOREX'
        } as UniversalQuote;
      }),
      catchError(() => of(null))
    );
  }
}