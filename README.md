# Monarch Transaction CLI

Do you like to review every transaction for accuracy?
Do you find yourself easily getting lost or overwhelmed at the long list of transactions in the UI?
Are you frustrated at the number of clicks it takes to edit each transaction?

This script is for you!

The Monarch Transaction CLI will pull a list of transactions marked for review
for you to look at and edit one by one.

<p align="center">
<img src="https://raw.githubusercontent.com/timtrinidad/monarch-txn-cli/main/assets/categories.png" width="450" />
</p>

## How To Use
1. Ensure you have `node >= 18` installed.

2. Check out this repository
    ```
    git clone https://github.com/timtrinidad/monarch-txn-cli.git
    cd monarch-txn-cli
    ```

3. Install dependencies
    ```
    yarn
    ```
   
4. Add your credentials
    ```
    cp .env.sample
    vi .env
    ```
    TODO: Support Google login and MFA


5. Start the script
    ```
    yarn start
    ```
   
## Features
* Set the transaction date
<p align="center">
<img src="https://raw.githubusercontent.com/timtrinidad/monarch-txn-cli/main/assets/date.png" width="386" />
</p>

* Set the category (autocomplete single select)
<p align="center">
<img src="https://raw.githubusercontent.com/timtrinidad/monarch-txn-cli/main/assets/categories.png" width="425" />
</p>

* Set the tags (autocomplete multi-select)

* Set the merchant (autocomplete single select with transaction count)
<p align="center">
<img src="https://raw.githubusercontent.com/timtrinidad/monarch-txn-cli/main/assets/merchant.png" width="394" />
</p>

* Set the notes

* Bulk set the category and tags for multiple transactions

* Find transactions with a keyword (useful to find how you categorized similar transactions when editing the current one)

* Open the browser with a URL based on the current transaction (e.g. search Google for a merchant name)

## Browser Links
To allow links to open for a given transaction, copy the `links.json.sample` file to `links.json`.

URLs can use the following tokens can be used as placeholders for URL-encoded values:

| token | description |
| -- | -- |
| `plaidName` | The original merchant name from the bank |
| `date` | The `YYYY-MM-DD` formatted date |
