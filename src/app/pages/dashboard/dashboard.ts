import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  debounceTime,
  distinctUntilChanged,
  map,
  startWith,
  switchMap,
} from 'rxjs';
import { MarketStore, FilterType } from '../../core/store/market.store';
import { TwelveDataService } from '../../core/api/twelvedata.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  readonly store = inject(MarketStore);
  private readonly twelveData = inject(TwelveDataService);
  private readonly destroyRef = inject(DestroyRef);

  // Données principales
  readonly vm$ = this.store.filteredWatchlistVm$;
  readonly count$ = this.store.watchlistCount$;
  readonly activeTab$ = this.store.filters$.pipe(map(f => f.assetType));
  
  // Données Stats
  readonly stats$ = this.store.stats$;

  // Form Controls
  readonly queryCtrl = new FormControl('', { nonNullable: true });
  readonly minChangeCtrl = new FormControl<number | null>(null);
  readonly sortByCtrl = new FormControl('addedAt', { nonNullable: true });
  readonly sortDirCtrl = new FormControl('desc', { nonNullable: true });
  readonly addCtrl = new FormControl('', { nonNullable: true });

  readonly addSuggestions$ = this.addCtrl.valueChanges.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap((val) => this.twelveData.search(val))
  );

  constructor() {
    this.queryCtrl.valueChanges.pipe(
      startWith(this.queryCtrl.value),
      debounceTime(200),
      map((v) => v.trim().toUpperCase()),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((q) => this.store.setQuery(q));

    this.minChangeCtrl.valueChanges.pipe(
      startWith(this.minChangeCtrl.value),
      debounceTime(200),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((v) => this.store.setMinChangePct(v ?? null));

    this.sortByCtrl.valueChanges.pipe(
      startWith(this.sortByCtrl.value as any),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((v) => this.store.setSort(v as any, this.sortDirCtrl.value as any));

    this.sortDirCtrl.valueChanges.pipe(
      startWith(this.sortDirCtrl.value as any),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((v) => this.store.setSort(this.sortByCtrl.value as any, v as any));
  }

  // NOUVEAU : Méthode pour éditer une position
  editPosition(item: any) {
    const qtyStr = prompt(`Quantité détenue pour ${item.symbol} ?`, item.position?.quantity || '0');
    if (qtyStr === null) return;
    
    const qty = parseFloat(qtyStr);
    if (isNaN(qty)) return;

    if (qty === 0) {
      this.store.updatePosition(item.symbol, 0, 0); // Suppression
      return;
    }

    const priceStr = prompt(`Prix d'achat moyen ($) ?`, item.position?.avgPrice || item.price || '0');
    if (priceStr === null) return;
    
    const price = parseFloat(priceStr);
    if (!isNaN(price)) {
      this.store.updatePosition(item.symbol, qty, price);
    }
  }
  
  setTab(type: FilterType) {
    this.store.setAssetType(type);
  }

  add() {
    const sym = this.addCtrl.value.trim().toUpperCase();
    if (sym) {
      this.store.addSymbol(sym);
      this.addCtrl.setValue('');
    }
  }

  pickSuggestion(symbol: string) {
    this.store.addSymbol(symbol);
    this.addCtrl.setValue('');
  }

  reset() {
    if (confirm('Tout remettre à zéro ?')) {
      this.store.reset();
    }
  }
}