'use strict';
const Datastore = require('nedb');
const Trader = require('./utils/kraken');
const log = require('./utils/log');

module.exports.startTrading = function startTrading() {
    if(!process.env.AUTOTRADER_KRAKEN_SECRET) return log.error('Missing environment variable AUTOTRADER_KRAKEN_SECRET');
    if(!process.env.AUTOTRADER_KRAKEN_KEY) return log.error('Missing environment variable AUTOTRADER_KRAKEN_KEY');
    if(!process.env.AUTOTRADER_CURRENCY) return log.error('Missing environment variable AUTOTRADER_CURRENCY');
    if(!process.env.AUTOTRADER_ASSET) return log.error('Missing environment variable AUTOTRADER_ASSET');

    const config = {
        // Exange configuration
        krakenKey: process.env.AUTOTRADER_KRAKEN_KEY,
        krakenSecret: process.env.AUTOTRADER_KRAKEN_SECRET,

        currency: process.env.AUTOTRADER_CURRENCY,
        asset: process.env.AUTOTRADER_ASSET,

        lowDiff: process.env.AUTOTRADER_LOW_DIFF || 2,
        highDiff: process.env.AUTOTRADER_HIGH_DIFF || 2,

        timeout: process.env.AUTOTRADER_TIMEOUT || 10000,
        simulate: process.env.AUTOTRADER_SIMULATE === 'true'
    };

    let kraken = new Trader({
        key: config.krakenKey,
        secret: config.krakenSecret,
        currency: config.currency,
        asset: config.asset
    });

    let dbTrades = new Datastore({filename: './data/trades', autoload: true});

    function addOrder(action, amount, price) {
        kraken.addOrder(action, amount, price, (err, data) => {
            if (err) return log.error('There was an error trying to', action, ':', JSON.stringify(err))

            // Store the transaction id to check its status later..
            dbTrades.insert({
                txid: txid,
                timestamp: new Date().getTime(),
                status: 'pending'
            }, (err, data) => {
                if (err) return log.error('The transaction was performed successfully, but there was an error storing the data of this transaction:', JSON.stringify(err));

                log.debug('The order was ok. This is the transaction ID:', txid);
            });
        })
    }

    function sell(availableLTC, price) {
        log.debug('The current market meet the requirements We can sell', availableLTC, 'LTC', 'at', price);
        !config.simulate && addOrder('sell', availableLTC, price);
    }

    function buy(availableEUR, price) {
        log.debug('The current market meet the requirements We can buy with', availableEUR, 'EUR at', price, 'EUR');
        !config.simulate && addOrder('buy', availableEUR, price);
    }

    function checkMarketAndAct(action, availableEUR, availableLTC, lastTrade) {

        kraken.getTicker((err, data) => {
            if (err) return log.error('There was a problem getting the market status:', JSON.stringify(err));

            log.debug('The current market is bid:', data.bid, 'and ask:', data.ask);

            const canSell = (data.ask - lastTrade.price) > config.highDiff;
            const canBuy = (lastTrade.price - data.bid) > config.lowDiff;

            if (action === 'sell' && canSell) return sell(availableLTC, data.ask);
            if (action === 'buy' && canBuy) return buy(availableEUR, data.bid);

            log.debug('The current market does not meet the requirements we want. So we need to run another time.');
        })
    }

    function makeProfit() {
        kraken.getTradesHistory((err, data) => {
            const lastTrade = data.trades[Object.keys(data.trades)[0]]

            if (lastTrade.pair !== kraken.pair) return log.error('We cannot continue, the last trade was for', lastTrade.pair, 'and we want', kraken.pair)

            kraken.getPortfolio((err, data) => {
                if (err) return log.error('There was an error getting funds', JSON.stringify(err));

                const availableLTC = data.filter((item) => item.name === 'LTC').pop().amount;
                const availableEUR = data.filter((item) => item.name === 'EUR').pop().amount;

                if (availableEUR > 0) {
                    // we need to buy some LTC
                    log.debug('Ok, we have ' + availableEUR + ' EUR, lets try to buy some TLC...');
                    checkMarketAndAct('buy', availableEUR, availableLTC, lastTrade);
                }
                if (availableLTC > 0) {
                    // we need to sell some LTC
                    log.debug('Ok, we have ' + availableLTC + ' LTC, lets try to sell them...');
                    checkMarketAndAct('sell', availableEUR, availableLTC, lastTrade);
                }

            })
        })
    }
    function getPendingOrders() {
        log.debug('Checking if there are pending orders...');
        dbTrades.find({status: 'pending'}, (err, docs) => {
            if (docs.length === 0) {
                log.debug('We do not have pending orders. Lets continue the execution...');
                makeProfit();
            } else {
                log.debug('We have', docs.length, 'pending orders. Lets check its status before continue...');
                docs.forEach(order => {
                    kraken.checkOrder(order.txid, (err, status) => {
                        if (err) return log.error('There was an error checking the order status:', JSON.stringify(err))

                        if (status) {
                            log.debug('The order', order.txid, 'is closed now. We can delete it from database');
                            dbTrades.remove({txid: order.txid}, {}, (err, numRemoved) => {
                                if (err) return log.error('There was an error deleting the order from database');
                                log.debug('The order was removed successfully');
                            });
                        } else {
                            log.debug('The order', order.txid, 'is still pending');
                        }

                    })
                })
            }
        })
    }

    function boot() {
        log.debug('#############################################')
        log.debug('Starting at', new Date(), 'Trading', config.asset)
        getPendingOrders();
    }

    setInterval(boot, config.timeout);
};