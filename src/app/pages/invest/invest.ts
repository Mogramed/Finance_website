import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MarketStore } from '../../core/store/market.store';
import { MarketDataService } from '../../core/api/market-data.service';
import { AssetType } from '../../core/api/market-interfaces'; // Import Type
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

  // Type d'actif sélectionné (Par défaut Crypto)
  activeType: AssetType = 'CRYPTO';

  readonly searchCtrl = new FormControl('', { nonNullable: true });
  readonly qtyCtrl = new FormControl(1, { nonNullable: true });

  selectedAsset: any = null;
  estimatedTotal = 0;

  // Recherche réactive qui dépend du Type
  readonly suggestions$ = this.searchCtrl.valueChanges.pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap(val => {
      if (val.length < 2) return [];
      // On passe le type actif au service
      return this.marketData.search(val, this.activeType);
    })
  );

  // Changement d'onglet
  setType(type: AssetType) {
    this.activeType = type;
    this.searchCtrl.setValue(''); // On vide la recherche
    this.selectedAsset = null;
  }

  selectAsset(symbol: string) {
    this.searchCtrl.setValue(symbol, { emitEvent: false });
    this.selectedAsset = { symbol, price: 0, loading: true };
    
    // On lance la surveillance
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