// src/app/core/models/finance.models.ts

export interface Transaction {
  id: string;
  label: string;
  amount: number; // En centimes
  date: Date;
  type: 'income' | 'expense';
  category: 'food' | 'transport' | 'salary' | 'invest' | 'tech';
  status: 'completed' | 'pending';
}

export interface Wallet {
  id: string;
  balance: number; // En centimes
  currency: string;
  monthlyChange: number; // Pourcentage
}

export interface StockSymbol {
  symbol: string;
  price: number;
  change: number;
}