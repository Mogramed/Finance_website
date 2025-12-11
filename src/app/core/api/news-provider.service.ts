import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class NewsProviderService {
  private http = inject(HttpClient);
  // Ta clé API
  private readonly apiKey = environment.apiKeys.newsApi; 
  private readonly baseUrl = 'https://newsapi.org/v2';

  // Dictionnaire de mapping pour améliorer la pertinence
  private readonly keywordMap: Record<string, string> = {
    'AAPL': 'Apple stock finance',
    'TSLA': 'Tesla stock',
    'MSFT': 'Microsoft stock',
    'BTCUSDT': 'Bitcoin crypto',
    'ETHUSDT': 'Ethereum crypto',
    'EURUSD': 'Euro Dollar forex',
    'GBPUSD': 'Pound Dollar forex',
    'USDJPY': 'USD JPY forex'
  };

  getNews(query: string): Observable<any[]> {
    let q = query.toUpperCase();

    // 1. Stratégie intelligente de mots-clés
    if (this.keywordMap[q]) {
      q = this.keywordMap[q];
    } else {
      // Stratégie générique si pas dans le dictionnaire
      if (q.includes('USDT') || q.includes('BUSD')) {
        q = q.replace('USDT', '').replace('BUSD', '') + ' crypto';
      } else if (q.length === 6 && !q.includes(' ')) {
        // Forex probable (ex: AUDCAD) -> "AUD CAD forex"
        q = `${q.substring(0, 3)} ${q.substring(3, 6)} forex`;
      } else {
        // Actions par défaut
        q = `${q} stock finance`;
      }
    }
    
    return this.http.get<any>(`${this.baseUrl}/everything`, {
      params: {
        q: q,
        language: 'en', // 'en' donne souvent plus de résultats financiers précis que 'fr'
        sortBy: 'publishedAt',
        apiKey: this.apiKey
      }
    }).pipe(
      map(res => {
        if (!res.articles) return [];
        // On filtre les articles sans image ou supprimés pour garder la qualité
        return res.articles
          .filter((a: any) => a.title !== '[Removed]' && a.urlToImage)
          .slice(0, 8)
          .map((a: any) => ({
            title: a.title,
            source: a.source.name,
            url: a.url,
            publishedDate: a.publishedAt,
            summary: a.description,
            image: a.urlToImage // On récupère l'image si dispo
          }));
      }),
      catchError(err => {
        console.warn('NewsAPI Error:', err);
        return of([]);
      })
    );
  }
}