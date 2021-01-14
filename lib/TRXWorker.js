var base58 = require('base58-native');
var fs = require('fs');
var TronWeb = require('tronweb');
var TronGrid = require('trongrid');
require('./logger.js');
var apiInterfaces = require('./apiInterfaces.js')(global.config.talleo.daemon, global.config.talleo.wallet);
require('./configReader.js');
var logTron = 'tron';
require('./exceptionWriter.js')(logTron);

var log = function (severity, system, text, data) {
    "use strict";
    global.log(severity, system, text, data);
};

var lastBlockTime;

var tronTransfers = {};

function fromHexString(hex){
    hex = hex.toString();
    var bytes = new Uint8Array(hex.length / 2);
    for(var i=0; i< hex.length-1; i+=2) {
        var c = parseInt(hex.substr(i, 2), 16);
        if (c > 127) {
          c = c - 256;
        }
        bytes[i/2] = c;
    }
    return bytes;
}

async function getConfirmations(txHash) {
    "use strict";
    try {
        // Instantiate TronWeb and TronGrid
        var tronweb = new TronWeb({fullHost: config.tron.httpsNode, privateKey: config.tron.ownerKey});

        // Get transaction details
        var trx = await tronweb.trx.getTransactionInfo(txHash);

        // Get current block number
        var currentBlock = await tronweb.trx.getCurrentBlock();
        currentBlock = currentBlock.block_header.raw_data.number;

        // When transaction is unconfirmed, its block number is null.
        // In this case we return 0 as number of confirmations
        return trx.blockNumber === null ? 0 : currentBlock - trx.blockNumber;
    } catch (error) {
        log('error', logTron, 'Error "%s" while trying to get number of confirmations for transaction with hash "%S"', [error, txHash]);
    }
}

function confirmTronTransaction(txHash) {
    "use strict";
    setTimeout(async function () {

        // Get current number of confirmations and compare it with sought-for value
        var txConfirmations = await getConfirmations(txHash);
        if (typeof tronTransfers[txHash] === 'undefined') {
            return;
        }
        var tronTransfer = tronTransfers[txHash];
        var TLOAddress = base58.encode(fromHexString(tronTransfer.result._to));

        log('info', logTron, 'Transaction with hash %s has %d confirmation(s)', [txHash, txConfirmations]);

        if (txConfirmations >= (global.config.tron.confirmations || 10)) {
            // Handle confirmation event according to your business logic

            log('info', logTron, 'Transaction with hash %s has been successfully confirmed', [txHash]);

            global.redisClient.hget('tlo-trx-bridge:tron', 'conversion' + txHash, function (err, result) {
                // Check that we haven't processed this conversion request already, minimum amount is 1 TLO
                if (result === null && tronTransfer.result._value > 100) {
                    var fee = (global.config.talleo.fee || 1);
                    var transferRPC = {
                            'transfers': [
                                {
                                    'amount': tronTransfer.result._value - fee,
                                    'address' : TLOAddress
                                }
                            ],
                            'fee': fee,
                            'anonymity': 3,
                        };
                    apiInterfaces.rpcWallet('sendTransaction', transferRPC, function (err1, response1) {
                        var amount = ((tronTransfer.result._value - transferRPC.fee) / 100);
                        var feeAmount = transferRPC.fee / 100;
                        var tronweb = new TronWeb({fullHost: config.tron.httpsNode, privateKey: config.tron.ownerKey});
                        var TRXAddress = tronweb.address.fromHex(tronTransfer.result._from);
                        if (err1) {
                            if (err1.message == 'Bad address') {
                                log('error', logTron, 'Invalid address "%s" while sending conversion request from %s', [TLOAddress, TRXAddress]);
                                return;
                            }
                            log('error', logTron, 'Error "%s" while sending conversion request from %s to %s with amount %s and fee %s', [err1.message, TRXAddress, TLOAddress, amount.toFixed(2), feeAmount.toFixed(2)]);
                            return confirmTronTransaction(txHash);
                        }
                        var TLOHash = response1.transactionHash;
                        if (TLOHash) {
                            log('info', logTron, 'Conversion completed from %s to %s for %s TLO, with fee %s TLO and transaction hash "%s"', [TRXAddress, TLOAddress, amount.toFixed(2), feeAmount.toFixed(2), TLOHash]);
                            delete tronTransfers[txHash];
                            global.redisClient.hset('tlo-trx-bridge:tron', 'conversion' + txHash, TLOHash, function (err2) {
                                if (err2) {
                                    log('error', logTron, 'Error "%s" while storing conversion from %s to %s with amount %s', [err2, TRXAddress, TLOAddress, amount.toFixed(2)]);
                                }
                            });
                        } else {
                            log('error', logTron, 'Unexpected response "%s" while sending conversion request from %s to %s with amount %s and fee %s', [JSON.stringify(response1), TRXAddress, TLOAddress, amount.toFixed(2), feeAmount.toFixed(2)]);
                            return confirmTronTransaction(txHash);
                        }
                    });
                }
            });
            return;
        }
        // Recursive call
        return confirmTronTransaction(txHash);
    }, 30 * 1000);
}

function scanTransactions(tronweb, trongrid, startBlockTime, fingerprint) {
    "use strict";
    var lastBlockTime = startBlockTime;
    try {
        const options = {
            event_name: 'conversionTo',
            only_to: true,
            limit: 100,
            order_by: 'timestamp,asc',
            min_timestamp: (startBlockTime === 0) ? (config.tron.startBlockTime || 0) : startBlockTime + 1,
            fingerprint: fingerprint
        };
        trongrid.contract.getEvents(config.tron.contractAddress, options).then(transactions => {
            if (!transactions.success) {
                log('error', logTron, "Can't get events for the contract");
                return;
            }

            transactions.data.forEach(event => {
                var TRXAddress = tronweb.address.fromHex(event.result._from);
                var TLOAddress = base58.encode(fromHexString(event.result._to));
                var amount = event.result._value / 100;
                log('info', logTron, 'Conversion request from %s to %s for %s TLO', [TRXAddress, TLOAddress, amount.toFixed(2)]);
                if (event.block_timestamp && event.block_timestamp > lastBlockTime) {
                    global.redisClient.hset('tlo-trx-bridge:tron', 'lastBlockTime', event.block_timestamp, function (error3) {
                        if (error3) {
                            log('error', logTron, 'Error "%s" updating last timestamp from %d to %d', [error3, lastBlockTime, event.block_timestamp]);
                        }
                        lastBlockTime = event.block_timestamp;
                    });
                }
                tronTransfers[event.transaction_id] = event;
                confirmTronTransaction(event.transaction_id);
            });
            if (typeof transactions.meta.fingerprint !== 'undefined') {
                setTimeout(function () {
                    scanTransactions(tronweb, trongrid, startBlockTime, transactions.meta.fingerprint)
                }, 30 * 1000);
            } else if (lastBlockTime !== startBlockTime) {
                setTimeout(function () {
                    scanTransactions(tronweb, trongrid, lastBlockTime, "")
                }, 30 * 1000);
            } else if (transactions.meta.at > startBlockTime) {
                setTimeout(function () {
                    scanTransactions(tronweb, trongrid, transactions.meta.at, "")
                }, 30 * 1000);
            } else {
                return;
            }
        });
    } catch (e) {
        log('error', logTron, 'Error "%s" while getting contract events...', [e.message]);
    }
}

(function init() {
    "use strict";
    global.redisClient.hget('tlo-trx-bridge:tron', 'lastBlockTime', async function (error, result) {
        if (error) {
            lastBlockTime = 0;
        } else {
            lastBlockTime = result ? parseInt(result) : 0;
        }
        var tronweb = new TronWeb({fullHost: global.config.tron.httpsNode, privateKey: global.config.tron.ownerKey});
        var trongrid = new TronGrid(tronweb);

        log('info', logTron, 'Scanning from timestamp %d...', [lastBlockTime]);
        scanTransactions(tronweb, trongrid, lastBlockTime, "");
    });
}());
