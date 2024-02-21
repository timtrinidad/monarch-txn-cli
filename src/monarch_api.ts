import nodeFetch, { RequestInfo, RequestInit, Response } from 'node-fetch';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import {
  MonarchBulkTransactionUpdates,
  MonarchCategory,
  MonarchMerchant,
  MonarchSearchFilters,
  MonarchTag,
  MonarchTransaction,
  MonarchTransactionList,
  MonarchTransactionUpdates,
} from './types/monarch-types.js';
import getenv from 'getenv';
import * as dotenv from 'dotenv';

dotenv.config();

const BASE_URL = 'https://api.monarchmoney.com';
const TOKEN_CACHE_PATH = '.token_cache';

export default class MonarchApi {
  token: string | null = null;
  async login() {
    console.debug('Loading token cache');

    const storedConfig: Record<string, string> | null = existsSync(TOKEN_CACHE_PATH)
      ? JSON.parse(readFileSync(TOKEN_CACHE_PATH).toString())
      : null;

    if (storedConfig && storedConfig.token) {
      this.token = storedConfig.token;
      return;
    }

    console.debug('No cached token found. Logging in.');
    const res = (await this.fetch('auth/login/', {
      method: 'POST',
      body: JSON.stringify({
        username: getenv('MONARCH_USERNAME'),
        password: getenv('MONARCH_PASSWORD'),
        trusted_device: true,
        supports_mfa: true,
      }),
    })) as Record<string, string>;

    writeFileSync(
      TOKEN_CACHE_PATH,
      JSON.stringify({
        token: res.token,
      })
    );
    this.token = res.token;
  }

  async getTransaction(id: string): Promise<MonarchTransaction> {
    const query = `query GetTransactionDrawer($id: UUID!, $redirectPosted: Boolean) {
  getTransaction(id: $id, redirectPosted: $redirectPosted) {
    id
    amount
    pending
    isRecurring
    date
    originalDate
    hideFromReports
    needsReview
    reviewedAt
    reviewedByUser {
      id
      name
      __typename
    }
    plaidName
    notes
    hasSplitTransactions
    isSplitTransaction
    isManual
    splitTransactions {
      id
      ...TransactionDrawerSplitMessageFields
      __typename
    }
    originalTransaction {
      id
      ...OriginalTransactionFields
      __typename
    }
    attachments {
      id
      publicId
      extension
      sizeBytes
      filename
      originalAssetUrl
      __typename
    }
    account {
      id
      ...TransactionDrawerAccountSectionFields
      __typename
    }
    category {
      id
      name
      icon
      group {
        id
        type
        __typename
      }
      __typename
    }
    goal {
      id
      __typename
    }
    merchant {
      id
      name
      transactionCount
      logoUrl
      recurringTransactionStream {
        id
        __typename
      }
      __typename
    }
    tags {
      id
      name
      color
      order
      __typename
    }
    needsReviewByUser {
      id
      __typename
    }
    __typename
  }
  myHousehold {
    id
    users {
      id
      name
      __typename
    }
    __typename
  }
}

fragment TransactionDrawerSplitMessageFields on Transaction {
  id
  amount
  merchant {
    id
    name
    __typename
  }
  category {
    id
    icon
    name
    __typename
  }
  __typename
}

fragment OriginalTransactionFields on Transaction {
  id
  date
  amount
  merchant {
    id
    name
    __typename
  }
  __typename
}

fragment TransactionDrawerAccountSectionFields on Account {
  id
  displayName
  icon
  logoUrl
  id
  mask
  subtype {
    display
    __typename
  }
  __typename
}`;
    const variables = {
      id: id,
      redirectPosted: true,
    };
    const res = (await this.graphql('GetTransactionDrawer', query, variables)) as any;
    return res.data.getTransaction;
  }

  async searchTransactions(
    filters: Partial<MonarchSearchFilters>,
    order: 'date' | 'inverse_date' = 'inverse_date',
    limit = 1000
  ): Promise<MonarchTransaction[]> {
    const query = `query Web_GetTransactionsList($offset: Int, $limit: Int, $filters: TransactionFilterInput, $orderBy: TransactionOrdering) {
  allTransactions(filters: $filters) {
    totalCount
    results(offset: $offset, limit: $limit, orderBy: $orderBy) {
      id
      ...TransactionOverviewFields
      __typename
    }
    __typename
  }
  transactionRules {
    id
    __typename
  }
}

fragment TransactionOverviewFields on Transaction {
  id
  amount
  pending
  date
  originalDate
  hideFromReports
  plaidName
  notes
  isRecurring
  reviewStatus
  needsReview
  dataProviderDescription
  attachments {
    id
    __typename
  }
  account {
    displayName
    id
  }
  isSplitTransaction
  category {
    id
    name
    icon
    group {
      id
      type
      __typename
    }
    __typename
  }
  merchant {
    name
    id
    transactionsCount
    __typename
  }
  tags {
    id
    name
    color
    order
    __typename
  }
  __typename
}`;
    const variables = {
      orderBy: order,
      limit,
      filters: {
        search: '',
        categories: [],
        accounts: [],
        tags: [],
        ...filters,
      },
    };
    const res = (await this.graphql(
      'Web_GetTransactionsList',
      query,
      variables
    )) as MonarchTransactionList;
    return res.data.allTransactions.results;
  }

  async getCategories(): Promise<MonarchCategory[]> {
    const query = `query GetCategories {
  categories {
    ...CategoryFields
    __typename
  }
}

fragment CategoryFields on Category {
  id
  order
  name
  icon
  systemCategory
  isSystemCategory
  isDisabled
  group {
    id
    name
    type
    __typename
  }
  __typename
}`;
    const res = (await this.graphql('GetCategories', query, {})) as any;
    return res.data.categories;
  }

  async getTags(): Promise<MonarchTag[]> {
    const query = `query GetHouseholdTransactionTags($search: String, $limit: Int, $bulkParams: BulkTransactionDataParams, $includeTransactionCount: Boolean = false) {
  householdTransactionTags(
    search: $search
    limit: $limit
    bulkParams: $bulkParams
  ) {
    id
    name
    color
    order
    transactionCount @include(if: $includeTransactionCount)
    __typename
  }
}`;
    const variables = {
      includeTransactionCount: false,
    };
    const res = (await this.graphql('GetHouseholdTransactionTags', query, variables)) as any;
    return res.data.householdTransactionTags;
  }

  async updateTransaction(
    transaction: MonarchTransaction,
    updates: MonarchTransactionUpdates
  ): Promise<MonarchTransaction> {
    const query = `mutation Web_TransactionDrawerUpdateTransaction($input: UpdateTransactionMutationInput!) {
  updateTransaction(input: $input) {
    transaction {
      id
      amount
      pending
      date
      originalDate
      hideFromReports
      plaidName
      notes
      isRecurring
      reviewStatus
      needsReview
      dataProviderDescription
      attachments {
        id
        __typename
      }
      account {
        displayName
        id
      }
      isSplitTransaction
      category {
        id
        name
        icon
        group {
          id
          type
          __typename
        }
        __typename
      }
      merchant {
        name
        id
        transactionsCount
        __typename
      }
      tags {
        id
        name
        color
        order
        __typename
      }
      __typename
    }
    errors {
      ...PayloadErrorFields
      __typename
    }
    __typename
  }
}

fragment PayloadErrorFields on PayloadError {
  fieldErrors {
    field
    messages
    __typename
  }
  message
  code
  __typename
}`;
    const variables = {
      input: {
        id: transaction.id,
        ...updates,
      },
    };

    const res = (await this.graphql(
      'Web_TransactionDrawerUpdateTransaction',
      query,
      variables
    )) as any;

    return res.data.updateTransaction.transaction;
  }

  async setTransactionTags(
    transaction: MonarchTransaction,
    tagIds: string[]
  ): Promise<MonarchTransaction> {
    const query = `mutation Web_SetTransactionTags($input: SetTransactionTagsInput!) {
  setTransactionTags(input: $input) {
    errors {
      ...PayloadErrorFields
      __typename
    }
    transaction {
      id
      tags {
        id
        __typename
      }
      __typename
    }
    __typename
  }
}

fragment PayloadErrorFields on PayloadError {
  fieldErrors {
    field
    messages
    __typename
  }
  message
  code
  __typename
}`;
    const variables = {
      input: {
        transactionId: '166332725911824754',
        tagIds,
      },
    };

    await this.graphql('Web_SetTransactionTags', query, variables);

    return this.getTransaction(transaction.id);
  }

  async bulkUpdateTransactions(
    transactionIds: string[],
    updates: MonarchBulkTransactionUpdates
  ): Promise<void> {
    const query = `mutation Common_BulkUpdateTransactionsMutation($selectedTransactionIds: [ID!], $excludedTransactionIds: [ID!], $allSelected: Boolean!, $expectedAffectedTransactionCount: Int!, $updates: TransactionUpdateParams!, $filters: TransactionFilterInput) {
  bulkUpdateTransactions(
    selectedTransactionIds: $selectedTransactionIds
    excludedTransactionIds: $excludedTransactionIds
    updates: $updates
    allSelected: $allSelected
    expectedAffectedTransactionCount: $expectedAffectedTransactionCount
    filters: $filters
  ) {
    success
    affectedCount
    errors {
      message
      __typename
    }
    __typename
  }
}`;
    const variables = {
      selectedTransactionIds: transactionIds,
      updates,
      excludedTransactionIds: [],
      allSelected: false,
      expectedAffectedTransactionCount: transactionIds.length,
      filters: {
        search: '',
        categories: [],
        accounts: [],
        tags: [],
      },
    };
    const res = (await this.graphql(
      'Common_BulkUpdateTransactionsMutation',
      query,
      variables
    )) as any;
  }

  async findMerchants(input: string) {
    const query = `query Web_GetMerchantSelectHouseholdMerchants($offset: Int!, $limit: Int!, $orderBy: MerchantOrdering, $search: String) {
  merchants(
    offset: $offset
    limit: $limit
    orderBy: $orderBy
    search: $search
    includeMerchantsWithoutTransactions: false
  ) {
    id
    name
    logoUrl
    transactionCount
    __typename
  }
}`;
    const variables = {
      offset: 0,
      limit: 8,
      orderBy: 'TRANSACTION_COUNT',
      search: input,
    };

    const res = (await this.graphql(
      'Web_GetMerchantSelectHouseholdMerchants',
      query,
      variables
    )) as any;

    return res.data.merchants as MonarchMerchant[];
  }

  async graphql(operationName: string, query: string, variables: any) {
    if (!this.token) {
      throw new Error('graphql called before login');
    }
    console.debug(
      `Running GraphQL operation ${operationName} with arguments ${JSON.stringify(variables)}`
    );
    return await this.fetch('graphql', {
      method: 'POST',
      headers: {
        Authorization: `Token ${this.token}`,
      },
      body: JSON.stringify({
        operationName,
        variables,
        query,
      }),
    });
  }

  async fetch(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!init.headers) {
      init.headers = {};
    }
    init.headers = {
      ...init.headers,
      'content-type': 'application/json',
    };
    const res = await nodeFetch(`${BASE_URL}/${path}`, init);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Request returned HTTP ${res.status}: ${res.statusText}\n${body}`);
    }
    return await res.json();
  }
}
