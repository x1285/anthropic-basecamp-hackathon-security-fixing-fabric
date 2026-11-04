const jwt = require('jsonwebtoken');
module.exports = (t) => jwt.decode(t);
