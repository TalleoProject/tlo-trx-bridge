var http = require('http');
var https = require('https');

function jsonHttpRequest(host, port, ssl, data, callback, path){
    path = path || '/json_rpc';

    var headers = {};
    var options = {
        hostname: host,
        port: port,
        path: path,
        method: data ? 'POST' : 'GET',
        headers: {
            'Content-Length': data ? data.length : 0,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    var req = (ssl ? https : http).request(options, function(res){
        var replyData = '';
        res.setEncoding('utf8');
        res.on('data', function(chunk){
            replyData += chunk;
        });
        res.on('end', function(){
            var replyJson;
            try{
                replyJson = JSON.parse(replyData);
            }
            catch(e){
                callback(e);
                return;
            }
            callback(null, replyJson);
        });
    });

    req.on('error', function(e){
        callback(e);
    });

    req.end(data);
}

function rpc(host, port, ssl, method, params, callback, password){
    var request = {
        id: "0",
        jsonrpc: "2.0",
        method: method,
        params: params
    };
    if (password !== undefined) {
        request['password'] = password;
    }
    var data = JSON.stringify(request);
    jsonHttpRequest(host, port, ssl, data, function(error, replyJson){
        if (error){
            callback(error);
            return;
        }
        callback(replyJson.error, replyJson.result)
    });
}

function batchRpc(host, port, ssl, array, callback){
    var rpcArray = [];
    for (var i = 0; i < array.length; i++){
        rpcArray.push({
            id: i.toString(),
            jsonrpc: "2.0",
            method: array[i][0],
            params: array[i][1]
        });
    }
    var data = JSON.stringify(rpcArray);
    jsonHttpRequest(host, port, ssl, data, callback);
}


module.exports = function(daemonConfig, walletConfig){
    return {
        batchRpcDaemon: function(batchArray, callback){
            batchRpc(daemonConfig.host, daemonConfig.port, ("ssl" in daemonConfig) ? daemonConfig.ssl : false, batchArray, callback);
        },
        rpcDaemon: function(method, params, callback){
            rpc(daemonConfig.host, daemonConfig.port, ("ssl" in daemonConfig) ? daemonConfig.ssl : false, method, params, callback);
        },
        rpcWallet: function(method, params, callback){
            rpc(walletConfig.host, walletConfig.port, ("ssl" in walletConfig) ? walletConfig.ssl : false, method, params, callback,
                walletConfig.password);
        },
        jsonHttpRequest: jsonHttpRequest,
        jsonDaemon: function(path, data, callback){
            jsonHttpRequest(daemonConfig.host, daemonConfig.port, ("ssl" in daemonConfig) ? daemonConfig.ssl : false, data, callback, path);
        }
    }
};
