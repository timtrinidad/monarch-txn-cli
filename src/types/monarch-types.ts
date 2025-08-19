export interface MonarchTransactionList {
  data: {
    allTransactions: {
      totalCount: number;
      results: MonarchTransaction[];
    };
    transactionRules: Array<{
      id: string;
    }>;
  };
}

export interface MonarchTransaction {
  id: string;
  amount: number;
  pending: boolean;
  date: string;
  originalDate: string;
  hideFromReports: boolean;
  plaidName: string;
  notes?: string;
  isRecurring: boolean;
  reviewStatus: string;
  needsReview: boolean;
  dataProviderDescription: string;
  attachments: Array<unknown>;
  isSplitTransaction: boolean;
  account: {
    displayName: string;
    id: string;
  };
  category: Partial<MonarchCategory>;
  merchant: MonarchMerchant;
  tags: MonarchTag[];
  previousCategories?: string;
}

export interface MonarchMerchant {
  name: string;
  id: string;
  transactionCount: number;
}

export interface MonarchTag {
  id: string;
  name: string;
  color: string;
  order: number;
}

export interface MonarchCategory {
  id: string;
  order: number;
  name: string;
  icon: string;
  systemCategory: string;
  isSystemCategory: boolean;
  isDisabled: boolean;
  group: {
    id: string;
    name: string;
    type: string;
  };
}

export interface MonarchSearchFilters {
  search: string;
  categories: string;
  accounts: string;
  tags: string;
  needsReview: boolean;
  needsReviewUnassigned: boolean;
}

export interface MonarchTransactionUpdates {
  date?: string;
  category?: string;
  notes?: string;
  tags?: string[]; // For some reason tags can't be updated regularly
  hideFromReports?: boolean;
  reviewed?: true;
  needsReview?: true;
  needsReviewByUser?: string;
  name?: string;
}

export interface MonarchBulkTransactionUpdates {
  categoryId?: string;
  merchantName?: string;
  date?: string;
  notes?: string;
  hide?: boolean;
  tags?: string[];
  reviewStatus?: string;
  goalId?: string;
  isRecurring?: boolean;
}
