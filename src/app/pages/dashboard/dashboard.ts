import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  combineLatest, debounceTime, distinctUntilChanged, map,
  of, shareReplay, startWith, switchMap, timer
} from 'rxjs';
import { catchError } from 'rxjs/operators';

import { MarketStore, SortBy, SortDir } from '../../core/store/market.store';
import { FinnhubService, FinnhubSearchResult } from '../../core/api/finnhub.service';

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

  readonly vm$ = this.store.filteredWatchlistVm$;
  readonly count$ = this.store.watchlistCount$;

  // --- NOUVEAU : GLOBAL MARKETS (Refresh toutes les 30s) ---
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

  // Auto-complete Search
  readonly addSuggestions$ = this.addCtrl.valueChanges.pipe(
    startWith(''),
    debounceTime(300),
    distinctUntilChanged(),
    switchMap((val) => {
      const q = val.trim();
      if (q.length < 1) return of([]);
      return this.finnhub.search(q).pipe(
        map((r) => (r.result ?? []).slice(0, 5)),
        catchError(() => of([]))
      );
    })
  );

  constructor() {
    // Connexion des filtres au Store
    this.queryCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setQuery(v));
    this.minChangeCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setMinChangePct(v));
    this.sortByCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setSort(v, this.sortDirCtrl.value));
    this.sortDirCtrl.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(v => this.store.setSort(this.sortByCtrl.value, v));
  }

  add() {
    const sym = this.addCtrl.value.trim().toUpperCase();
    if (sym) {
      this.store.addSymbol(sym);
      this.addCtrl.setValue('');
    }
  }

  pickSuggestion(sym: string) {
    this.store.addSymbol(sym);
    this.addCtrl.setValue('');
  }

  remove(sym: string) {
    this.store.removeSymbol(sym);
  }
}