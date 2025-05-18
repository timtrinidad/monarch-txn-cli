import MonarchApi from './monarch_api.js';
import {
  MonarchCategory,
  MonarchTag,
  MonarchTransaction,
  MonarchTransactionUpdates,
} from './types/monarch-types.js';
import moment from 'moment';
import prompts from 'prompts';
import chalk from 'chalk';
import open from 'open';
import { readFileSync, existsSync } from 'fs';
import sortby from 'lodash.sortby';
import pupa from 'pupa';

const CUSTOM_LINKS_PATH = 'links.json';

let monarchApi: MonarchApi | null = null;
let monarchCategories: Map<string, MonarchCategory> | null = null;
let monarchTags: Map<string, MonarchTag> | null = null;
let loadedLinks: Map<string, string> | null = null;

async function exec() {
  const api = await getMonarchApi();

  const txns = await api.searchTransactions({
    needsReview: true,
    needsReviewUnassigned: true,
  });
  await processTransactions(txns);
}

function listToMap<A extends { id: string }>(items: A[]): Map<string, A> {
  const mapping = new Map<string, A>();
  items.forEach((x) => mapping.set(x.id, x));
  return mapping;
}

async function processTransactions(transactions: MonarchTransaction[]): Promise<void> {
  let index = 0;
  const numTxns = transactions.length;

  console.log('========== Transactions To Review - Count by Merchant ==========');
  const counts = transactions.reduce((prev, curr) => {
    const merchantName = curr.merchant.name;
    if (merchantName in prev) {
      prev[merchantName]++;
    } else {
      prev[merchantName] = 1;
    }
    return prev;
  }, {} as Record<string, number>);
  Object.entries(counts)
    .sort(([_a, a], [_b, b]) => b - a)
    .forEach(([merchant, numTxns]) => {
      console.log(`  ${numTxns}\t${merchant}`);
    });

  while (index < numTxns) {
    const transaction = transactions[index];
    await displayTransaction(transactions, index);
    index = await promptForAction(transactions, index);
  }
}

async function promptForAction(transactions: MonarchTransaction[], index: number): Promise<number> {
  const api = await getMonarchApi();

  const numTxns = transactions.length;
  const transaction = transactions[index];
  const transactionDate = moment(transaction.date).toDate();

  const command = await prompts({
    type: 'text',
    name: 'command',
    message: 'Command: ',
    onState: (state): void => {
      if (state.aborted) {
        process.nextTick(() => {
          process.exit(0);
        });
      }
    },
  });

  switch (command.command) {
    // Next TXN, mark as reviewed
    case 'n':
      console.debug('Marking as reviewed and going to next transaction...');
      await saveTransaction(transactions, index, {
        reviewed: true,
      });
      return (index < numTxns - 1 ? 1 : 0) + index;
      break;

    // Skip TXN
    case 's':
      console.debug('Skipping to next transaction...');
      return (index < numTxns - 1 ? 1 : 0) + index;
      break;

    // Previous TXN
    case 'p':
      console.debug('Going to previous transaction...');
      return (index > 0 ? -1 : 0) + index;
      break;

    // Change merchant
    case 'm':
      const merchant = await prompts({
        type: 'autocomplete',
        name: 'merchant',
        message: 'Merchant: ',
        initial: transaction.merchant.name,
        choices: [transaction.merchant.name, '', '', '', '', '', '', '', '', ''].map((title) => ({
          title,
        })),
        suggest: async (input, choices) => {
          const originalMerchant = {
            title: `${chalk.grey('Original Merchant:')} ${transaction.plaidName}`,
            value: transaction.plaidName,
          };
          if (!input) {
            return [transaction.merchant.name, originalMerchant];
          }
          const results = await api.findMerchants(input);
          const existingMerchants = results.map((r) => ({
            title: `${r.name} ${chalk.grey(r.transactionCount)}`,
            value: r.name,
          }));
          const newMerchant = {
            title: `${chalk.grey('Create New Merchant:')} ${input}`,
            value: input,
          };
          return [...existingMerchants, newMerchant, originalMerchant];
        },
      });
      console.debug(`Updating merchant to "${merchant.merchant}"`);
      await saveTransaction(transactions, index, {
        name: merchant.merchant,
      });
      break;

    // Change notes
    case 'o':
      const description = await promptForDescription(transaction);
      console.debug(`Updating notes to ${description}`);
      await saveTransaction(transactions, index, {
        notes: description,
      });
      break;

    // Change Category
    case 'c':
      const category = await promptForCategory(transaction.category.id);
      if (category) {
        await saveTransaction(transactions, index, {
          category: category.id,
          // Mark things that are reimbursable as hidden
          hideFromReports: category.name.match(/^Reimbursable/) ? true : undefined,
        });
      }
      break;

    // Bulk Change Category/Tags
    case 'b':
      const searchRes = await searchTransactions(transaction.merchant.name);
      if (!searchRes.length) {
        console.debug('No search results found.');
        break;
      }
      const selectedTxns = await prompts({
        type: 'multiselect',
        name: 'transactions',
        message: 'Transactions: ',
        choices: searchRes.reverse().map((txn) => ({
          title: formatSearchResult(txn),
          value: txn.id,
        })),
      });
      if (selectedTxns.transactions.length === 0) {
        console.debug('No transactions selected.');
        break;
      }
      const bulkCategory = await promptForCategory();
      if (bulkCategory) {
        await updateCategories(transactions, bulkCategory, selectedTxns.transactions);
      }
      const bulkTags = await promptForTags();
      if (bulkTags.length) {
        await updateTags(transactions, bulkTags, selectedTxns.transactions);
      }
      break;

    // Change Tags
    case 't':
      const tags = await getMonarchTags();
      const selectedTags = await promptForTags(transaction.tags.map((x) => x.id));
      await setTransactionTags(transactions, index, selectedTags);
      break;

    // Change Date
    case 'd':
      const date = await prompts({
        type: 'date',
        name: 'date',
        message: 'Date: ',
        initial: transactionDate,
        mask: 'YYYY-MM-DD',
      });
      await saveTransaction(transactions, index, {
        date: formatPromptDateAsMonarchDate(date.date),
      });
      break;

    // Force reload transaction information
    case 'r':
      transactions[index] = await api.getTransaction(transaction.id);
      break;

    // Find other transactions
    case 'f':
      const searchResults = await searchTransactions(transaction.merchant.name);
      if (!searchResults.length) {
        console.debug(chalk.red('No results found'));
        break;
      }
      searchResults.forEach((searchTxn): void => {
        console.debug(formatSearchResult(searchTxn));
      });
      break;

    // Open additional links based on links.json
    case 'l':
      const links = await getCustomLinks();
      if (!links.size) {
        console.debug(
          chalk.red(
            'The file `links.json` does not exist. Create one based on `links.json.sample`.'
          )
        );
        break;
      }
      const link = await prompts({
        type: 'select',
        choices: Array.from(links.keys()).map((x) => ({ title: x, value: x })),
        name: 'link',
        message: 'Link Type: ',
      });
      const url = links.get(link.link)!;
      open(
        pupa(url, {
          plaidName: encodeURIComponent(transaction.plaidName),
          date: encodeURIComponent(transaction.date),
          transactionId: encodeURIComponent(transaction.id),
        })
      );
      break;

    // Quit
    case 'q':
      console.debug('Exiting...');
      return numTxns;

    // Help Text
    default:
      console.debug(`Unknown command "${command.command}"`);
    case 'h':
    case '?':
      const { log } = console;
      log('Available Commands:');
      log('  n\tMark the current transaction as reviewed and go to the next transaction');
      log('  s\tSkip to the next transaction');
      log('  p\tGo to the previous transaction');
      log('  m\tSet the merchant for this transaction');
      log('  o\tSet the notes for this transaction');
      log('  c\tSet the category for this transaction');
      log('  b\tBulk set transaction categories');
      log('  t\tSet the tags for this transaction');
      log('  d\tSet the date (when) for this transaction');
      log('  r\tForce reload this transaction');
      log('  l\tOpen a link for this transaction');
      log('  f\tFind transactions for a given description');
      log('  q\tQuit');
      break;
  }
  return index;
}

/**
 * Prompt user for transaction category
 */
async function promptForCategory(
  initialCategoryId: string | undefined = undefined
): Promise<MonarchCategory | null> {
  const categories = await getMonarchCategories();
  const category = await prompts({
    type: 'autocomplete',
    name: 'category',
    message: 'Category: ',
    choices: sortby(
      Array.from(categories.values()).map((x) => ({
        title: `${x.icon}  ${x.group.name}: ${x.name}`,
        title_single: x.name,
        value: x.id,
        name: `${x.group.name}: ${x.name}`,
      })),
      'name'
    ),
    suggest: caseInsensitiveFilter,
    initial: initialCategoryId,
  });
  const newCategory = categories.get(category.category);
  return newCategory || null;
}

async function promptForTags(
  initialTagIds: string[] | undefined = undefined
): Promise<MonarchTag[]> {
  const tags = await getMonarchTags();
  const bulkTags = await prompts({
    type: 'autocompleteMultiselect',
    name: 'tags',
    message: 'Tags: ',
    choices: sortby(
      Array.from(tags.values()).map((x) => ({
        title: x.name,
        title_single: x.name,
        value: x,
        selected: initialTagIds ? Boolean(initialTagIds.find((tagId) => tagId === x.id)) : false,
      })),
      'title'
    ),
    suggest: caseInsensitiveFilter,
  });
  return bulkTags.tags;
}

/**
 * Prompt user to change transaction description
 */
async function promptForDescription(
  transaction: MonarchTransaction,
  initial?: string
): Promise<string> {
  const description = await prompts({
    type: 'text',
    name: 'description',
    message: 'Description: ',
    initial: initial || transaction.notes,
    validate: (val): string | true =>
      val.length > 1024 ? `Max length: 1024 chars (curr ${val.length})` : true,
  });
  return description.description;
}
//
/**
 * Search for transactions
 */
async function searchTransactions(initTerm: string): Promise<MonarchTransaction[]> {
  const api = await getMonarchApi();
  const search = await prompts({
    type: 'text',
    name: 'search',
    message: 'Search transactions: ',
    initial: initTerm,
  });
  try {
    const searchResults = await api.searchTransactions({ search: search.search }, 'date', 50);

    return searchResults.reverse();
  } catch (e) {
    console.debug(chalk.red('Unable to search transactions. Error: ' + (e as Error).message));
    return [];
  }
}

function formatSearchResult(searchTxn: MonarchTransaction): string {
  return (
    `${formatDate(searchTxn.date)}  ${formatAmount(searchTxn.amount)}  ` +
    `${chalk.yellow(searchTxn.merchant.name)} ${formatCategory(searchTxn.category)} ` +
    `${searchTxn.tags ? formatTags(searchTxn.tags) : ''} ` +
    `${chalk.gray((searchTxn.notes || '').replaceAll(/\n+/g, ' ').substring(0, 50))}`
  );
}

/**
 * Save changes to a transaction via the mint API
 */
async function saveTransaction(
  transactionsList: MonarchTransaction[],
  transactionIndex: number,
  updates: MonarchTransactionUpdates
): Promise<void> {
  const api = await getMonarchApi();
  const originalTransaction = transactionsList[transactionIndex];
  console.debug(`Saving transaction ${originalTransaction.id}...`);
  try {
    const res = await api.updateTransaction(originalTransaction, updates);
    transactionsList[transactionIndex] = res;
  } catch (e) {
    console.debug(
      chalk.red('Error saving transaction - please try again. Error: ' + (e as Error).message)
    );
  }
}

async function setTransactionTags(
  transactionsList: MonarchTransaction[],
  transactionIndex: number,
  newTags: MonarchTag[]
): Promise<void> {
  const api = await getMonarchApi();
  const originalTransaction = transactionsList[transactionIndex];
  console.debug(`Updating tags for transaction ${originalTransaction.id}...`);
  try {
    const res = await api.setTransactionTags(
      originalTransaction,
      newTags.map((x) => x.id)
    );
    transactionsList[transactionIndex] = res;
  } catch (e) {
    console.debug(
      chalk.red('Error saving transaction - please try again. Error: ' + (e as Error).message)
    );
  }
}

async function updateCategories(
  transactionsList: MonarchTransaction[],
  category: MonarchCategory,
  transactionIds: string[]
): Promise<void> {
  const api = await getMonarchApi();
  console.debug(`Updating categories for transactions ${transactionIds.join(', ')}...`);
  try {
    await api.bulkUpdateTransactions(transactionIds, {
      categoryId: category.id,
    });

    transactionsList.forEach((txn) => {
      if (transactionIds.includes(txn.id)) {
        txn.category = category;
      }
    });
  } catch (e) {
    console.debug(
      chalk.red('Error saving transactions - please try again. Error: ' + (e as Error).message)
    );
  }
}

/**
 * Bulk update tags
 */
async function updateTags(
  transactionsList: MonarchTransaction[],
  tags: MonarchTag[],
  transactionIds: string[]
): Promise<void> {
  if (!tags.length) {
    return;
  }
  const api = await getMonarchApi();
  console.debug(`Updating tags for transactions ${transactionIds.join(', ')}...`);
  try {
    await api.bulkUpdateTransactions(transactionIds, { tags: tags.map((x) => x.id) });

    transactionsList.forEach((txn) => {
      if (transactionIds.includes(txn.id)) {
        txn.tags = tags;
      }
    });
  } catch (e) {
    console.debug(
      chalk.red('Error saving transactions - please try again. Error: ' + (e as Error).message)
    );
  }
}

/**
 * Format a transaction for display
 */
async function displayTransaction(transactions: MonarchTransaction[], num: number): Promise<void> {
  const api = await getMonarchApi();
  const txn = transactions[num];
  const total = transactions.length;
  const { log } = console;
  const prevTxns = await api.searchTransactions({ search: txn.merchant.name }, 'date', 50);

  // Count previous categories from search
  const prevCats = prevTxns
    .map((x) => formatCategory(x.category, true))
    .reduce((counts, x) => counts.set(x, (counts.get(x) || 0) + 1), new Map<string, number>())
    .entries();
  // Sort by descending order and take top 2, ignoring 1's
  const prevCatsLine = Array.from(prevCats)
    .sort((a, b) => b[1] - a[1])
    .filter(([_, num]) => num > 1)
    .slice(0, 2)
    .map(([cat, num]) => `${cat} x${num}`)
    .join(', ');

  log(`========== ${num + 1} of ${total} ==========`);
  log(
    `${formatDate(txn.date)}  ` +
      `${formatAmount(txn.amount)}  ` +
      `${chalk.yellow(txn.merchant.name)} ` +
      (txn.hideFromReports ? `${chalk.red('Hidden')} ` : '') +
      (txn.notes ? `${chalk.grey(txn.notes.replaceAll(/\n+/g, '\n'))}` : '')
  );
  log(
    `   ${chalk.bold('Category')}: ${formatCategory(txn.category)} ${
      prevCatsLine ? chalk.grey(`(prev. txns.: ${prevCatsLine})`) : ''
    }`
  );
  log(`   ${chalk.bold('Tags')}: ${formatTags(txn.tags)}`);
  log(
    `   ${chalk.gray(txn.account.displayName)}\n` +
      `   ${chalk.grey(txn.originalDate)}\t${chalk.grey(txn.plaidName)}`
  );
}

/**
 * Given a transaction amount, format for display
 */
function formatAmount(amount: number): string {
  const amountColor = amount > 0 ? chalk.green : chalk.magenta;
  const amountFormatted = formatCurrency(amount);
  return amountColor(amountFormatted);
}

/**
 * Given a transaction date, format for display
 */
function formatDate(date: string | moment.Moment): string {
  return chalk.cyan.bold((typeof date === 'string' ? moment(date) : date).format('ddd MMM D YYYY'));
}

/**
 * Given a transaction category, format for display
 */
function formatCategory(category: Partial<MonarchCategory>, noFormat = false): string {
  let categoryFormat = chalk.gray;
  if (!noFormat) {
    categoryFormat = category.name === 'Uncategorized' ? chalk.yellow.bold.underline : chalk.yellow;
  }
  const categoryIcon = category.icon;
  return `${categoryIcon}  ${categoryFormat(category.name)}`;
}

/**
 * Given transaction tags, format for display
 */
function formatTags(tagData: MonarchTag[]): string {
  return chalk.yellow(tagData ? tagData.map((x) => `🏷️ ${x.name}`).join(', ') : chalk.grey('none'));
}

/**
 * Format a number as a US currency string
 */
function formatCurrency(num: number): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  });

  return formatter.format(num);
}

/**
 * Format a prompt-returned date object as a mint YYYY-MM-DD string.
 */
function formatPromptDateAsMonarchDate(date: Date): string {
  return moment(date.toISOString()).format('YYYY-MM-DD');
}

/**
 * Filter a list of choices by the "title" attribute for a given input - case-insensitive
 * Used by prompts autocomplete
 */
function caseInsensitiveFilter(input: string, choices: any[]): any {
  const filtered = sortby(
    choices.filter((x) => x.title.match(new RegExp(input, 'i'))),
    [(o) => o.title_single.toUpperCase() === input.toUpperCase(), 'title']
  );
  return Promise.resolve(filtered);
}

async function getMonarchApi(): Promise<MonarchApi> {
  if (!monarchApi) {
    const api = new MonarchApi();
    await api.login();
    monarchApi = api;
  }
  return monarchApi;
}

async function getMonarchCategories(): Promise<Map<string, MonarchCategory>> {
  if (!monarchCategories) {
    const api = await getMonarchApi();
    monarchCategories = listToMap(await api.getCategories());
  }
  return monarchCategories;
}

async function getMonarchTags(): Promise<Map<string, MonarchTag>> {
  if (!monarchTags) {
    const api = await getMonarchApi();
    monarchTags = listToMap(await api.getTags());
  }
  return monarchTags;
}

async function getCustomLinks(): Promise<Map<string, string>> {
  if (!loadedLinks) {
    if (existsSync(CUSTOM_LINKS_PATH)) {
      const links = JSON.parse(readFileSync(CUSTOM_LINKS_PATH).toString());
      loadedLinks = new Map(Object.entries(links));
    } else {
      loadedLinks = new Map();
    }
  }
  return loadedLinks;
}

exec().then(() => console.log('done'));
