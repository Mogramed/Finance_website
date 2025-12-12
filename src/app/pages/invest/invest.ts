import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MarketStore } from '../../core/store/market.store';
import { MarketDataService } from '../../core/api/market-data.service';
import { debounceTime, distinctUntilChanged, switchMap, startWith, map, tap } from 'rxjs';

@Component({
  selector: 'app-invest',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './invest.html',
  styleUrl: './invest.scss'
})
export class Invest {
  readonly store = inject(MarketStore);
  private readonly marketData = inject(MarketDataService);

  readonly balance$ = this.store.balance$;
  readonly transactions$ = this.store.transactions$;

  // Formulaires
  readonly searchCtrl = new FormControl('', { nonNullable: true });
  readonly qtyCtrl = new FormControl(1, { nonNullable: true });

  // État local
  selectedAsset: any = null;
  estimatedTotal = 0;

  // Recherche
  readonly suggestions$ = this.searchCtrl.valueChanges.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(val => {
      if (val.length < 2) return [];
      return this.marketData.search(val);
    })
  );

  selectAsset(symbol: string) {
    this.searchCtrl.setValue(symbol, { emitEvent: false });
    this.selectedAsset = { symbol, price: 0, loading: true };
    
    // On récupère le prix live pour afficher
    this.marketData.watch([symbol], 5000).subscribe(quotes => {
      const q = quotes.find(x => x.symbol === symbol);
      if (q) {
        this.selectedAsset = { ...q, loading: false };
        this.updateTotal();
      }
    });
  }

  updateTotal() {
    if (this.selectedAsset && !this.selectedAsset.loading) {
      this.estimatedTotal = this.selectedAsset.price * this.qtyCtrl.value;
    }
  }

  buy() {
    if (!this.selectedAsset || this.estimatedTotal <= 0) return;
    this.store.executeOrder('BUY', this.selectedAsset.symbol, this.qtyCtrl.value, this.selectedAsset.price);
    this.resetForm();
  }

  sell() {
    if (!this.selectedAsset || this.estimatedTotal <= 0) return;
    // Vérif simple: est-ce qu'on en a ? (Le store gère la logique complexe, ici juste UI)
    this.store.executeOrder('SELL', this.selectedAsset.symbol, this.qtyCtrl.value, this.selectedAsset.price);
    this.resetForm();
  }

  resetForm() {
    this.searchCtrl.setValue('');
    this.selectedAsset = null;
    this.estimatedTotal = 0;
    this.qtyCtrl.setValue(1);
  }
}