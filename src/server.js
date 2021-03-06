'use strict';
var express = require('express'),
  bodyParser = require('body-parser'),
  request = require('request'),
  http = require('http'),
  killable = require('killable'),
  TypedError = require("error/typed");

var server;

var dbConfig = {
  url: 'CONFIG_DB_URL',
  adminUser: 'admin',
  adminPass: 'CONFIG_DB_ADMIN_PASS'
};

var DbError = TypedError({
  type: 'db',
  statusCode: null
});

var AuthenticationError = TypedError({
  type: 'authentication',
  statusCode: null
});

function start(cb) {
  var app = express();

  app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
  });
  app.use(express.static('static'));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({extended: false}));

  app.post('/register', function(req, res) {
    var username = req.body.username;
    var password = req.body.password;
    if (username && password) {
      createUser(username, password, function(err, user) {
        if (err) {
          res.status(err.statusCode).json({error: err.type, message: err.message});
        }
        res.json(user);
      });
    } else {
      res.status(400).send();
    }
  });

  app.post('/login', function(req, res, next) {
    var username = req.body.username;
    var password = req.body.password;
    if (username && password) {
      authenticateUser(username, password, function(err, user) {
        if (err) {
          return res.status(err.statusCode).json({error: err.type, message: err.message});
        }
        return res.json(user);
      });
    } else {
      res.status(400).send();
    }
  });

  var port = process.env.PORT || 5000;
  server = killable(http.createServer(app));
  server.listen(port, cb);
  console.log('Server started on port ' + port + '.');
}

function stop(cb) {
  if (server) {
    console.log('Stopping server.');
    server.kill(cb);
    server = null;
  } else {
    if (cb) {
      cb();
    }
  }
}

function authenticateUser(username, password, callback) {
  var dbName = calcDbNameFromUsername(username);
  request.get({
    uri: dbConfig.url + '/' + dbName,
    auth: {
      'user': username,
      'pass': password
    }
  }, function(err, response, body) {
    if (err) {
      return callback(new DbError({statusCode: 502, message: err.message}));
    }
    if (response.statusCode === 200) {
      callback(null, createUserObject(dbName, username, password));
    } else if (response.statusCode === 401) {
      callback(new AuthenticationError({statusCode: 401, message: 'Invalid username/password.'}));
    } else {
      callback(new AuthenticationError({statusCode: 500, message: body.reason}));
    }
  });
}

function createUser(username, password, callback) {
  request.put({
    uri: dbConfig.url + '/_users/org.couchdb.user:' + encodeURIComponent(username),
    auth: {
      'user': dbConfig.adminUser,
      'pass': dbConfig.adminPass
    },
    json: {
      "_id": 'org.couchdb.user:' + username,
      "name": username,
      "type": 'user',
      "roles": [],
      "password": password
    }
  }, function(err, response, body) {
    if (err) {
      return callback(new DbError({statusCode: 502, message: err.message}));
    }
    if (response.statusCode === 201) {
      callback(null, createUserObject(calcDbNameFromUsername(username), username, password));
    } else if (response.statusCode === 409) {
      callback(new AuthenticationError({statusCode: 409, message: 'User already exists.'}));
    } else {
      callback(new AuthenticationError({statusCode: 500, message: body.reason}));
    }
  });
}

function createUserObject(dbName, username, password) {
  return {
    'username': username,
    'dbUrl': dbConfig.url + '/' + dbName,
    'dbCredentials': [username, password]
  };
}

function calcDbNameFromUsername(username) {
  return 'userdb-' + new Buffer(username).toString('hex');
}


module.exports = function() {
  return {
    start: start,
    stop: stop
  }
};
