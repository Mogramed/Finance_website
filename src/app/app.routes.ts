import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/shell/shell').then(m => m.Shell),
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      { 
        path: 'dashboard', 
        loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard) 
      },
      // NOUVELLE ROUTE
      {
        path: 'invest',
        loadComponent: () => import('./pages/invest/invest').then(m => m.Invest)
      },
      { 
        path: 'symbol/:symbol', 
        loadComponent: () => import('./pages/symbol/symbol').then(m => m.Symbol) 
      },
      { 
        path: 'settings', 
        loadComponent: () => import('./pages/settings/settings').then(m => m.Settings) 
      },
    ]
  },
  { 
    path: '**', 
    loadComponent: () => import('./pages/not-found/not-found').then(m => m.NotFound) 
  },
];