const express = require('express');
const app = require('./api/index');

// Vercel handles the server listening, so we just export the app
module.exports = app;
