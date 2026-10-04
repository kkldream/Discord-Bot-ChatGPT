'use strict';
const { AppError } = require('../errors');
function createProvider(config, dependencies = {}) {
  switch (config.provider || 'openai') {
    case 'openai': return require('../../openaiApi').createChatProvider(config, dependencies);
    case 'gemini': return require('./gemini').createGeminiProvider(config, dependencies);
    default: throw new AppError('CONFIG');
  }
}
module.exports = { createProvider };
