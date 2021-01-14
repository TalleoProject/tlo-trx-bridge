/*jslint bitwise: true */
var base58 = require('base58-native');
var fs = require('fs');
var TronWeb = require('tronweb');
var TronGrid = require('trongrid');
require('./logger.js');
require('./configReader.js');
var apiInterfaces = require('./apiInterfaces.js')(global.config.talleo.daemon, global.config.talleo.wallet);

var logTalleo = 'talleo';
require('./exceptionWriter.js')(logTalleo);

var log = function (severity, system, text, data) {
    "use strict";
    global.log(severity, system, text, data);
};

var lastBlockFound, lastTopBlock = -1, TLOTransactions = {}, TRXAddresses = {};

function toHexString(byteArray) {
  return byteArray.reduce((output, elem) =>
    (output + elem.toString(16).padStart(2, '0')), '');
}

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

function trx_to_payment_id(address) {
    "use strict";
    var decoded = base58.decode(address);
    var pid = toHexString(decoded);
    return pid.padEnd(64, 0);
}

function payment_id_to_trx(pid) {
    "use strict";
    var encoded = fromHexString(pid.substring(0, 50));
    var address = base58.encode(encoded);
    return address;
}

async function getCurrentHeight() {
    var promise = new Promise((resolve, reject) =>
        apiInterfaces.jsonDaemon('/getheight', null, function (error, result) {
            if (error) {
                log('error', logTalleo, 'Error "%s" while trying to get current block height', [error]);
                reject(new Error(error.message));
            }
            if (result) {
                resolve(result.network_height);
            } else {
                reject(new Error('Invalid response from getheight!'));
            }
        })
    );
    return await promise;
}
async function getConfirmations(txHash) {
    "use strict";
    try {
        var currentHeight = await getCurrentHeight(), confirmations = 0;

        var promise = new Promise((resolve, reject) =>
            apiInterfaces.rpcWallet('getTransaction', {'transactionHash': txHash}, function (error, result) {
                if (error) {
                    log('error', logTalleo, 'Error "%s" while trying to get transaction with hash "%s"', [error, txHash]);
                    reject(new Error(error.message));
                }
                TLOTransactions[txHash] = result.transaction;
                if (result.transaction.blockIndex > 0) {
                    if (result.transaction.blockIndex > lastBlockFound) {
                        global.redisClient.hset('tlo-trx-bridge:talleo', 'lastBlockFound', result.transaction.blockIndex, function (error1) {
                            if (error1) {
                                log('error', logTalleo, 'Error "%s" while trying to update last block found from %d to %d', [error1, lastBlockFound, result.transaction.blockIndex]);
                                reject(new Error(error1));
                            }
                            lastBlockFound = result.transaction.blockIndex;
                        });
                    }
                    confirmations = currentHeight - result.transaction.blockIndex;
                    resolve(confirmations);
                }
                resolve(0);
            })
        );
        confirmations = await promise;
        return confirmations;
    } catch (error) {
        log('error', logTalleo, "getConfirmations() caught exception: %s", [error.message]);
        return 0;
    }
}

function confirmTalleoTransaction(txHash) {
    "use strict";
    setTimeout(async function() {

        // Get current number of confirmations and compare it with sought-for value
        var txConfirmations, TLOTransaction;
        txConfirmations = await getConfirmations(txHash);

        log('info', logTalleo, 'Transaction with hash %s has %d confirmation(s)', [txHash, txConfirmations]);

        if (txConfirmations >= (global.config.talleo.confirmations || 10)) {
            // Handle confirmation event according to your business logic

            log('info', logTalleo, 'Transaction with hash %s has been successfully confirmed', [txHash]);

            if (typeof TLOTransactions[txHash] === 'undefined') {
                return;
            }

            TLOTransaction = TLOTransactions[txHash];
            global.redisClient.hget('tlo-trx-bridge:talleo', 'conversion' + txHash, async function (error, result) {
                // Check that we haven't processed this conversion request already, minimum amount is 1 WTLO
                if (result === null && TLOTransaction.amount > 100) {
                    var tronweb = new TronWeb({fullHost: config.tron.httpsNode, privateKey: config.tron.ownerKey});
                    try {
                        var tokenContract = await tronweb.contract().at(global.config.tron.contractAddress);
                        var TRXAddress = payment_id_to_trx(TLOTransaction.paymentId);
                        if (!tronweb.isAddress(TRXAddress)) {
                            log('error', logTalleo, 'Invalid address "%s" in conversion request', [TRXAddress]);
                            return;
                        }
                        if (TRXAddress == global.config.tron.ownerAddress) {
                            log('error', logTalleo, 'Trying to send tokens to owner address');
                            return;
                        }
                        if (TRXAddress == 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb') {
                            log('error', logTalleo, 'Trying to send tokens to NULL address');
                            return;
                        }
                        if (global.config.tron.blacklist) {
                            for (var i = 0; i < global.config.tron.blacklist.length; i++) {
                                if (global.config.tron.blacklist[i] == TRXAddress) {
                                    log('error', logTalleo, 'Trying to send tokens to blacklisted address');
                                    return;
                                }
                            }
                        }
                        if (TRXAddresses[TRXAddress]) {
                            var lastConversion = TRXAddresses[TRXAddress];
                            if (Date.now() - lastConversion < 86400000) {
                                log('info', logTalleo, 'Trying to send tokens to same destination address too fast');
                                setTimeout(function() {
                                    confirmTalleoTransaction(txHash);
                                }, 86400000);
                                return;
                            }
                        }
                        TRXAddresses[TRXAddress] = Date.now();

                        var ownerBalance = await tronweb.trx.getBalance(global.config.tron.ownerAddress);
                        if (ownerBalance < config.tron.fee) {
                            log('error', logTalleo, 'Tron wallet does not have enough balance!');
                            setTimeout(function() {
                                confirmTalleoTransaction(txHash);
                            }, 3600000);
                            return;
                        }
                        tokenContract.convertFrom(
                            base58.decode(global.config.talleo.bridgeAddress),
                            tronweb.address.toHex(TRXAddress),
                            TLOTransaction.amount).send(
                            {feeLimit: config.tron.fee}
                        ).then(async function (output) {
                            var txinfo = {};
                            do {
                                txinfo = await tronweb.trx.getTransactionInfo(output);
                            } while (typeof txinfo.receipt === 'undefined');
                            if (txinfo.receipt.result == "SUCCESS") {
                                delete TLOTransactions[txHash];
                                global.redisClient.hset('tlo-trx-bridge:talleo', 'conversion' + txHash, output, function (error2, result2) {
                                    var amount = TLOTransaction.amount / 100;
                                    if (error2) {
                                        log('error', logTalleo, 'Error "%s" while trying to store conversion request with TLO hash "%s", TRX hash "%s", recipient %s and amount %s TLO', [error2, txHash, output, TRXAddress, amount.toFixed(2)]);
                                        return;
                                    }
                                    log('info', logTalleo, 'Conversion request with recipient %s and amount %s TLO sent with hash %s', [TRXAddress, amount.toFixed(2), output]);
                                });
                            } else {
                                throw new Error(txinfo.receipt.result);
                            }
                        });
                    } catch (e) {
                        log('error', logTalleo, 'Error "%s" while trying to send conversion request with TLO hash "%s", recipient %s and amount %s TLO', [e.message, txHash, payment_id_to_trx(TLOTransaction.paymentId), TLOTransaction.amount.toFixed(2)]);
                        return;
                    }
                }
            });
            return;
        }
        // Recursive call
        confirmTalleoTransaction(txHash);
        return;
    }, 30000);
}

function parseBlock(block) {
    "use strict";
    var i;
    for (i = 0; i < block.transactionHashes.length; i = i + 1) {
        confirmTalleoTransaction(block.transactionHashes[i]);
    }
}

function scanTransactions(firstBlock) {
    "use strict";
    var blockCount, i;
    apiInterfaces.rpcWallet('getStatus', {}, function(error, result) {
        if (error) {
            log('error', logTalleo, 'Error "%s" while trying to get current block height', [error]);
            process.exit(1);
            //setTimeout(scanTransactions(firstBlock), 1000);
            //return;
        }
        if (result.blockCount != lastTopBlock) {
            log('info', logTalleo, 'Current block height: %d', [result.blockCount]);
            lastTopBlock = result.blockCount;
        }
        if (firstBlock < lastTopBlock) {
            blockCount = firstBlock + 999 < lastTopBlock ? 1000 : (lastTopBlock - firstBlock);
            apiInterfaces.rpcWallet('getTransactionHashes', {
                'addresses': [global.config.talleo.bridgeAddress],
                'firstBlockIndex': firstBlock,
                'blockCount': blockCount
            }, function (error1, result1) {
                if (error1) {
                    log('error', logTalleo, 'Error "%s" while trying to get transactions from block %d to %d', [error1.message, firstBlock, (firstBlock + blockCount - 1)]);
                    if (firstBlock === 0) {
                        process.exit(1);
                    }
                    setTimeout(function() {
                        scanTransactions(firstBlock)
                    }, 1000);
                    return;
                }
                log('info', logTalleo, 'Scanning from %d to %d...', [firstBlock, firstBlock + blockCount - 1]);
                if (result1 && result1.items) {
                    for (i = 0; i < result1.items.length; i = i + 1) {
                        parseBlock(result1.items[i]);
                    }
                }
                // Recurse
                setTimeout(function() {
                    scanTransactions(firstBlock + blockCount);
                }, 1000);
            });
        } else {
           setTimeout(function() {
               scanTransactions(firstBlock);
           }, 1000);
        }
    });
}

(function init() {
    "use strict";
    global.redisClient.hget('tlo-trx-bridge:talleo', 'lastBlockFound', function (error, result) {
        if (error) {
            lastBlockFound = 0;
        } else {
            lastBlockFound = result ? parseInt(result) : 0;
        }
        scanTransactions(lastBlockFound === 0 ? (global.config.talleo.startHeight || 0) : lastBlockFound + 1);
    });
}());
