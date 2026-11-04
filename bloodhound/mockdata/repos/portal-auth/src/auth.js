const jwt = require('jsonwebtoken');
const KEY = process.env.JWT_KEY;

module.exports = function verifyToken(token) {
  return jwt.verify(token, KEY, { algorithms: ['HS256'] });
};
