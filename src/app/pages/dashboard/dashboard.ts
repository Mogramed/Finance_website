import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime, distinctUntilChanged, map, startWith } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MarketStore, SortBy, SortDir } from '../../core/store/market.store';

@Component({
  selector: 'app-dashboard',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private readonly store = inject(MarketStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly vm$ = this.store.filteredWatchlistVm$;
  readonly count$ = this.store.watchlistCount$;

  readonly stateJson$ = this.store.snapshot$.pipe(
    map((s) => JSON.stringify(s, null, 2))
  );

  readonly queryCtrl = new FormControl('', { nonNullable: true });
  readonly minChangeCtrl = new FormControl<number | null>(null);
  readonly addCtrl = new FormControl('', { nonNullable: true });

  readonly sortByCtrl = new FormControl<SortBy>('addedAt', { nonNullable: true });
  readonly sortDirCtrl = new FormControl<SortDir>('desc', { nonNullable: true });

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
      startWith(this.sortByCtrl.value),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((v) => this.store.setSort(v, this.sortDirCtrl.value));

    this.sortDirCtrl.valueChanges.pipe(
      startWith(this.sortDirCtrl.value),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((v) => this.store.setSort(this.sortByCtrl.value, v));
  }

  add() {
    const sym = this.addCtrl.value.trim().toUpperCase();
    if (!sym) return;
    this.store.addSymbol(sym);
    this.addCtrl.setValue('');
  }

  remove(sym: string) {
    this.store.removeSymbol(sym);
  }

  reset() {
    this.store.reset();
  }
}
