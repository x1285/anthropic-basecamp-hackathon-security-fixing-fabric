const _ = require('lodash');
module.exports = (events) => _.sortBy(events, 'ts');
