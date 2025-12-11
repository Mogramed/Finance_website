import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';

@Component({
  selector: 'app-symbol',
  imports: [CommonModule, RouterLink],
  templateUrl: './symbol.html',
  styleUrl: './symbol.scss',
})
export class Symbol {
  private readonly route = inject(ActivatedRoute);

  // Récupère juste le symbole de l'URL pour l'instant
  readonly symbol$ = this.route.paramMap.pipe(
    map(p => p.get('symbol'))
  );
}