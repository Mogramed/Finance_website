import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  combineLatest, debounceTime, distinctUntilChanged, map,
  of, shareReplay, startWith, switchMap, timer, take, tap
} from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MarketStore, SortBy, SortDir } from '../../core/store/market.store';
import { FinnhubService } from '../../core/api/finnhub.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly store = inject(MarketStore);
  private readonly finnhub = inject(FinnhubService);
  private readonly destroyRef = inject(DestroyRef);

  // --- VARIABLES POUR LE GRAPHIQUE NATIF ---
  public topPerformers: any[] = [];
  public maxAbsChange = 1; // Sert à calculer la largeur des barres (échelle)

  // Watchlist avec effet de bord pour mettre à jour le graph
  readonly vm$ = this.store.filteredWatchlistVm$.pipe(
    tap(items => this.updateNativeChart(items))
  );

  readonly count$ = this.store.watchlistCount$;

  // Global Markets
  readonly marketOverview$ = timer(0, 30000).pipe(
    switchMap(() => this.finnhub.getMarketOverview().pipe(catchError(() => of([])))),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  // Form Controls
  readonly queryCtrl = new FormControl('', { nonNullable: true });
  readonly minChangeCtrl = new FormControl<number | null>(null);
  readonly sortByCtrl = new FormControl<SortBy>('addedAt', { nonNullable: true });
  readonly sortDirCtrl = new FormControl<SortDir>('desc', { nonNullable: true });
  readonly addCtrl = new FormControl('', { nonNullable: true });

  readonly addSuggestions$ = this.addCtrl.valueChanges.pipe(
    startWith(''), debounceTime(300), distinctUntilChanged(),
    switchMap((val) => {
      const q = val.trim();
      if (q.length < 2) return of([]);
      return this.finnhub.search(q).pipe(map((r) => r.result ?? []), catchError(() => of([])));
    })
  );

  constructor() {
    this.queryCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setQuery(v));
    this.minChangeCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setMinChangePct(v));
    this.sortByCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setSort(v, this.sortDirCtrl.value));
    this.sortDirCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setSort(this.sortByCtrl.value, v));
  }

  // INDISPENSABLE pour la performance : permet à Angular de ne pas détruire les barres
  trackBySymbol(index: number, item: any): string {
    return item.symbol;
  }

  // Calcul des données pour le graphique CSS
  updateNativeChart(items: any[]) {
    // 1. On trie pour avoir les plus fortes variations en haut
    const sorted = [...items].sort((a, b) => b.changePct - a.changePct);
    
    // 2. On cherche la valeur absolue maximum pour définir l'échelle (100% de la barre)
    const maxVal = Math.max(...sorted.map(i => Math.abs(i.changePct)), 1);
    this.maxAbsChange = maxVal;

    this.topPerformers = sorted;
  }

  add() {
    const sym = this.addCtrl.value.trim().toUpperCase();
    if (!sym) return;
    this.finnhub.quote(sym).pipe(take(1)).subscribe({
      next: (quote) => {
        if (quote && quote.c > 0) { this.store.addSymbol(sym); this.addCtrl.setValue(''); }
        else { alert(`Symbole "${sym}" introuvable.`); }
      },
      error: () => alert(`Symbole inconnu.`)
    });
  }

  pickSuggestion(sym: string) { this.addCtrl.setValue(sym); this.add(); }
  remove(sym: string) { this.store.removeSymbol(sym); }
}